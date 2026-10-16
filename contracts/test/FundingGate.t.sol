// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {FundingGate} from "../src/FundingGate.sol";
import {IPDRVerifier} from "../src/IPDRVerifier.sol";
import {IRoles} from "../src/IRoles.sol";
import {TradeEscrow} from "../src/TradeEscrow.sol";
import {KeelHash} from "../src/KeelHash.sol";
import {PurchaseOrder, FundIntent, PolicyDecision} from "../src/KeelTypes.sol";
import {MockUSDC, MockSafe, MockRolesReturnsFalse, MockTradeRoles} from "./mocks/Mocks.sol";
import {MockModuleSafe1271, LeakyAllowanceToken, MockEscrowView} from "./mocks/TradeMocks.sol";
import {ITradeEscrow} from "../src/ITradeEscrow.sol";

/// @notice Unit tests of FundingGate, the Keel Trade gate. Negative tests first, one per check
/// of `execute` and per rule of the trust registries, each with its exact error. Then the happy
/// paths, the three tests of the security goal and a fuzz of the goal.
/// Security goal under test: neither the AI, nor the agent key, nor the policy key, nor the
/// cosigner key (even stolen together) can fund an order that pays a payout address or uses a
/// carrier, arbiter or document verifier the company did not approve; and approving something
/// new always waits `configDelay` with a veto, enforced by the gate itself.
/// The real TradeEscrow is used; Roles is MockTradeRoles (fork tests against Roles v2: T1.7).
contract FundingGateTest is Test {
    bytes32 constant AGENT = keccak256("AGENT");
    bytes32 constant AGENT_COSIGNED = keccak256("AGENT_COSIGNED");
    bytes32 constant POLICY_V1 = keccak256("trade-rules-v1|roles-config-v1");
    uint64 constant DELAY = 120; // demo value; 48 hours documented for production
    uint256 constant AGENT_CAP = 20_000e6;
    uint256 constant COSIGNED_CAP = 200_000e6;
    uint256 constant PERIOD = 30 days;
    uint256 constant TOTAL = 10_000e6;
    uint256 constant BIG = 50_000e6; // over AGENT_CAP, within COSIGNED_CAP
    uint16 constant ADVANCE_BPS = 3000;
    uint64 constant GRACE = 1 days;

    uint8 constant CARRIER = 1;
    uint8 constant ARBITER = 2;
    uint8 constant VERIFIER = 4;

    uint256 ownerPk = 0x0E0E;
    uint256 exporterPk = 0x2222;
    uint256 exporter2Pk = 0x2223;
    uint256 policyPk = 0xA11CE;
    uint256 cosignerPk = 0xC051;
    uint256 attackerPk = 0xBAD;

    address owner;
    address exporter;
    address exporter2;
    address policySigner;
    address cosigner;
    address attacker;
    address relayer = makeAddr("relayer");
    address payout = makeAddr("payout");
    address carrier = makeAddr("carrier");
    address arbiter = makeAddr("arbiter");
    address verifier = makeAddr("verifier");

    MockUSDC usdc;
    TradeEscrow escrow;
    MockModuleSafe1271 safe;
    MockTradeRoles roles;
    FundingGate gate;

    uint256 nextOrderNonce = 1;
    uint256 nextIntentNonce = 1;

    function setUp() public {
        vm.warp(1_760_000_000);
        owner = vm.addr(ownerPk);
        exporter = vm.addr(exporterPk);
        exporter2 = vm.addr(exporter2Pk);
        policySigner = vm.addr(policyPk);
        cosigner = vm.addr(cosignerPk);
        attacker = vm.addr(attackerPk);

        usdc = new MockUSDC();
        escrow = new TradeEscrow(IERC20(address(usdc)), GRACE);
        safe = new MockModuleSafe1271(owner);
        roles = new MockTradeRoles(MockSafe(address(safe)), address(usdc), address(escrow));
        gate = _deployGate(IRoles(address(roles)));
        _wire(roles, gate);

        // Company approves its supplier and the third parties, then waits the delay
        vm.startPrank(address(safe));
        gate.queueSupplier(exporter, payout);
        gate.queueThirdParty(carrier, CARRIER);
        gate.queueThirdParty(arbiter, ARBITER);
        gate.queueThirdParty(verifier, VERIFIER);
        vm.stopPrank();
        vm.warp(vm.getBlockTimestamp() + DELAY);

        usdc.mint(address(safe), 1_000_000e6);
    }

    // ================================================================== helpers

    function _deployGate(IRoles r) internal returns (FundingGate) {
        return
            new FundingGate(address(safe), r, escrow, AGENT, AGENT_COSIGNED, policySigner, cosigner, POLICY_V1, DELAY);
    }

    function _wire(MockTradeRoles r, FundingGate g) internal {
        vm.startPrank(owner);
        safe.enableModule(address(r));
        safe.exec(address(r), abi.encodeCall(MockTradeRoles.assignRole, (AGENT, address(g), true)));
        safe.exec(address(r), abi.encodeCall(MockTradeRoles.assignRole, (AGENT_COSIGNED, address(g), true)));
        safe.exec(address(r), abi.encodeCall(MockTradeRoles.setAllowance, (AGENT, AGENT_CAP, PERIOD)));
        safe.exec(address(r), abi.encodeCall(MockTradeRoles.setAllowance, (AGENT_COSIGNED, COSIGNED_CAP, PERIOD)));
        vm.stopPrank();
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _poCustom(
        address importer_,
        address exporter_,
        address payout_,
        address carrier_,
        address arbiter_,
        address verifier_,
        uint256 amount
    ) internal returns (PurchaseOrder memory po) {
        uint256 n = nextOrderNonce++;
        po = PurchaseOrder({
            orderId: keccak256(abi.encode(importer_, exporter_, n)),
            importer: importer_,
            exporter: exporter_,
            payoutAddress: payout_,
            token: address(usdc),
            totalAmount: amount,
            advanceBps: ADVANCE_BPS,
            shipmentDeadline: uint64(vm.getBlockTimestamp() + 30 days),
            disputeWindow: 7 days,
            carrier: carrier_,
            arbiter: arbiter_,
            documentVerifier: verifier_,
            incoterm: bytes32("FOB"),
            termsHash: keccak256("terms"),
            requiredDocsHash: keccak256("BL+invoice"),
            nonce: n
        });
    }

    /// Opens an order signed by both parties on the real escrow. The importer signs through
    /// its Safe (ERC-1271, owner key); `exporterKey` signs as the exporter.
    function _open(PurchaseOrder memory po, uint256 importerKey, uint256 exporterKey) internal {
        bytes32 digest = KeelHash.digest(KeelHash.domainSeparator(block.chainid, address(escrow)), KeelHash.hash(po));
        bytes memory sigImp = importerKey == ownerPk && po.importer == address(safe)
            ? abi.encode(_rsv(ownerPk, digest))
            : _sign(importerKey, digest);
        escrow.open(po, sigImp, _sign(exporterKey, digest));
    }

    struct Rsv {
        bytes32 r;
        bytes32 s;
        uint8 v;
    }

    function _rsv(uint256 pk, bytes32 digest) internal pure returns (Rsv memory x) {
        (x.v, x.r, x.s) = vm.sign(pk, digest);
    }

    function _order(address payout_, uint256 amount) internal returns (PurchaseOrder memory po) {
        po = _poCustom(address(safe), exporter, payout_, carrier, arbiter, verifier, amount);
        _open(po, ownerPk, exporterPk);
    }

    function _order() internal returns (PurchaseOrder memory) {
        return _order(payout, TOTAL);
    }

    function _intent(PurchaseOrder memory po) internal returns (FundIntent memory i) {
        i = FundIntent({
            orderId: po.orderId,
            orderHash: KeelHash.hash(po),
            escrow: address(escrow),
            token: address(usdc),
            amount: po.totalAmount,
            deadline: uint64(vm.getBlockTimestamp() + 15 minutes),
            nonce: nextIntentNonce++
        });
    }

    /// The calldata hash formula, written independently of the gate: keccak256 of the ABI
    /// encoding of (approve calldata, fund calldata).
    function _calldataHash(FundIntent memory i) internal view returns (bytes32) {
        bytes memory approveData = abi.encodeCall(IERC20.approve, (address(escrow), i.amount));
        bytes memory fundData = abi.encodeCall(TradeEscrow.fund, (i.orderId));
        return keccak256(abi.encode(approveData, fundData));
    }

    function _decision(FundIntent memory i, uint8 tier) internal view returns (PolicyDecision memory) {
        return PolicyDecision({
            intentHash: KeelHash.hash(i),
            calldataHash: _calldataHash(i),
            policyHash: POLICY_V1,
            inputsHash: keccak256("order|registry|allowance"),
            tier: tier,
            expiresAt: uint64(vm.getBlockTimestamp() + 10 minutes)
        });
    }

    function _pdrDigest(FundingGate g, PolicyDecision memory d) internal view returns (bytes32) {
        return KeelHash.digest(KeelHash.domainSeparator(block.chainid, address(g)), KeelHash.hash(d));
    }

    function _exec(FundIntent memory i, PolicyDecision memory d, uint256 policyKey, bytes memory sigCosigner) internal {
        bytes memory sigPolicy = _sign(policyKey, _pdrDigest(gate, d));
        vm.prank(relayer);
        gate.execute(i, d, sigPolicy, sigCosigner);
    }

    /// Signs everything with the policy key (and the cosigner key for tier 3) and executes.
    function _fund(PurchaseOrder memory po, uint8 tier) internal {
        FundIntent memory i = _intent(po);
        PolicyDecision memory d = _decision(i, tier);
        bytes memory sigC = tier == 3 ? _sign(cosignerPk, _pdrDigest(gate, d)) : bytes("");
        _exec(i, d, policyPk, sigC);
    }

    function _expectFundRevert(PurchaseOrder memory po, uint8 tier, bytes4 selector) internal {
        FundIntent memory i = _intent(po);
        PolicyDecision memory d = _decision(i, tier);
        bytes memory sigPolicy = _sign(policyPk, _pdrDigest(gate, d));
        bytes memory sigC = tier == 3 ? _sign(cosignerPk, _pdrDigest(gate, d)) : bytes("");
        vm.expectRevert(selector);
        vm.prank(relayer);
        gate.execute(i, d, sigPolicy, sigC);
    }

    function _state(bytes32 orderId) internal view returns (uint8) {
        return uint8(escrow.orderOf(orderId).state);
    }

    // ================================================================== execute: negative

    function test_revert_GateIsPaused() public {
        PurchaseOrder memory po = _order();
        vm.prank(address(safe));
        gate.pause();
        _expectFundRevert(po, 1, IPDRVerifier.GateIsPaused.selector);
    }

    function test_revert_IntentMismatch_amountChangedAfterSigning() public {
        PurchaseOrder memory po = _order();
        FundIntent memory i = _intent(po);
        PolicyDecision memory d = _decision(i, 1);
        i.amount += 1;
        bytes memory sig = _sign(policyPk, _pdrDigest(gate, d));
        vm.expectRevert(IPDRVerifier.IntentMismatch.selector);
        gate.execute(i, d, sig, "");
    }

    function test_revert_OrderMismatch_otherEscrow() public {
        PurchaseOrder memory po = _order();
        FundIntent memory i = _intent(po);
        i.escrow = address(new TradeEscrow(IERC20(address(usdc)), GRACE));
        PolicyDecision memory d = _decision(i, 1);
        bytes memory sig = _sign(policyPk, _pdrDigest(gate, d));
        vm.expectRevert(FundingGate.OrderMismatch.selector);
        gate.execute(i, d, sig, "");
    }

    function test_revert_OrderMismatch_otherToken() public {
        PurchaseOrder memory po = _order();
        FundIntent memory i = _intent(po);
        i.token = address(new MockUSDC());
        PolicyDecision memory d = _decision(i, 1);
        bytes memory sig = _sign(policyPk, _pdrDigest(gate, d));
        vm.expectRevert(FundingGate.OrderMismatch.selector);
        gate.execute(i, d, sig, "");
    }

    function test_revert_OrderNotOpen_neverOpened() public {
        PurchaseOrder memory po = _poCustom(address(safe), exporter, payout, carrier, arbiter, verifier, TOTAL);
        _expectFundRevert(po, 1, FundingGate.OrderNotOpen.selector);
    }

    function test_revert_OrderNotOpen_alreadyFunded() public {
        PurchaseOrder memory po = _order();
        _fund(po, 1);
        _expectFundRevert(po, 1, FundingGate.OrderNotOpen.selector);
    }

    function test_revert_OrderMismatch_orderHashOfAnotherVersion() public {
        PurchaseOrder memory po = _order();
        FundIntent memory i = _intent(po);
        PurchaseOrder memory other = po;
        other.termsHash = keccak256("other terms");
        i.orderHash = KeelHash.hash(other);
        PolicyDecision memory d = _decision(i, 1);
        bytes memory sig = _sign(policyPk, _pdrDigest(gate, d));
        vm.expectRevert(FundingGate.OrderMismatch.selector);
        gate.execute(i, d, sig, "");
    }

    function test_revert_OrderMismatch_amountBelowOrderTotal() public {
        PurchaseOrder memory po = _order();
        FundIntent memory i = _intent(po);
        i.amount = po.totalAmount - 1;
        PolicyDecision memory d = _decision(i, 1);
        bytes memory sig = _sign(policyPk, _pdrDigest(gate, d));
        vm.expectRevert(FundingGate.OrderMismatch.selector);
        gate.execute(i, d, sig, "");
    }

    function test_revert_OrderMismatch_storedOrderWithAnotherToken() public {
        // Unreachable with the real TradeEscrow (open requires po.token == escrow token): an
        // escrow stand-in returns an open order of this Safe whose token is not the gate token
        MockEscrowView ev = new MockEscrowView(address(usdc));
        FundingGate g = new FundingGate(
            address(safe),
            IRoles(address(roles)),
            TradeEscrow(address(ev)),
            AGENT,
            AGENT_COSIGNED,
            policySigner,
            cosigner,
            POLICY_V1,
            DELAY
        );
        _trustDefaults(g);
        PurchaseOrder memory po = _poCustom(address(safe), exporter, payout, carrier, arbiter, verifier, TOTAL);
        po.token = address(new MockUSDC());
        ITradeEscrow.OrderRecord memory r;
        r.po = po;
        r.state = ITradeEscrow.State.OPEN;
        r.orderHash = KeelHash.hash(po);
        ev.setRecord(r);
        FundIntent memory i = FundIntent({
            orderId: po.orderId,
            orderHash: r.orderHash,
            escrow: address(ev),
            token: address(usdc),
            amount: TOTAL,
            deadline: uint64(vm.getBlockTimestamp() + 15 minutes),
            nonce: nextIntentNonce++
        });
        PolicyDecision memory d = _decision(i, 1);
        bytes memory sig = _sign(policyPk, _pdrDigest(g, d));
        vm.expectRevert(FundingGate.OrderMismatch.selector);
        g.execute(i, d, sig, "");
    }

    function test_revert_NotOwnOrder_importerIsAnotherCompany() public {
        uint256 otherPk = 0x0123;
        PurchaseOrder memory po = _poCustom(vm.addr(otherPk), exporter, payout, carrier, arbiter, verifier, TOTAL);
        _open(po, otherPk, exporterPk);
        _expectFundRevert(po, 1, FundingGate.NotOwnOrder.selector);
    }

    function test_revert_UnknownSupplier_newPayoutAddress() public {
        PurchaseOrder memory po = _order(makeAddr("newPayout"), TOTAL);
        _expectFundRevert(po, 1, FundingGate.UnknownSupplier.selector);
    }

    function test_revert_UnknownSupplier_knownPayoutWithAnotherExporter() public {
        // The pair matters: the payout address of a known supplier, signed by another exporter
        PurchaseOrder memory po = _poCustom(address(safe), exporter2, payout, carrier, arbiter, verifier, TOTAL);
        _open(po, ownerPk, exporter2Pk);
        _expectFundRevert(po, 1, FundingGate.UnknownSupplier.selector);
    }

    function test_revert_UntrustedParty_carrier() public {
        PurchaseOrder memory po =
            _poCustom(address(safe), exporter, payout, makeAddr("newCarrier"), arbiter, verifier, TOTAL);
        _open(po, ownerPk, exporterPk);
        _expectFundRevert(po, 1, FundingGate.UntrustedParty.selector);
    }

    function test_revert_UntrustedParty_arbiter() public {
        PurchaseOrder memory po =
            _poCustom(address(safe), exporter, payout, carrier, makeAddr("newArbiter"), verifier, TOTAL);
        _open(po, ownerPk, exporterPk);
        _expectFundRevert(po, 1, FundingGate.UntrustedParty.selector);
    }

    function test_revert_UntrustedParty_verifier() public {
        PurchaseOrder memory po =
            _poCustom(address(safe), exporter, payout, carrier, arbiter, makeAddr("newVerifier"), TOTAL);
        _open(po, ownerPk, exporterPk);
        _expectFundRevert(po, 1, FundingGate.UntrustedParty.selector);
    }

    function test_revert_UntrustedParty_trustedForAnotherRole() public {
        // `verifier` is trusted only as VERIFIER; it cannot be the carrier of an order
        address thirdVerifier = makeAddr("verifier2");
        vm.prank(address(safe));
        gate.queueThirdParty(thirdVerifier, VERIFIER);
        vm.warp(vm.getBlockTimestamp() + DELAY);
        PurchaseOrder memory po = _poCustom(address(safe), exporter, payout, verifier, arbiter, thirdVerifier, TOTAL);
        _open(po, ownerPk, exporterPk);
        _expectFundRevert(po, 1, FundingGate.UntrustedParty.selector);
    }

    function test_revert_CalldataMismatch() public {
        PurchaseOrder memory po = _order();
        FundIntent memory i = _intent(po);
        PolicyDecision memory d = _decision(i, 1);
        // The engine approved an unlimited allowance instead of the exact amount
        d.calldataHash = keccak256(
            abi.encode(
                abi.encodeCall(IERC20.approve, (address(escrow), type(uint256).max)),
                abi.encodeCall(TradeEscrow.fund, (i.orderId))
            )
        );
        bytes memory sig = _sign(policyPk, _pdrDigest(gate, d));
        vm.expectRevert(IPDRVerifier.CalldataMismatch.selector);
        gate.execute(i, d, sig, "");
    }

    function test_revert_InvalidTier() public {
        PurchaseOrder memory po = _order();
        _expectFundRevert(po, 2, IPDRVerifier.InvalidTier.selector);
    }

    function test_revert_BadPolicySignature_attackerKey() public {
        PurchaseOrder memory po = _order();
        FundIntent memory i = _intent(po);
        PolicyDecision memory d = _decision(i, 1);
        bytes memory sig = _sign(attackerPk, _pdrDigest(gate, d));
        vm.expectRevert(IPDRVerifier.BadPolicySignature.selector);
        gate.execute(i, d, sig, "");
    }

    function test_revert_BadPolicySignature_cosignerCannotActAsPolicy() public {
        PurchaseOrder memory po = _order();
        FundIntent memory i = _intent(po);
        PolicyDecision memory d = _decision(i, 1);
        bytes memory sig = _sign(cosignerPk, _pdrDigest(gate, d));
        vm.expectRevert(IPDRVerifier.BadPolicySignature.selector);
        gate.execute(i, d, sig, "");
    }

    function test_revert_StalePolicy() public {
        PurchaseOrder memory po = _order();
        vm.prank(address(safe));
        gate.setPolicyHash(keccak256("trade-rules-v2"));
        _expectFundRevert(po, 1, IPDRVerifier.StalePolicy.selector);
    }

    function test_revert_Expired_decision() public {
        PurchaseOrder memory po = _order();
        FundIntent memory i = _intent(po);
        PolicyDecision memory d = _decision(i, 1);
        bytes memory sig = _sign(policyPk, _pdrDigest(gate, d));
        vm.warp(d.expiresAt + 1);
        vm.expectRevert(IPDRVerifier.Expired.selector);
        gate.execute(i, d, sig, "");
    }

    function test_revert_Expired_intentDeadline() public {
        PurchaseOrder memory po = _order();
        FundIntent memory i = _intent(po);
        i.deadline = uint64(vm.getBlockTimestamp() - 1);
        PolicyDecision memory d = _decision(i, 1);
        bytes memory sig = _sign(policyPk, _pdrDigest(gate, d));
        vm.expectRevert(IPDRVerifier.Expired.selector);
        gate.execute(i, d, sig, "");
    }

    function test_revert_NonceUsed_sameNonceOnAnotherOrder() public {
        PurchaseOrder memory po1 = _order();
        PurchaseOrder memory po2 = _order();
        FundIntent memory i1 = _intent(po1);
        _exec(i1, _decision(i1, 1), policyPk, "");
        FundIntent memory i2 = _intent(po2);
        i2.nonce = i1.nonce;
        PolicyDecision memory d2 = _decision(i2, 1);
        bytes memory sig = _sign(policyPk, _pdrDigest(gate, d2));
        vm.expectRevert(IPDRVerifier.NonceUsed.selector);
        gate.execute(i2, d2, sig, "");
    }

    function test_revert_MissingCosignature_tier3WithoutCosigner() public {
        PurchaseOrder memory po = _order(payout, BIG);
        FundIntent memory i = _intent(po);
        PolicyDecision memory d = _decision(i, 3);
        bytes memory sig = _sign(policyPk, _pdrDigest(gate, d));
        vm.expectRevert(IPDRVerifier.MissingCosignature.selector);
        gate.execute(i, d, sig, "");
    }

    function test_revert_MissingCosignature_policyKeyAsCosigner() public {
        PurchaseOrder memory po = _order(payout, BIG);
        FundIntent memory i = _intent(po);
        PolicyDecision memory d = _decision(i, 3);
        bytes memory sig = _sign(policyPk, _pdrDigest(gate, d));
        vm.expectRevert(IPDRVerifier.MissingCosignature.selector);
        gate.execute(i, d, sig, sig);
    }

    function test_revert_AllowanceExceeded_tier1OverAgentCap() public {
        // Tier 1 runs with the AGENT role: Roles rejects an amount over its allowance
        PurchaseOrder memory po = _order(payout, BIG);
        FundIntent memory i = _intent(po);
        PolicyDecision memory d = _decision(i, 1);
        bytes memory sig = _sign(policyPk, _pdrDigest(gate, d));
        // Same Status and info shape as the real Roles on the fork: AllowanceExceeded with the key
        vm.expectRevert(abi.encodeWithSelector(MockTradeRoles.ConditionViolation.selector, uint8(17), AGENT));
        gate.execute(i, d, sig, "");
    }

    function test_revert_NoMembership_tier3UsesTheCosignedRole() public {
        // Without membership in AGENT_COSIGNED, tier 3 fails even with a valid cosignature
        vm.prank(owner);
        safe.exec(address(roles), abi.encodeCall(MockTradeRoles.assignRole, (AGENT_COSIGNED, address(gate), false)));
        PurchaseOrder memory po = _order();
        _expectFundRevert(po, 3, MockTradeRoles.NoMembership.selector);
    }

    function test_revert_ExecutionFailed_rolesReturnsFalseOnApprove() public {
        FundingGate g = _deployGate(IRoles(address(new MockRolesReturnsFalse())));
        _trustDefaults(g);
        PurchaseOrder memory po = _order();
        FundIntent memory i = _intent(po);
        PolicyDecision memory d = _decision(i, 1);
        bytes memory sig = _sign(policyPk, _pdrDigest(g, d));
        vm.expectRevert(IPDRVerifier.ExecutionFailed.selector);
        g.execute(i, d, sig, "");
    }

    function test_revert_ExecutionFailed_rolesReturnsFalseOnApproveOnly() public {
        // Roles reports the approve as failed (without running it) but would run the fund
        roles.setReturnFalseFor(address(usdc));
        PurchaseOrder memory po = _order();
        _expectFundRevert(po, 1, IPDRVerifier.ExecutionFailed.selector);
        assertEq(_state(po.orderId), 1, "order still OPEN");
    }

    function test_revert_ExecutionFailed_rolesReturnsFalseOnFund() public {
        roles.setReturnFalseFor(address(escrow));
        PurchaseOrder memory po = _order();
        _expectFundRevert(po, 1, IPDRVerifier.ExecutionFailed.selector);
        assertEq(_state(po.orderId), 1, "order still OPEN");
        assertEq(usdc.allowance(address(safe), address(escrow)), 0, "approve rolled back");
    }

    function test_revert_AllowanceNotConsumed() public {
        // A token whose transferFrom does not spend the allowance: the gate refuses to leave
        // an approval behind after the deposit
        LeakyAllowanceToken leaky = new LeakyAllowanceToken();
        TradeEscrow e2 = new TradeEscrow(IERC20(address(leaky)), GRACE);
        MockTradeRoles r2 = new MockTradeRoles(MockSafe(address(safe)), address(leaky), address(e2));
        FundingGate g2 = new FundingGate(
            address(safe), IRoles(address(r2)), e2, AGENT, AGENT_COSIGNED, policySigner, cosigner, POLICY_V1, DELAY
        );
        _wire(r2, g2);
        _trustDefaults(g2);
        leaky.mint(address(safe), TOTAL);

        PurchaseOrder memory po = _poCustom(address(safe), exporter, payout, carrier, arbiter, verifier, TOTAL);
        po.token = address(leaky);
        bytes32 digest = KeelHash.digest(KeelHash.domainSeparator(block.chainid, address(e2)), KeelHash.hash(po));
        e2.open(po, abi.encode(_rsv(ownerPk, digest)), _sign(exporterPk, digest));

        FundIntent memory i = FundIntent({
            orderId: po.orderId,
            orderHash: KeelHash.hash(po),
            escrow: address(e2),
            token: address(leaky),
            amount: TOTAL,
            deadline: uint64(vm.getBlockTimestamp() + 15 minutes),
            nonce: nextIntentNonce++
        });
        PolicyDecision memory d = PolicyDecision({
            intentHash: KeelHash.hash(i),
            calldataHash: keccak256(
                abi.encode(
                    abi.encodeCall(IERC20.approve, (address(e2), TOTAL)), abi.encodeCall(TradeEscrow.fund, (po.orderId))
                )
            ),
            policyHash: POLICY_V1,
            inputsHash: bytes32(0),
            tier: 1,
            expiresAt: uint64(vm.getBlockTimestamp() + 10 minutes)
        });
        bytes memory sig = _sign(policyPk, _pdrDigest(g2, d));
        vm.expectRevert(FundingGate.AllowanceNotConsumed.selector);
        g2.execute(i, d, sig, "");
    }

    /// Queues and activates the default supplier and third parties on another gate.
    function _trustDefaults(FundingGate g) internal {
        vm.startPrank(address(safe));
        g.queueSupplier(exporter, payout);
        g.queueThirdParty(carrier, CARRIER);
        g.queueThirdParty(arbiter, ARBITER);
        g.queueThirdParty(verifier, VERIFIER);
        vm.stopPrank();
        vm.warp(vm.getBlockTimestamp() + DELAY);
    }

    // ================================================================== registries: negative

    function test_revert_OnlySafe_queueSupplierByAttacker() public {
        vm.expectRevert(IPDRVerifier.OnlySafe.selector);
        vm.prank(attacker);
        gate.queueSupplier(exporter, makeAddr("p"));
    }

    function test_revert_OnlySafe_cosignerCannotQueueSupplier() public {
        vm.expectRevert(IPDRVerifier.OnlySafe.selector);
        vm.prank(cosigner);
        gate.queueSupplier(exporter, makeAddr("p"));
    }

    function test_revert_OnlySafe_cosignerCannotQueueThirdParty() public {
        vm.expectRevert(IPDRVerifier.OnlySafe.selector);
        vm.prank(cosigner);
        gate.queueThirdParty(makeAddr("c"), CARRIER);
    }

    function test_revert_OnlySafe_cosignerCannotRemove() public {
        vm.expectRevert(IPDRVerifier.OnlySafe.selector);
        vm.prank(cosigner);
        gate.removeSupplier(exporter, payout);
        vm.expectRevert(IPDRVerifier.OnlySafe.selector);
        vm.prank(cosigner);
        gate.removeThirdParty(carrier, CARRIER);
    }

    function test_revert_ZeroAddress_queue() public {
        vm.startPrank(address(safe));
        vm.expectRevert(IPDRVerifier.ZeroAddress.selector);
        gate.queueSupplier(address(0), payout);
        vm.expectRevert(IPDRVerifier.ZeroAddress.selector);
        gate.queueSupplier(exporter, address(0));
        vm.expectRevert(IPDRVerifier.ZeroAddress.selector);
        gate.queueThirdParty(address(0), CARRIER);
        vm.stopPrank();
    }

    function test_revert_InvalidRoles() public {
        vm.startPrank(address(safe));
        vm.expectRevert(FundingGate.InvalidRoles.selector);
        gate.queueThirdParty(makeAddr("c"), 0);
        vm.expectRevert(FundingGate.InvalidRoles.selector);
        gate.queueThirdParty(makeAddr("c"), 8);
        vm.expectRevert(FundingGate.InvalidRoles.selector);
        gate.removeThirdParty(carrier, 0);
        vm.stopPrank();
        vm.expectRevert(FundingGate.InvalidRoles.selector);
        gate.hasRole(carrier, CARRIER | ARBITER);
    }

    function test_revert_AlreadyRegistered_activeOrPending() public {
        vm.startPrank(address(safe));
        vm.expectRevert(FundingGate.AlreadyRegistered.selector);
        gate.queueSupplier(exporter, payout); // active
        address p2 = makeAddr("p2");
        gate.queueSupplier(exporter, p2);
        vm.expectRevert(FundingGate.AlreadyRegistered.selector);
        gate.queueSupplier(exporter, p2); // pending
        vm.expectRevert(FundingGate.AlreadyRegistered.selector);
        gate.queueThirdParty(carrier, CARRIER | ARBITER); // CARRIER already active
        vm.stopPrank();
    }

    function test_revert_NotRegistered_remove() public {
        vm.startPrank(address(safe));
        vm.expectRevert(FundingGate.NotRegistered.selector);
        gate.removeSupplier(exporter, makeAddr("never"));
        vm.expectRevert(FundingGate.NotRegistered.selector);
        gate.removeThirdParty(carrier, ARBITER);
        vm.stopPrank();
    }

    function test_revert_UnknownSupplier_fundingRightAfterQueueing() public {
        address p2 = makeAddr("p2");
        vm.prank(address(safe));
        gate.queueSupplier(exporter, p2);
        PurchaseOrder memory po = _order(p2, TOTAL);
        _expectFundRevert(po, 1, FundingGate.UnknownSupplier.selector);
    }

    function test_revert_UnknownSupplier_oneSecondBeforeActivation() public {
        address p2 = makeAddr("p2");
        vm.prank(address(safe));
        uint256 id = gate.queueSupplier(exporter, p2);
        (,,,, uint64 activatesAt,) = gate.changes(id);
        assertEq(activatesAt, vm.getBlockTimestamp() + DELAY);
        vm.warp(activatesAt - 1);
        assertFalse(gate.isKnownSupplier(exporter, p2));
        PurchaseOrder memory po = _order(p2, TOTAL);
        _expectFundRevert(po, 1, FundingGate.UnknownSupplier.selector);
        vm.warp(activatesAt);
        assertTrue(gate.isKnownSupplier(exporter, p2));
        _fund(po, 1);
        assertEq(_state(po.orderId), 2, "ADVANCE_PAID at the activation time");
    }

    function test_revert_UntrustedParty_thirdPartyNotYetActive() public {
        address c2 = makeAddr("c2");
        vm.prank(address(safe));
        gate.queueThirdParty(c2, CARRIER);
        vm.warp(vm.getBlockTimestamp() + DELAY - 1);
        PurchaseOrder memory po = _poCustom(address(safe), exporter, payout, c2, arbiter, verifier, TOTAL);
        _open(po, ownerPk, exporterPk);
        _expectFundRevert(po, 1, FundingGate.UntrustedParty.selector);
    }

    function test_veto_byCosignerKeepsSupplierUnknown() public {
        address p2 = makeAddr("p2");
        vm.prank(address(safe));
        uint256 id = gate.queueSupplier(exporter, p2);
        vm.expectEmit(address(gate));
        emit FundingGate.ChangeVetoed(id, cosigner);
        vm.prank(cosigner);
        gate.vetoPending(id);
        vm.warp(vm.getBlockTimestamp() + DELAY * 10);
        assertFalse(gate.isKnownSupplier(exporter, p2));
        PurchaseOrder memory po = _order(p2, TOTAL);
        _expectFundRevert(po, 1, FundingGate.UnknownSupplier.selector);
    }

    function test_veto_byCosignerKeepsThirdPartyUntrusted() public {
        address c2 = makeAddr("c2");
        vm.prank(address(safe));
        uint256 id = gate.queueThirdParty(c2, CARRIER | ARBITER);
        vm.prank(cosigner);
        gate.vetoPending(id);
        vm.warp(vm.getBlockTimestamp() + DELAY);
        assertFalse(gate.hasRole(c2, CARRIER));
        assertFalse(gate.hasRole(c2, ARBITER));
    }

    function test_veto_bySafe() public {
        address p2 = makeAddr("p2");
        vm.startPrank(address(safe));
        uint256 id = gate.queueSupplier(exporter, p2);
        vm.expectEmit(address(gate));
        emit FundingGate.ChangeVetoed(id, address(safe));
        gate.vetoPending(id);
        vm.stopPrank();
        (,,,,, bool vetoed) = gate.changes(id);
        assertTrue(vetoed, "the app can read that the change was vetoed");
        vm.warp(vm.getBlockTimestamp() + DELAY);
        assertFalse(gate.isKnownSupplier(exporter, p2));
    }

    function test_revert_OnlySafeOrCosigner_vetoByAttacker() public {
        vm.prank(address(safe));
        uint256 id = gate.queueSupplier(exporter, makeAddr("p2"));
        vm.expectRevert(FundingGate.OnlySafeOrCosigner.selector);
        vm.prank(attacker);
        gate.vetoPending(id);
    }

    function test_revert_OnlySafeOrCosigner_vetoByPolicySigner() public {
        vm.prank(address(safe));
        uint256 id = gate.queueSupplier(exporter, makeAddr("p2"));
        vm.expectRevert(FundingGate.OnlySafeOrCosigner.selector);
        vm.prank(policySigner);
        gate.vetoPending(id);
    }

    function test_revert_ChangeNotPending_afterActivation() public {
        address p2 = makeAddr("p2");
        vm.prank(address(safe));
        uint256 id = gate.queueSupplier(exporter, p2);
        vm.warp(vm.getBlockTimestamp() + DELAY);
        vm.expectRevert(FundingGate.ChangeNotPending.selector);
        vm.prank(cosigner);
        gate.vetoPending(id);
        assertTrue(gate.isKnownSupplier(exporter, p2));
    }

    function test_revert_ChangeNotPending_unknownIdAndDoubleVeto() public {
        vm.expectRevert(FundingGate.ChangeNotPending.selector);
        vm.prank(cosigner);
        gate.vetoPending(999);

        vm.prank(address(safe));
        uint256 id = gate.queueSupplier(exporter, makeAddr("p2"));
        vm.prank(cosigner);
        gate.vetoPending(id);
        vm.expectRevert(FundingGate.ChangeNotPending.selector);
        vm.prank(cosigner);
        gate.vetoPending(id);
    }

    function test_revert_ChangeNotPending_removedBeforeVeto() public {
        address p2 = makeAddr("p2");
        vm.startPrank(address(safe));
        uint256 id = gate.queueSupplier(exporter, p2);
        gate.removeSupplier(exporter, p2);
        vm.stopPrank();
        vm.expectRevert(FundingGate.ChangeNotPending.selector);
        vm.prank(cosigner);
        gate.vetoPending(id);
    }

    function test_veto_isIndividual() public {
        address p2 = makeAddr("p2");
        address p3 = makeAddr("p3");
        address c2 = makeAddr("c2");
        vm.startPrank(address(safe));
        uint256 id2 = gate.queueSupplier(exporter, p2);
        uint256 id3 = gate.queueSupplier(exporter, p3);
        uint256 idC = gate.queueThirdParty(c2, CARRIER);
        vm.stopPrank();
        assertTrue(id2 != id3 && id3 != idC);

        vm.prank(cosigner);
        gate.vetoPending(id2);
        vm.warp(vm.getBlockTimestamp() + DELAY);
        assertFalse(gate.isKnownSupplier(exporter, p2), "vetoed");
        assertTrue(gate.isKnownSupplier(exporter, p3), "other supplier change unaffected");
        assertTrue(gate.hasRole(c2, CARRIER), "other third party change unaffected");
        _fund(_order(p3, TOTAL), 1);
    }

    function test_veto_oldIdDoesNotAffectRequeuedChange() public {
        address p2 = makeAddr("p2");
        vm.prank(address(safe));
        uint256 oldId = gate.queueSupplier(exporter, p2);
        vm.prank(cosigner);
        gate.vetoPending(oldId);

        vm.prank(address(safe));
        uint256 newId = gate.queueSupplier(exporter, p2);
        assertTrue(newId != oldId, "changeId is a counter, never reused");
        assertEq(newId, oldId + 1, "the counter only goes up");
        (FundingGate.ChangeKind kind1, address subject1,,,,) = gate.changes(1);
        assertEq(uint8(kind1), uint8(FundingGate.ChangeKind.SUPPLIER), "change 1 untouched");
        assertEq(subject1, exporter, "change 1 untouched");

        vm.expectRevert(FundingGate.ChangeNotPending.selector);
        vm.prank(cosigner);
        gate.vetoPending(oldId);

        vm.warp(vm.getBlockTimestamp() + DELAY);
        assertTrue(gate.isKnownSupplier(exporter, p2), "new change activates");
    }

    function test_removeSupplier_isImmediate() public {
        PurchaseOrder memory po = _order();
        vm.expectEmit(address(gate));
        emit FundingGate.SupplierRemoved(exporter, payout);
        vm.prank(address(safe));
        gate.removeSupplier(exporter, payout);
        assertFalse(gate.isKnownSupplier(exporter, payout));
        _expectFundRevert(po, 1, FundingGate.UnknownSupplier.selector);
    }

    function test_removeThirdParty_isImmediate() public {
        PurchaseOrder memory po = _order();
        vm.expectEmit(address(gate));
        emit FundingGate.ThirdPartyRemoved(carrier, CARRIER);
        vm.prank(address(safe));
        gate.removeThirdParty(carrier, CARRIER);
        assertFalse(gate.hasRole(carrier, CARRIER));
        _expectFundRevert(po, 1, FundingGate.UntrustedParty.selector);
    }

    function test_removeThirdParty_onlyGivenRoles() public {
        address c2 = makeAddr("c2");
        vm.startPrank(address(safe));
        gate.queueThirdParty(c2, CARRIER | ARBITER);
        vm.warp(vm.getBlockTimestamp() + DELAY);
        gate.removeThirdParty(c2, ARBITER | VERIFIER); // VERIFIER was never there
        vm.stopPrank();
        assertTrue(gate.hasRole(c2, CARRIER));
        assertFalse(gate.hasRole(c2, ARBITER));
    }

    function test_queue_emitsEverythingTheBotNeeds() public {
        address p2 = makeAddr("p2");
        address c2 = makeAddr("c2");
        uint64 at = uint64(vm.getBlockTimestamp() + DELAY);
        uint256 next = gate.changeCount() + 1;
        vm.startPrank(address(safe));
        vm.expectEmit(address(gate));
        emit FundingGate.ChangeQueued(next, FundingGate.ChangeKind.SUPPLIER, exporter, p2, 0, at);
        gate.queueSupplier(exporter, p2);
        vm.expectEmit(address(gate));
        emit FundingGate.ChangeQueued(
            next + 1, FundingGate.ChangeKind.THIRD_PARTY, c2, address(0), CARRIER | VERIFIER, at
        );
        gate.queueThirdParty(c2, CARRIER | VERIFIER);
        vm.stopPrank();
    }

    // ================================================================== pause

    function test_emergencyPause_byCosigner() public {
        vm.expectEmit(address(gate));
        emit IPDRVerifier.GatePaused(cosigner);
        vm.prank(cosigner);
        gate.emergencyPause();
        assertTrue(gate.paused());
        PurchaseOrder memory po = _order();
        _expectFundRevert(po, 1, IPDRVerifier.GateIsPaused.selector);
    }

    function test_revert_OnlySafeOrCosigner_emergencyPauseByAttacker() public {
        vm.expectRevert(FundingGate.OnlySafeOrCosigner.selector);
        vm.prank(attacker);
        gate.emergencyPause();
    }

    function test_revert_OnlySafe_cosignerCannotUnpause() public {
        vm.prank(cosigner);
        gate.emergencyPause();
        vm.expectRevert(IPDRVerifier.OnlySafe.selector);
        vm.prank(cosigner);
        gate.unpause();
        vm.prank(address(safe));
        gate.unpause();
        assertFalse(gate.paused());
    }

    function test_revert_OnlySafe_configSetters() public {
        vm.startPrank(attacker);
        vm.expectRevert(IPDRVerifier.OnlySafe.selector);
        gate.pause();
        vm.expectRevert(IPDRVerifier.OnlySafe.selector);
        gate.setPolicySigner(attacker);
        vm.expectRevert(IPDRVerifier.OnlySafe.selector);
        gate.setCosigner(attacker);
        vm.expectRevert(IPDRVerifier.OnlySafe.selector);
        gate.setPolicyHash(bytes32(0));
        vm.stopPrank();
    }

    // ================================================================== constructor

    /// External on purpose: `vm.expectRevert` followed by a reverting `new` inside the test body
    /// ends the whole test (Foundry turns `new` into deployCode), so later cases would never run.
    /// Calling through `this` makes each expected revert apply to one call and the test go on.
    function deployGate(address safe_, IRoles r, TradeEscrow e, address p, address c, uint64 delay)
        external
        returns (FundingGate)
    {
        return new FundingGate(safe_, r, e, AGENT, AGENT_COSIGNED, p, c, POLICY_V1, delay);
    }

    function test_revert_constructor_ZeroAddress() public {
        IRoles r = IRoles(address(roles));
        vm.expectRevert(IPDRVerifier.ZeroAddress.selector);
        this.deployGate(address(0), r, escrow, policySigner, cosigner, DELAY);
        vm.expectRevert(IPDRVerifier.ZeroAddress.selector);
        this.deployGate(address(safe), IRoles(address(0)), escrow, policySigner, cosigner, DELAY);
        vm.expectRevert(IPDRVerifier.ZeroAddress.selector);
        this.deployGate(address(safe), r, TradeEscrow(address(0)), policySigner, cosigner, DELAY);
        vm.expectRevert(IPDRVerifier.ZeroAddress.selector);
        this.deployGate(address(safe), r, escrow, address(0), cosigner, DELAY);
        vm.expectRevert(IPDRVerifier.ZeroAddress.selector);
        this.deployGate(address(safe), r, escrow, policySigner, address(0), DELAY);
        // and the same arguments without zeros deploy
        assertEq(this.deployGate(address(safe), r, escrow, policySigner, cosigner, DELAY).configDelay(), DELAY);
    }

    function test_revert_constructor_SignerIsCosigner() public {
        vm.expectRevert(IPDRVerifier.SignerIsCosigner.selector);
        new FundingGate(
            address(safe), IRoles(address(roles)), escrow, AGENT, AGENT_COSIGNED, cosigner, cosigner, POLICY_V1, DELAY
        );
    }

    function test_revert_constructor_SameRoleKey() public {
        vm.expectRevert(FundingGate.SameRoleKey.selector);
        new FundingGate(
            address(safe), IRoles(address(roles)), escrow, AGENT, AGENT, policySigner, cosigner, POLICY_V1, DELAY
        );
    }

    function test_revert_constructor_InvalidDelay() public {
        vm.expectRevert(FundingGate.InvalidDelay.selector);
        new FundingGate(
            address(safe), IRoles(address(roles)), escrow, AGENT, AGENT_COSIGNED, policySigner, cosigner, POLICY_V1, 0
        );
    }

    function test_revert_constructor_InvalidDelay_atTheMinimumBoundary() public {
        assertEq(gate.MIN_CONFIG_DELAY(), 60);
        IRoles r = IRoles(address(roles));
        vm.expectRevert(FundingGate.InvalidDelay.selector);
        this.deployGate(address(safe), r, escrow, policySigner, cosigner, 59);
        FundingGate g = this.deployGate(address(safe), r, escrow, policySigner, cosigner, 60);
        assertEq(g.configDelay(), 60);
    }

    function test_constructor_takesTheTokenFromTheEscrow() public view {
        assertEq(address(gate.token()), address(usdc));
        assertEq(address(gate.escrow()), address(escrow));
        assertEq(gate.configDelay(), DELAY);
    }

    // ================================================================== happy paths

    function test_tier1_fundsKnownSupplier() public {
        PurchaseOrder memory po = _order();
        FundIntent memory i = _intent(po);
        PolicyDecision memory d = _decision(i, 1);
        bytes32 pdrHash = _pdrDigest(gate, d);
        uint256 safeBefore = usdc.balanceOf(address(safe));

        vm.expectEmit(address(gate));
        emit FundingGate.FundingExecuted(KeelHash.hash(i), pdrHash, 1, po.orderId);
        _exec(i, d, policyPk, "");

        uint256 advance = (TOTAL * ADVANCE_BPS) / 10_000;
        assertEq(_state(po.orderId), 2, "ADVANCE_PAID");
        assertEq(usdc.balanceOf(address(safe)), safeBefore - TOTAL);
        assertEq(usdc.balanceOf(payout), advance);
        assertEq(usdc.balanceOf(address(escrow)), TOTAL - advance);
        assertEq(usdc.allowance(address(safe), address(escrow)), 0);
        assertEq(roles.remaining(AGENT), AGENT_CAP - TOTAL, "tier 1 spends the AGENT allowance");
        assertEq(roles.remaining(AGENT_COSIGNED), COSIGNED_CAP);
        assertTrue(gate.nonceUsed(i.nonce));
    }

    function test_tier3_fundsOverAgentCapWithCosignedRole() public {
        PurchaseOrder memory po = _order(payout, BIG);
        _fund(po, 3);
        assertEq(_state(po.orderId), 2, "ADVANCE_PAID");
        assertEq(roles.remaining(AGENT), AGENT_CAP, "AGENT allowance untouched");
        assertEq(roles.remaining(AGENT_COSIGNED), COSIGNED_CAP - BIG);
    }

    function test_onboarding_queueWaitFund() public {
        address p2 = makeAddr("p2");
        vm.prank(address(safe));
        gate.queueSupplier(exporter, p2);
        PurchaseOrder memory po = _order(p2, TOTAL);
        _expectFundRevert(po, 1, FundingGate.UnknownSupplier.selector);
        vm.warp(vm.getBlockTimestamp() + DELAY);
        _fund(po, 1);
        assertEq(usdc.balanceOf(p2), (TOTAL * ADVANCE_BPS) / 10_000);
    }

    function test_fundingCalldataOf_matchesTheEngineFormula() public {
        PurchaseOrder memory po = _order();
        FundIntent memory i = _intent(po);
        (bytes memory approveData, bytes memory fundData, bytes32 h) = gate.fundingCalldataOf(i);
        assertEq(approveData, abi.encodeCall(IERC20.approve, (address(escrow), i.amount)));
        assertEq(fundData, abi.encodeCall(TradeEscrow.fund, (i.orderId)));
        assertEq(h, _calldataHash(i));
    }

    function test_views_matchIndependentHashes() public {
        PurchaseOrder memory po = _order();
        FundIntent memory i = _intent(po);
        PolicyDecision memory d = _decision(i, 1);
        assertEq(gate.intentHashOf(i), KeelHash.hash(i));
        assertEq(gate.digestOf(d), _pdrDigest(gate, d));
        assertEq(gate.domainSeparator(), KeelHash.domainSeparator(block.chainid, address(gate)));
    }

    // ================================================================== security goal

    /// Stolen policy key: a PDR for an order (signed by both parties, for example after a
    /// "our account changed" email) that pays a new payout address does not execute.
    function test_goal_stolenPolicyKey_newPayoutReverts() public {
        address attackerPayout = vm.addr(attackerPk);
        PurchaseOrder memory po = _order(attackerPayout, TOTAL);
        FundIntent memory i = _intent(po);
        PolicyDecision memory d = _decision(i, 1);
        bytes memory sig = _sign(policyPk, _pdrDigest(gate, d)); // the attacker holds this key
        vm.expectRevert(FundingGate.UnknownSupplier.selector);
        vm.prank(attacker);
        gate.execute(i, d, sig, "");
        assertEq(usdc.balanceOf(attackerPayout), 0);
    }

    /// Stolen policy and cosigner keys together, tier 3: the cosignature only changes the
    /// Roles role (allowance), it never skips the registries.
    function test_goal_stolenPolicyAndCosignerKeys_tier3StillReverts() public {
        address attackerPayout = vm.addr(attackerPk);
        PurchaseOrder memory po = _order(attackerPayout, BIG);
        FundIntent memory i = _intent(po);
        PolicyDecision memory d = _decision(i, 3);
        bytes memory sigP = _sign(policyPk, _pdrDigest(gate, d));
        bytes memory sigC = _sign(cosignerPk, _pdrDigest(gate, d));
        vm.expectRevert(FundingGate.UnknownSupplier.selector);
        vm.prank(attacker);
        gate.execute(i, d, sigP, sigC);

        // And the stolen cosigner key cannot add the address either
        vm.expectRevert(IPDRVerifier.OnlySafe.selector);
        vm.prank(cosigner);
        gate.queueSupplier(exporter, attackerPayout);
        assertEq(usdc.balanceOf(attackerPayout), 0);
    }

    /// An order signed by both parties with the known supplier and payout, but with a carrier
    /// the exporter controls (it could attest a shipment that never happened).
    function test_goal_exporterControlledCarrierReverts() public {
        uint256 fakeCarrierPk = 0xFA4E;
        PurchaseOrder memory po =
            _poCustom(address(safe), exporter, payout, vm.addr(fakeCarrierPk), arbiter, verifier, TOTAL);
        _open(po, ownerPk, exporterPk);
        _expectFundRevert(po, 1, FundingGate.UntrustedParty.selector);
        assertEq(_state(po.orderId), 1, "still OPEN, nothing moved");
    }

    /// For any payout address, registry history and time: if execute does not revert, the
    /// payout address of the order is active in the registry, and so are its third parties.
    /// The attacker holds the policy key and the cosigner key.
    function testFuzz_fundingImpliesActiveSupplier(address payout_, uint8 history, uint32 elapsed, bool tier3) public {
        uint8 h = history % 5;
        if (h == 4) payout_ = payout; // also exercise the known supplier
        else vm.assume(payout_ != payout);
        vm.assume(payout_ != address(0) && payout_ != address(safe) && payout_ != exporter);
        vm.assume(payout_ != carrier && payout_ != arbiter && payout_ != verifier && payout_ != address(escrow));

        uint256 id;
        vm.startPrank(address(safe));
        if (h == 1 || h == 2 || h == 3) id = gate.queueSupplier(exporter, payout_);
        vm.stopPrank();
        if (h == 2) {
            vm.prank(cosigner);
            gate.vetoPending(id);
        } else if (h == 3) {
            vm.prank(address(safe));
            gate.removeSupplier(exporter, payout_);
        }
        vm.warp(vm.getBlockTimestamp() + bound(elapsed, 0, 2 * DELAY));

        PurchaseOrder memory po = _order(payout_, tier3 ? BIG : TOTAL);
        FundIntent memory i = _intent(po);
        PolicyDecision memory d = _decision(i, tier3 ? 3 : 1);
        bytes memory sigP = _sign(policyPk, _pdrDigest(gate, d));
        bytes memory sigC = tier3 ? _sign(cosignerPk, _pdrDigest(gate, d)) : bytes("");

        vm.prank(attacker);
        try gate.execute(i, d, sigP, sigC) {
            assertTrue(gate.isKnownSupplier(po.exporter, po.payoutAddress), "funded an unknown payout");
            assertTrue(gate.hasRole(po.carrier, CARRIER));
            assertTrue(gate.hasRole(po.arbiter, ARBITER));
            assertTrue(gate.hasRole(po.documentVerifier, VERIFIER));
        } catch (bytes memory reason) {
            assertEq(bytes4(reason), FundingGate.UnknownSupplier.selector, "only the registry stops it");
            assertFalse(gate.isKnownSupplier(po.exporter, po.payoutAddress));
        }
    }
}
