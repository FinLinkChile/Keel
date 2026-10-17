// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {FundingGate} from "../../src/FundingGate.sol";
import {ITradeEscrow} from "../../src/ITradeEscrow.sol";
import {KeelHash} from "../../src/KeelHash.sol";
import {PurchaseOrder, FundIntent, PolicyDecision} from "../../src/KeelTypes.sol";
import {IZodiacRolesV2, TradeRolesConfig, RolesStatus} from "../../script/TradeRolesConfig.sol";
import {ForkBase, IFiatTokenAdmin} from "./ForkBase.sol";

/// @notice T1.7: FundingGate against the real Zodiac Roles v2, Safe 1.4.1 and USDC on a Base
/// Sepolia fork. Every negative test expects the exact error and, for ConditionViolation, the
/// exact Status and info word the real Roles returns. Run with:
///   forge test --match-path 'test/fork/*'   (needs BASE_SEPOLIA_RPC_URL)
contract FundingGateRolesForkTest is ForkBase {
    uint256 constant TOTAL = 10_000e6;
    uint256 constant BIG = 50_000e6; // over AGENT_CAP, within COSIGNED_CAP

    // ------------------------------------------------------------------ wiring

    function test_fork_wiring() public onlyFork {
        assertEq(roles.owner(), address(safe), "Roles owner is the Safe");
        assertEq(roles.avatar(), address(safe));
        assertEq(roles.target(), address(safe));
        assertTrue(safe.isModuleEnabled(address(roles)), "Roles enabled on the Safe");
        assertTrue(roles.isModuleEnabled(address(gate)), "gate enabled on Roles by assignRoles");
        assertFalse(roles.isModuleEnabled(relayer));
        assertEq(balanceOf(AGENT_KEY), AGENT_CAP);
        assertEq(balanceOf(COSIGNED_KEY), COSIGNED_CAP);
    }

    // ------------------------------------------------------------------ happy paths

    function _execute(PurchaseOrder memory po, uint8 tier) internal {
        FundIntent memory i = intentFor(po);
        PolicyDecision memory d = decisionFor(i, tier);
        bytes memory sigC = tier == 3 ? sign(cosignerPk, pdrDigest(d)) : bytes("");
        vm.prank(relayer);
        gate.execute(i, d, sign(policyPk, pdrDigest(d)), sigC);
    }

    function test_fork_tier1_fundsThroughRealRoles() public onlyFork {
        PurchaseOrder memory po = openOrder(payout, TOTAL);
        uint256 safeBefore = usdc.balanceOf(address(safe));
        _execute(po, 1);
        assertEq(uint8(escrow.orderOf(po.orderId).state), uint8(ITradeEscrow.State.ADVANCE_PAID));
        assertEq(balanceOf(AGENT_KEY), AGENT_CAP - TOTAL, "AGENT allowance spent by the approve amount");
        assertEq(balanceOf(COSIGNED_KEY), COSIGNED_CAP, "AGENT_COSIGNED untouched");
        assertEq(usdc.allowance(address(safe), address(escrow)), 0);
        assertEq(usdc.balanceOf(address(safe)), safeBefore - TOTAL);
        assertEq(usdc.balanceOf(payout), (TOTAL * 3000) / 10_000);
    }

    function test_fork_tier3_fundsWithCosignedRole() public onlyFork {
        PurchaseOrder memory po = openOrder(payout, BIG);
        _execute(po, 3);
        assertEq(uint8(escrow.orderOf(po.orderId).state), uint8(ITradeEscrow.State.ADVANCE_PAID));
        assertEq(balanceOf(AGENT_KEY), AGENT_CAP, "AGENT untouched");
        assertEq(balanceOf(COSIGNED_KEY), COSIGNED_CAP - BIG);
        assertEq(usdc.allowance(address(safe), address(escrow)), 0);
    }

    // ------------------------------------------------------------------ membership

    /// The relayer is not an enabled module of Roles: moduleOnly (zodiac v3.4.1 Modifier.sol)
    /// rejects it before any role check.
    function test_fork_revert_NotAuthorized_relayerCallsRolesDirectly() public onlyFork {
        bytes memory data = abi.encodeCall(IERC20.approve, (address(escrow), 1e6));
        vm.expectRevert(abi.encodeWithSelector(IZodiacRolesV2.NotAuthorized.selector, relayer));
        vm.prank(relayer);
        roles.execTransactionWithRole(USDC, 0, data, 0, AGENT, true);
    }

    /// An enabled module that is not a member of AGENT (PermissionChecker._authorize).
    function test_fork_revert_NoMembership_moduleWithoutTheRole() public onlyFork {
        bytes32[] memory keys = new bytes32[](1);
        keys[0] = keccak256("OTHER");
        bool[] memory on = new bool[](1);
        on[0] = true;
        execSafe(address(roles), abi.encodeCall(IZodiacRolesV2.assignRoles, (relayer, keys, on)));
        assertTrue(roles.isModuleEnabled(relayer));

        bytes memory data = abi.encodeCall(IERC20.approve, (address(escrow), 1e6));
        vm.expectRevert(IZodiacRolesV2.NoMembership.selector);
        vm.prank(relayer);
        roles.execTransactionWithRole(USDC, 0, data, 0, AGENT, true);
    }

    function test_fork_revert_NoMembership_zeroRoleKey() public onlyFork {
        bytes memory data = abi.encodeCall(IERC20.approve, (address(escrow), 1e6));
        vm.expectRevert(IZodiacRolesV2.NoMembership.selector);
        vm.prank(address(gate));
        roles.execTransactionWithRole(USDC, 0, data, 0, bytes32(0), true);
    }

    // ------------------------------------------------------------------ conditions

    function test_fork_revert_ConditionViolation_approveOtherSpender() public onlyFork {
        bytes memory data = abi.encodeCall(IERC20.approve, (makeAddr("other"), 1e6));
        vm.expectRevert(violation(RolesStatus.ParameterNotAllowed, bytes32(0)));
        vm.prank(address(gate));
        roles.execTransactionWithRole(USDC, 0, data, 0, AGENT, true);
    }

    /// Through the gate: tier 1 runs with AGENT, whose allowance is below the order amount.
    function test_fork_revert_ConditionViolation_AllowanceExceeded_tier1OverCap() public onlyFork {
        PurchaseOrder memory po = openOrder(payout, BIG);
        FundIntent memory i = intentFor(po);
        PolicyDecision memory d = decisionFor(i, 1);
        bytes memory sig = sign(policyPk, pdrDigest(d));
        vm.expectRevert(violation(RolesStatus.AllowanceExceeded, AGENT_KEY));
        vm.prank(relayer);
        gate.execute(i, d, sig, "");
    }

    function test_fork_revert_ConditionViolation_transferWithAgentRole() public onlyFork {
        bytes memory data = abi.encodeCall(IERC20.transfer, (makeAddr("thief"), 1e6));
        vm.expectRevert(violation(RolesStatus.FunctionNotAllowed, bytes32(IERC20.transfer.selector)));
        vm.prank(address(gate));
        roles.execTransactionWithRole(USDC, 0, data, 0, AGENT, true);
    }

    function test_fork_revert_ConditionViolation_otherTarget() public onlyFork {
        bytes memory data = abi.encodeCall(IERC20.approve, (address(escrow), 1e6));
        vm.expectRevert(violation(RolesStatus.TargetAddressNotAllowed, bytes32(0)));
        vm.prank(address(gate));
        roles.execTransactionWithRole(makeAddr("otherToken"), 0, data, 0, AGENT, true);
    }

    /// A delegatecall with valid parameters to the scoped token: options are None.
    function test_fork_revert_ConditionViolation_delegatecallScopedTarget() public onlyFork {
        bytes memory data = abi.encodeCall(IERC20.approve, (address(escrow), 1e6));
        vm.expectRevert(violation(RolesStatus.DelegateCallNotAllowed, bytes32(0)));
        vm.prank(address(gate));
        roles.execTransactionWithRole(USDC, 0, data, 1, AGENT, true);
    }

    /// The real Roles checks the target before the execution options.
    function test_fork_revert_ConditionViolation_delegatecallUnscopedTarget() public onlyFork {
        vm.expectRevert(violation(RolesStatus.TargetAddressNotAllowed, bytes32(0)));
        vm.prank(address(gate));
        roles.execTransactionWithRole(makeAddr("lib"), 0, "", 1, AGENT, true);
    }

    function test_fork_revert_ConditionViolation_valueToFund() public onlyFork {
        bytes memory data = abi.encodeCall(ITradeEscrow.fund, (bytes32(0)));
        vm.expectRevert(violation(RolesStatus.SendNotAllowed, bytes32(0)));
        vm.prank(address(gate));
        roles.execTransactionWithRole(address(escrow), 1, data, 0, AGENT, true);
    }

    // ------------------------------------------------------------------ invariant

    /// No role targets the FundingGate (nor the Safe, nor the Roles instance, which the Safe owns).
    /// Roles v2 cannot enumerate targets, so this is checked twice: statically, every target of the
    /// shared configuration is the token or the escrow (a whitelist), and on chain for both roles.
    function test_fork_invariant_noRoleTargetsTheGate() public onlyFork {
        TradeRolesConfig.Call[] memory cfg = TradeRolesConfig.calls(params);
        for (uint256 k; k < cfg.length; k++) {
            bytes memory data = cfg[k].data;
            bytes4 sel = bytes4(data);
            if (
                sel == IZodiacRolesV2.scopeTarget.selector || sel == IZodiacRolesV2.scopeFunction.selector
                    || sel == IZodiacRolesV2.allowFunction.selector
            ) {
                // Every builder takes (bytes32 roleKey, address targetAddress, ...)
                address targetAddress;
                assembly {
                    targetAddress := mload(add(data, 68))
                }
                assertTrue(targetAddress == USDC || targetAddress == address(escrow), "a role targets something else");
            }
        }

        bytes memory queue = abi.encodeCall(FundingGate.queueSupplier, (exporter, makeAddr("p")));
        bytes32[2] memory keys = [AGENT, AGENT_COSIGNED];
        address[3] memory forbidden = [address(gate), address(safe), address(roles)];
        for (uint256 k; k < 2; k++) {
            for (uint256 t; t < 3; t++) {
                vm.expectRevert(violation(RolesStatus.TargetAddressNotAllowed, bytes32(0)));
                vm.prank(address(gate));
                roles.execTransactionWithRole(forbidden[t], 0, queue, 0, keys[k], true);
            }
        }
    }

    // ------------------------------------------------------------------ allowance on failure

    /// approve passes the conditions and consumes the allowance, then fund fails inside the Safe
    /// (the Safe lacks the funds): Roles reverts with ModuleTransactionFailed and the whole
    /// transaction, including the consumption, rolls back.
    function test_fork_allowanceNotConsumed_whenFundRevertsInsideSafe() public onlyFork {
        PurchaseOrder memory po = openOrder(payout, TOTAL);
        deal(USDC, address(safe), TOTAL - 1);
        FundIntent memory i = intentFor(po);
        PolicyDecision memory d = decisionFor(i, 1);
        bytes memory sig = sign(policyPk, pdrDigest(d));
        // The approve ran and the escrow reached transferFrom: it is fund that failed, not approve
        vm.expectCall(USDC, abi.encodeCall(IERC20.approve, (address(escrow), TOTAL)));
        vm.expectCall(USDC, abi.encodeCall(IERC20.transferFrom, (address(safe), address(escrow), TOTAL)));
        vm.expectRevert(IZodiacRolesV2.ModuleTransactionFailed.selector);
        vm.prank(relayer);
        gate.execute(i, d, sig, "");
        assertEq(balanceOf(AGENT_KEY), AGENT_CAP);
        assertEq(uint8(escrow.orderOf(po.orderId).state), uint8(ITradeEscrow.State.OPEN));
        assertFalse(gate.nonceUsed(i.nonce));
    }

    /// With shouldRevert = false, a call that fails inside the Safe returns false and Roles puts
    /// the consumed allowance back (AllowanceTracker._flushCommit). The failure is made with
    /// USDC's own pause (the pauser of the real token), not with a mock.
    function test_fork_allowanceRestored_whenCallFailsWithoutRevert() public onlyFork {
        vm.prank(IFiatTokenAdmin(USDC).pauser());
        IFiatTokenAdmin(USDC).pause();

        bytes memory data = abi.encodeCall(IERC20.approve, (address(escrow), 1e6));
        vm.prank(address(gate));
        bool ok = roles.execTransactionWithRole(USDC, 0, data, 0, AGENT, false);
        assertFalse(ok, "approve fails inside the Safe while USDC is paused");
        assertEq(balanceOf(AGENT_KEY), AGENT_CAP, "allowance restored");
    }

    /// Observed on this USDC implementation: the blacklist does not stop approve, neither for a
    /// blacklisted spender nor for a blacklisted owner; it bites on transfers. Recorded because it
    /// is part of the declared issuer risk: a blacklisted escrow or Safe still approves, and every
    /// fund then reverts on transferFrom.
    function test_fork_usdc_blacklistDoesNotStopApprove() public onlyFork {
        address blacklister = IFiatTokenAdmin(USDC).blacklister();
        vm.startPrank(blacklister);
        IFiatTokenAdmin(USDC).blacklist(address(escrow));
        IFiatTokenAdmin(USDC).blacklist(address(safe));
        vm.stopPrank();
        assertTrue(IFiatTokenAdmin(USDC).isBlacklisted(address(escrow)));
        assertTrue(IFiatTokenAdmin(USDC).isBlacklisted(address(safe)));
        vm.prank(address(safe));
        assertTrue(usdc.approve(address(escrow), 1e6));
        // ...and the transfer is what the blacklist stops
        vm.expectRevert("Blacklistable: account is blacklisted");
        vm.prank(address(escrow));
        usdc.transferFrom(address(safe), address(escrow), 1e6);
    }
}
