// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {PDRGate} from "../src/PDRGate.sol";
import {IPDRGate} from "../src/IPDRGate.sol";
import {IPDRVerifier} from "../src/IPDRVerifier.sol";
import {PDRVerifier} from "../src/PDRVerifier.sol";
import {IRoles} from "../src/IRoles.sol";
import {PaymentIntent, PolicyDecision} from "../src/KeelTypes.sol";
import {MockUSDC, MockSafe, MockRoles, MockRolesReturnsFalse, Mock1271} from "./mocks/Mocks.sol";

contract PDRGateTest is Test {
    bytes32 constant AGENTE = keccak256("AGENTE");
    uint256 constant CAP = 300e6; // 300 USDC per period
    uint256 constant PERIOD = 30 days;

    uint256 policyPk = 0xA11CE;
    uint256 cosignerPk = 0xC051;
    uint256 attackerPk = 0xBAD;
    address owner = makeAddr("owner");
    address relayer = makeAddr("relayer");

    address landlord = makeAddr("landlord");
    address power = makeAddr("power");
    address isp = makeAddr("isp");
    address attacker;

    bytes32 constant POLICY_V1 = keccak256("rules-v1|roles-config-v1");

    MockUSDC usdc;
    MockSafe safe;
    MockRoles roles;
    PDRGate gate;

    uint256 nextNonce = 1;

    function setUp() public {
        vm.warp(1_760_000_000);
        attacker = vm.addr(attackerPk);
        usdc = new MockUSDC();
        safe = new MockSafe(owner);
        roles = new MockRoles(safe, address(usdc), CAP, PERIOD);
        gate = new PDRGate(
            address(safe),
            IRoles(address(roles)),
            IERC20(address(usdc)),
            AGENTE,
            vm.addr(policyPk),
            vm.addr(cosignerPk),
            POLICY_V1
        );

        vm.startPrank(owner);
        safe.enableModule(address(roles));
        safe.exec(address(roles), abi.encodeCall(MockRoles.assignRole, (AGENTE, address(gate), true)));
        safe.exec(address(roles), abi.encodeCall(MockRoles.setAllowlisted, (landlord, true)));
        safe.exec(address(roles), abi.encodeCall(MockRoles.setAllowlisted, (power, true)));
        safe.exec(address(roles), abi.encodeCall(MockRoles.setAllowlisted, (isp, true)));
        vm.stopPrank();

        usdc.mint(address(safe), 1_000e6);
    }

    // ------------------------------------------------------------------ helpers

    function _intent(address to, uint256 amount, bytes32 invoiceKey) internal returns (PaymentIntent memory i) {
        i = PaymentIntent({
            aliasId: 1,
            recipient: to,
            amountUsdc: amount,
            invoiceKey: invoiceKey,
            deadline: uint64(vm.getBlockTimestamp() + 7 days),
            nonce: nextNonce++
        });
    }

    function _decision(PaymentIntent memory i, uint8 tier) internal view returns (PolicyDecision memory d) {
        d = PolicyDecision({
            intentHash: gate.intentHashOf(i),
            calldataHash: keccak256(abi.encodeCall(IERC20.transfer, (i.recipient, i.amountUsdc))),
            policyHash: gate.currentPolicyHash(),
            inputsHash: keccak256("fx:950.12|bcch|buda|allowlist-v3"),
            tier: tier,
            expiresAt: uint64(vm.getBlockTimestamp() + 1 hours)
        });
    }

    function _sign(uint256 pk, PolicyDecision memory d) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, gate.digestOf(d));
        return abi.encodePacked(r, s, v);
    }

    function _pay(PaymentIntent memory i, PolicyDecision memory d) internal {
        bytes memory cos = d.tier == 3 ? _sign(cosignerPk, d) : bytes("");
        vm.prank(relayer);
        gate.execute(i, d, _sign(policyPk, d), cos);
    }

    function _key(string memory s) internal pure returns (bytes32) {
        return keccak256(bytes(s));
    }

    // ------------------------------------------------------------------ happy paths

    function test_tier1_paysKnownPayee() public {
        PaymentIntent memory i = _intent(power, 45_300000, _key("761234567|48213|202609"));
        PolicyDecision memory d = _decision(i, 1);
        vm.expectEmit(true, true, false, true, address(gate));
        emit IPDRGate.PaymentExecuted(d.intentHash, gate.digestOf(d), 1, i.invoiceKey);
        _pay(i, d);
        assertEq(usdc.balanceOf(power), 45_300000);
        assertTrue(gate.invoicePaid(i.invoiceKey));
    }

    function test_tier3_paysWithCosigner() public {
        PaymentIntent memory i = _intent(landlord, 250e6, _key("rent|202610"));
        _pay(i, _decision(i, 3));
        assertEq(usdc.balanceOf(landlord), 250e6);
    }

    function test_tier3_acceptsSmartWalletCosigner() public {
        Mock1271 cw = new Mock1271(vm.addr(cosignerPk));
        vm.prank(owner);
        safe.exec(address(gate), abi.encodeCall(PDRVerifier.setCosigner, (address(cw))));
        PaymentIntent memory i = _intent(landlord, 250e6, _key("rent|202610"));
        PolicyDecision memory d = _decision(i, 3);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(cosignerPk, gate.digestOf(d));
        vm.prank(relayer);
        gate.execute(i, d, _sign(policyPk, d), abi.encode(r, s, v));
        assertEq(usdc.balanceOf(landlord), 250e6);
    }

    // ------------------------------------------------------------------ one revert per typed error

    function test_revert_GateIsPaused() public {
        vm.prank(owner);
        safe.exec(address(gate), abi.encodeCall(PDRVerifier.pause, ()));
        PaymentIntent memory i = _intent(power, 10e6, _key("a"));
        PolicyDecision memory d = _decision(i, 1);
        bytes memory sig = _sign(policyPk, d);
        vm.expectRevert(IPDRVerifier.GateIsPaused.selector);
        gate.execute(i, d, sig, "");
    }

    function test_revert_IntentMismatch_oneFieldChanged() public {
        PaymentIntent memory i = _intent(power, 10e6, _key("a"));
        PolicyDecision memory d = _decision(i, 1);
        bytes memory sig = _sign(policyPk, d);
        i.amountUsdc += 1; // one unit (0.000001 USDC) more than approved
        vm.expectRevert(IPDRVerifier.IntentMismatch.selector);
        gate.execute(i, d, sig, "");
    }

    function test_revert_CalldataMismatch() public {
        PaymentIntent memory i = _intent(power, 10e6, _key("a"));
        PolicyDecision memory d = _decision(i, 1);
        d.calldataHash = keccak256(abi.encodeCall(IERC20.transfer, (attacker, i.amountUsdc)));
        bytes memory sig = _sign(policyPk, d);
        vm.expectRevert(IPDRVerifier.CalldataMismatch.selector);
        gate.execute(i, d, sig, "");
    }

    function test_revert_CalldataMismatch_approveSelector() public {
        PaymentIntent memory i = _intent(power, 10e6, _key("a"));
        PolicyDecision memory d = _decision(i, 1);
        d.calldataHash = keccak256(abi.encodeCall(IERC20.approve, (power, type(uint256).max)));
        bytes memory sig = _sign(policyPk, d);
        vm.expectRevert(IPDRVerifier.CalldataMismatch.selector);
        gate.execute(i, d, sig, "");
    }

    function test_revert_BadPolicySignature_wrongSigner() public {
        PaymentIntent memory i = _intent(power, 10e6, _key("a"));
        PolicyDecision memory d = _decision(i, 1);
        bytes memory sig = _sign(attackerPk, d);
        vm.expectRevert(IPDRVerifier.BadPolicySignature.selector);
        gate.execute(i, d, sig, "");
    }

    function test_revert_BadPolicySignature_cosignerCannotActAsPolicy() public {
        PaymentIntent memory i = _intent(power, 10e6, _key("a"));
        PolicyDecision memory d = _decision(i, 1);
        bytes memory sig = _sign(cosignerPk, d);
        vm.expectRevert(IPDRVerifier.BadPolicySignature.selector);
        gate.execute(i, d, sig, "");
    }

    function test_revert_BadPolicySignature_tamperedDecisionField() public {
        PaymentIntent memory i = _intent(power, 10e6, _key("a"));
        PolicyDecision memory d = _decision(i, 1);
        bytes memory sig = _sign(policyPk, d);
        d.inputsHash = keccak256("fx:manipulated");
        vm.expectRevert(IPDRVerifier.BadPolicySignature.selector);
        gate.execute(i, d, sig, "");
    }

    function test_revert_BadPolicySignature_malleableHighS() public {
        PaymentIntent memory i = _intent(power, 10e6, _key("a"));
        PolicyDecision memory d = _decision(i, 1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(policyPk, gate.digestOf(d));
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes memory flipped = abi.encodePacked(r, bytes32(n - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(IPDRVerifier.BadPolicySignature.selector);
        gate.execute(i, d, flipped, "");
    }

    function test_revert_StalePolicy() public {
        PaymentIntent memory i = _intent(power, 10e6, _key("a"));
        PolicyDecision memory d = _decision(i, 1);
        bytes memory sig = _sign(policyPk, d);
        vm.prank(owner);
        safe.exec(address(gate), abi.encodeCall(PDRVerifier.setPolicyHash, (keccak256("rules-v2"))));
        vm.expectRevert(IPDRVerifier.StalePolicy.selector);
        gate.execute(i, d, sig, "");
    }

    function test_revert_Expired_decision() public {
        PaymentIntent memory i = _intent(power, 10e6, _key("a"));
        PolicyDecision memory d = _decision(i, 1);
        bytes memory sig = _sign(policyPk, d);
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(IPDRVerifier.Expired.selector);
        gate.execute(i, d, sig, "");
    }

    function test_revert_Expired_intentDeadline() public {
        PaymentIntent memory i = _intent(power, 10e6, _key("a"));
        i.deadline = uint64(block.timestamp - 1);
        PolicyDecision memory d = _decision(i, 1);
        bytes memory sig = _sign(policyPk, d);
        vm.expectRevert(IPDRVerifier.Expired.selector);
        gate.execute(i, d, sig, "");
    }

    function test_revert_NonceUsed() public {
        PaymentIntent memory i = _intent(power, 10e6, _key("a"));
        _pay(i, _decision(i, 1));
        PaymentIntent memory j = _intent(power, 10e6, _key("b"));
        j.nonce = i.nonce;
        PolicyDecision memory d = _decision(j, 1);
        bytes memory sig = _sign(policyPk, d);
        vm.expectRevert(IPDRVerifier.NonceUsed.selector);
        gate.execute(j, d, sig, "");
    }

    function test_revert_InvoiceAlreadyPaid_evenWithFreshPDR() public {
        bytes32 k = _key("761234567|48213|202609");
        PaymentIntent memory i = _intent(power, 45e6, k);
        _pay(i, _decision(i, 1));
        // a new, validly signed PDR for the same invoice (e.g. PDF re-sent with one pixel changed)
        PaymentIntent memory j = _intent(power, 45e6, k);
        PolicyDecision memory d = _decision(j, 1);
        bytes memory sig = _sign(policyPk, d);
        vm.expectRevert(IPDRGate.InvoiceAlreadyPaid.selector);
        gate.execute(j, d, sig, "");
    }

    function test_revert_MissingCosignature_empty() public {
        PaymentIntent memory i = _intent(landlord, 250e6, _key("rent"));
        PolicyDecision memory d = _decision(i, 3);
        bytes memory sig = _sign(policyPk, d);
        vm.expectRevert(IPDRVerifier.MissingCosignature.selector);
        gate.execute(i, d, sig, "");
    }

    function test_revert_MissingCosignature_policyKeyCannotCosign() public {
        PaymentIntent memory i = _intent(landlord, 250e6, _key("rent"));
        PolicyDecision memory d = _decision(i, 3);
        bytes memory sig = _sign(policyPk, d);
        vm.expectRevert(IPDRVerifier.MissingCosignature.selector);
        gate.execute(i, d, sig, sig);
    }

    function test_revert_downgradeTier3To1_breaksPolicySignature() public {
        PaymentIntent memory i = _intent(landlord, 250e6, _key("rent"));
        PolicyDecision memory d = _decision(i, 3);
        bytes memory sig = _sign(policyPk, d);
        d.tier = 1; // relayer tries to skip the cosigner
        vm.expectRevert(IPDRVerifier.BadPolicySignature.selector);
        gate.execute(i, d, sig, "");
    }

    function test_revert_InvalidTier() public {
        for (uint8 t = 0; t <= 4; t++) {
            if (t == 1 || t == 3) continue;
            PaymentIntent memory i = _intent(power, 10e6, _key("a"));
            PolicyDecision memory d = _decision(i, t);
            bytes memory sig = _sign(policyPk, d);
            vm.expectRevert(IPDRVerifier.InvalidTier.selector);
            gate.execute(i, d, sig, "");
        }
    }

    // ------------------------------------------------------------------ defense in depth: compromised policy signer

    function test_compromisedSigner_cannotPayOutsideAllowlist() public {
        PaymentIntent memory i = _intent(attacker, 10e6, _key("x"));
        PolicyDecision memory d = _decision(i, 1);
        bytes memory sig = _sign(policyPk, d); // the stolen key signs a perfectly valid PDR
        vm.expectPartialRevert(MockRoles.ConditionViolation.selector);
        gate.execute(i, d, sig, "");
        assertEq(usdc.balanceOf(attacker), 0);
    }

    function test_compromisedSigner_boundedByPeriodAllowance() public {
        PaymentIntent memory i = _intent(landlord, CAP + 1, _key("x"));
        PolicyDecision memory d = _decision(i, 1);
        bytes memory sig = _sign(policyPk, d);
        vm.expectPartialRevert(MockRoles.ConditionViolation.selector);
        gate.execute(i, d, sig, "");
    }

    function test_relayerKey_cannotCallRolesDirectly() public {
        bytes memory data = abi.encodeCall(IERC20.transfer, (relayer, 1e6));
        vm.prank(relayer);
        vm.expectRevert(MockRoles.NoMembership.selector);
        roles.execTransactionWithRole(address(usdc), 0, data, IRoles.Operation.Call, AGENTE, true);
    }

    function test_panic_revokeAgentRole_stopsPayments() public {
        vm.prank(owner);
        safe.exec(address(roles), abi.encodeCall(MockRoles.assignRole, (AGENTE, address(gate), false)));
        PaymentIntent memory i = _intent(power, 10e6, _key("a"));
        PolicyDecision memory d = _decision(i, 1);
        bytes memory sig = _sign(policyPk, d);
        vm.expectRevert(MockRoles.NoMembership.selector);
        gate.execute(i, d, sig, "");
    }

    // ------------------------------------------------------------------ configuration is Safe-only

    function test_revert_configFromNonSafe() public {
        address[3] memory callers = [attacker, vm.addr(cosignerPk), vm.addr(policyPk)];
        for (uint256 k; k < 3; k++) {
            vm.startPrank(callers[k]);
            vm.expectRevert(IPDRVerifier.OnlySafe.selector);
            gate.setPolicySigner(callers[k]);
            vm.expectRevert(IPDRVerifier.OnlySafe.selector);
            gate.setPolicyHash(bytes32(0));
            vm.expectRevert(IPDRVerifier.OnlySafe.selector);
            gate.setCosigner(callers[k]);
            vm.expectRevert(IPDRVerifier.OnlySafe.selector);
            gate.unpause();
            vm.expectRevert(IPDRVerifier.OnlySafe.selector);
            gate.pause();
            vm.stopPrank();
        }
    }

    // ------------------------------------------------------------------ failed execution leaves no trace

    function test_revert_ExecutionFailed_rolesReturnsFalse() public {
        MockRolesReturnsFalse falseRoles = new MockRolesReturnsFalse();
        gate = new PDRGate(
            address(safe),
            IRoles(address(falseRoles)),
            IERC20(address(usdc)),
            AGENTE,
            vm.addr(policyPk),
            vm.addr(cosignerPk),
            POLICY_V1
        );
        PaymentIntent memory i = _intent(power, 10e6, _key("a"));
        PolicyDecision memory d = _decision(i, 1);
        bytes memory sig = _sign(policyPk, d);
        vm.expectRevert(IPDRVerifier.ExecutionFailed.selector);
        gate.execute(i, d, sig, "");
        assertFalse(gate.nonceUsed(i.nonce));
        assertFalse(gate.invoicePaid(i.invoiceKey));
    }

    /// The Safe-level USDC transfer fails, so Roles reverts and the whole transaction reverts:
    /// nonce and invoice stay unused and a fresh attempt for the same invoice still pays.
    function test_revert_ModuleTransactionFailed_safeExecutionFails_rollsBackState() public {
        PaymentIntent memory i = _intent(power, 10e6, _key("a"));
        PolicyDecision memory d = _decision(i, 1);
        bytes memory sig = _sign(policyPk, d);
        vm.mockCallRevert(address(usdc), abi.encodeWithSelector(IERC20.transfer.selector), "");
        vm.expectRevert(MockRoles.ModuleTransactionFailed.selector);
        gate.execute(i, d, sig, "");
        assertFalse(gate.nonceUsed(i.nonce));
        assertFalse(gate.invoicePaid(i.invoiceKey));
        assertEq(usdc.balanceOf(power), 0);

        vm.clearMockedCalls();
        _pay(i, d);
        assertEq(usdc.balanceOf(power), 10e6);
    }

    // ------------------------------------------------------------------ policy signer rotation

    function test_setPolicySigner_rotation_oldSignerRejectedNewSignerPays() public {
        uint256 newPolicyPk = 0xBEEF;
        vm.expectEmit(false, false, false, true, address(gate));
        emit IPDRVerifier.PolicySignerSet(vm.addr(newPolicyPk));
        vm.prank(owner);
        safe.exec(address(gate), abi.encodeCall(PDRVerifier.setPolicySigner, (vm.addr(newPolicyPk))));
        assertEq(gate.policySigner(), vm.addr(newPolicyPk));

        PaymentIntent memory i = _intent(power, 10e6, _key("a"));
        PolicyDecision memory d = _decision(i, 1);
        bytes memory oldSig = _sign(policyPk, d);
        vm.expectRevert(IPDRVerifier.BadPolicySignature.selector);
        gate.execute(i, d, oldSig, "");

        vm.prank(relayer);
        gate.execute(i, d, _sign(newPolicyPk, d), "");
        assertEq(usdc.balanceOf(power), 10e6);
    }

    // ------------------------------------------------------------------ configuration is validated

    function _deploy(address safe_, address roles_, address usdc_, address signer_, address cosigner_) internal {
        new PDRGate(safe_, IRoles(roles_), IERC20(usdc_), AGENTE, signer_, cosigner_, POLICY_V1);
    }

    function test_revert_ZeroAddress_constructorSafe() public {
        vm.expectRevert(IPDRVerifier.ZeroAddress.selector);
        _deploy(address(0), address(roles), address(usdc), vm.addr(policyPk), vm.addr(cosignerPk));
    }

    function test_revert_ZeroAddress_constructorRoles() public {
        vm.expectRevert(IPDRVerifier.ZeroAddress.selector);
        _deploy(address(safe), address(0), address(usdc), vm.addr(policyPk), vm.addr(cosignerPk));
    }

    function test_revert_ZeroAddress_constructorUsdc() public {
        vm.expectRevert(IPDRVerifier.ZeroAddress.selector);
        _deploy(address(safe), address(roles), address(0), vm.addr(policyPk), vm.addr(cosignerPk));
    }

    function test_revert_ZeroAddress_constructorPolicySigner() public {
        vm.expectRevert(IPDRVerifier.ZeroAddress.selector);
        _deploy(address(safe), address(roles), address(usdc), address(0), vm.addr(cosignerPk));
    }

    function test_revert_ZeroAddress_constructorCosigner() public {
        vm.expectRevert(IPDRVerifier.ZeroAddress.selector);
        _deploy(address(safe), address(roles), address(usdc), vm.addr(policyPk), address(0));
    }

    function test_revert_ZeroAddress_setPolicySigner() public {
        vm.prank(owner);
        vm.expectRevert(IPDRVerifier.ZeroAddress.selector);
        safe.exec(address(gate), abi.encodeCall(PDRVerifier.setPolicySigner, (address(0))));
    }

    function test_revert_ZeroAddress_setCosigner() public {
        vm.prank(owner);
        vm.expectRevert(IPDRVerifier.ZeroAddress.selector);
        safe.exec(address(gate), abi.encodeCall(PDRVerifier.setCosigner, (address(0))));
    }

    function test_revert_SignerIsCosigner_constructor() public {
        vm.expectRevert(IPDRVerifier.SignerIsCosigner.selector);
        _deploy(address(safe), address(roles), address(usdc), vm.addr(policyPk), vm.addr(policyPk));
    }

    function test_revert_SignerIsCosigner_setPolicySigner() public {
        vm.prank(owner);
        vm.expectRevert(IPDRVerifier.SignerIsCosigner.selector);
        safe.exec(address(gate), abi.encodeCall(PDRVerifier.setPolicySigner, (vm.addr(cosignerPk))));
    }

    function test_revert_SignerIsCosigner_setCosigner() public {
        vm.prank(owner);
        vm.expectRevert(IPDRVerifier.SignerIsCosigner.selector);
        safe.exec(address(gate), abi.encodeCall(PDRVerifier.setCosigner, (vm.addr(policyPk))));
    }

    // ------------------------------------------------------------------ fuzz properties (T1.7)

    /// Property 1: no sequence of validly signed PDRs moves funds to a non-allowlisted address.
    function testFuzz_neverPaysOutsideAllowlist(address to, uint256 amount) public {
        vm.assume(to != landlord && to != power && to != isp && to != address(safe));
        amount = bound(amount, 1, CAP);
        PaymentIntent memory i = _intent(to, amount, _key("f"));
        PolicyDecision memory d = _decision(i, 1);
        bytes memory sig = _sign(policyPk, d);
        uint256 before = usdc.balanceOf(to);
        vm.expectPartialRevert(MockRoles.ConditionViolation.selector);
        gate.execute(i, d, sig, "");
        assertEq(usdc.balanceOf(to), before);
    }

    /// Property 2: within one period, total outflow through the gate never exceeds the cap.
    function testFuzz_periodOutflowBounded(uint256[8] memory amounts) public {
        uint256 start = usdc.balanceOf(address(safe));
        for (uint256 k; k < amounts.length; k++) {
            uint256 a = bound(amounts[k], 1, CAP);
            PaymentIntent memory i = _intent(power, a, keccak256(abi.encode("inv", k)));
            PolicyDecision memory d = _decision(i, 1);
            bytes memory sig = _sign(policyPk, d);
            try gate.execute(i, d, sig, "") {} catch {}
            vm.warp(vm.getBlockTimestamp() + 1 hours);
        }
        assertLe(start - usdc.balanceOf(address(safe)), CAP);
    }
}

/// @notice Documents why invoiceKey must use abi.encode, not packed concatenation (section 2.1 / T3.7).
contract InvoiceKeyCollisionTest is Test {
    function test_packedEncodingCollides_twoDistinctInvoices() public pure {
        // RUT 7.612.345-4 and RUT 76.123.454-4 both have a valid mod-11 check digit.
        bytes32 a = keccak256(abi.encodePacked("76123454", "448213", "202609"));
        bytes32 b = keccak256(abi.encodePacked("761234544", "48213", "202609"));
        assertEq(a, b, "packed concatenation collides");
        bytes32 a2 = keccak256(abi.encode("76123454", "448213", "202609"));
        bytes32 b2 = keccak256(abi.encode("761234544", "48213", "202609"));
        assertTrue(a2 != b2, "abi.encode keeps them distinct");
    }
}
