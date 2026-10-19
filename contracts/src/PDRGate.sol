// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IPDRGate} from "./IPDRGate.sol";
import {IRoles} from "./IRoles.sol";
import {PaymentIntent, PolicyDecision} from "./KeelTypes.sol";
import {KeelHashing} from "./KeelHashing.sol";
import {PDRVerifier} from "./PDRVerifier.sol";

/// @title PDRGate
/// @notice Sole member of the AGENT role in the Zodiac Roles Modifier (decision D4).
/// A payment only reaches the Safe if it carries a Policy Decision Record signed by the
/// registered policy signer that binds the exact calldata built here. Roles limits
/// (allowlist, allowance, no delegatecall, no value) still apply after every check passes.
/// @dev Implements T1.6 steps 1 to 11 of the Keel work split.
contract PDRGate is IPDRGate, PDRVerifier {
    using KeelHashing for PaymentIntent;

    // Errors and events beyond IPDRGate (InvalidTier, OnlySafe, ZeroAddress, SignerIsCosigner,
    // ExecutionFailed, GateUnpaused, PolicySignerSet, PolicyHashSet, CosignerSet), the pause,
    // the signers, the policy version, the nonces and the configuration setters live in
    // PDRVerifier (shared with the Trade gate).

    // ----------------------------------------------------------------- immutables
    bytes32 public immutable agentRoleKey;

    // ----------------------------------------------------------------- state
    mapping(bytes32 => bool) public invoicePaid;

    constructor(
        address safe_,
        IRoles roles_,
        IERC20 usdc_,
        bytes32 agentRoleKey_,
        address policySigner_,
        address cosigner_,
        bytes32 policyHash_
    ) PDRVerifier(safe_, roles_, usdc_, policySigner_, cosigner_, policyHash_) {
        agentRoleKey = agentRoleKey_;
    }

    /// @notice The payment token (USDC).
    function usdc() external view returns (IERC20) {
        return _token;
    }

    // ----------------------------------------------------------------- core

    /// @inheritdoc IPDRGate
    /// @dev Permissionless: the relayer only pays gas, authority comes from the signatures.
    /// `sigCosigner` is ignored for tier 1 and required for tier 3, over the same digest.
    ///
    /// Failure handling: `roles.execTransactionWithRole` is called with `shouldRevert = true`,
    /// and its boolean result is also checked (`ExecutionFailed` if false), so the gate does not
    /// depend on Roles reverting on its own. Either way the whole transaction reverts, which rolls
    /// back the nonce and invoice marks (tests: test_revert_ExecutionFailed_rolesReturnsFalse,
    /// test_revert_ModuleTransactionFailed_safeExecutionFails_rollsBackState).
    /// Limit: success means the Safe-level call did not revert; it does not inspect the boolean
    /// returned by `transfer`. That is sufficient for USDC because its current implementation
    /// reverts on failure instead of returning false (USDC is an upgradeable proxy, so this holds
    /// for the current implementation only); it is not sufficient for an arbitrary ERC-20.
    function execute(
        PaymentIntent calldata intent,
        PolicyDecision calldata d,
        bytes calldata sigPolicy,
        bytes calldata sigCosigner
    ) external override {
        // 1. pause
        if (paused) revert GateIsPaused();

        // 2. intent binding
        bytes32 intentHash = intent.hashIntent();
        if (intentHash != d.intentHash) revert IntentMismatch();

        // 3. calldata built inside the contract, never received from outside
        bytes memory data = abi.encodeCall(IERC20.transfer, (intent.recipient, intent.amountUsdc));
        if (keccak256(data) != d.calldataHash) revert CalldataMismatch();

        // 4 to 7. tier, policy signature over the EIP-712 digest of the decision, policy version,
        // expiry of the decision and deadline of the intent, nonce (PDRVerifier)
        bytes32 pdrHash = _verifyPolicy(d, intent.deadline, intent.nonce, sigPolicy);

        // 8. on-chain idempotency (critique 11)
        if (invoicePaid[intent.invoiceKey]) revert InvoiceAlreadyPaid();
        invoicePaid[intent.invoiceKey] = true;

        // 9. amount threshold the Safe itself cannot express (critique 15)
        _verifyCosignature(d, pdrHash, sigCosigner);

        // 10. emitted before the external call (checks, effects, interactions). If the call
        // fails, the whole transaction reverts (state rollback proven by the tests named in the
        // @dev above); under EVM semantics its logs are discarded too, which Foundry's log
        // recording cannot observe, so that part is not covered by a test. The only earlier
        // external calls are the ERC-1271 checks in SignatureChecker, which use staticcall and
        // cannot change state.
        // forge-lint: disable-next-line(reentrancy-events)
        emit PaymentExecuted(intentHash, pdrHash, d.tier, intent.invoiceKey);

        // 11. defense in depth: Roles re-checks target, selector, recipient and allowance
        bool ok = roles.execTransactionWithRole(address(_token), 0, data, IRoles.Operation.Call, agentRoleKey, true);
        if (!ok) revert ExecutionFailed();
    }

    // ----------------------------------------------------------------- views for off-chain parity (T2.1)

    function intentHashOf(PaymentIntent calldata intent) external pure returns (bytes32) {
        return KeelHashing.hashIntent(intent);
    }
}
