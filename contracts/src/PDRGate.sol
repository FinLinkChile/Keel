// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IPDRGate} from "./IPDRGate.sol";
import {IRoles} from "./IRoles.sol";
import {PaymentIntent, PolicyDecision} from "./KeelTypes.sol";
import {KeelHashing} from "./KeelHashing.sol";

/// @title PDRGate
/// @notice Sole member of the AGENT role in the Zodiac Roles Modifier (decision D4).
/// A payment only reaches the Safe if it carries a Policy Decision Record signed by the
/// registered policy signer that binds the exact calldata built here. Roles limits
/// (allowlist, allowance, no delegatecall, no value) still apply after every check passes.
/// @dev Implements T1.6 steps 1 to 11 of the Keel work split.
contract PDRGate is IPDRGate, EIP712 {
    using KeelHashing for PaymentIntent;
    using KeelHashing for PolicyDecision;

    // ----------------------------------------------------------------- errors beyond IPDRGate
    /// @dev Proposed addition to the frozen list (section 2.4): tier other than 1 or 3.
    error InvalidTier();
    /// @dev Proposed addition: configuration functions are callable only by the Safe.
    error OnlySafe();
    /// @dev Proposed addition: a constructor or setter address argument is address(0).
    error ZeroAddress();
    /// @dev Proposed addition: policy signer and cosigner would be the same address, so the tier 3
    /// cosignature would no longer add a second person. This only rejects the identical address:
    /// if either signer is a contract (ERC-1271 or an EIP-7702 delegated account), it does not prove
    /// distinct key holders. That remains an off-chain and deployment check.
    error SignerIsCosigner();

    /// @dev Proposed addition: Roles returned false for the module transaction instead of reverting.
    error ExecutionFailed();

    // ----------------------------------------------------------------- events beyond IPDRGate
    /// @dev Proposed additions, useful for the monitor (T2.8) and the activity log.
    event GateUnpaused(address indexed by);
    event PolicySignerSet(address signer);
    event PolicyHashSet(bytes32 policyHash);
    event CosignerSet(address cosigner);

    // ----------------------------------------------------------------- immutables
    address public immutable safe;
    IRoles public immutable roles;
    IERC20 public immutable usdc;
    bytes32 public immutable agentRoleKey;

    // ----------------------------------------------------------------- state
    address public policySigner;
    address public cosigner;
    bytes32 public currentPolicyHash;
    bool public paused;

    mapping(uint256 => bool) public nonceUsed;
    mapping(bytes32 => bool) public invoicePaid;

    modifier onlySafe() {
        if (msg.sender != safe) revert OnlySafe();
        _;
    }

    constructor(
        address safe_,
        IRoles roles_,
        IERC20 usdc_,
        bytes32 agentRoleKey_,
        address policySigner_,
        address cosigner_,
        bytes32 policyHash_
    ) EIP712("Keel", "1") {
        if (
            safe_ == address(0) || address(roles_) == address(0) || address(usdc_) == address(0)
                || policySigner_ == address(0) || cosigner_ == address(0)
        ) revert ZeroAddress();
        if (policySigner_ == cosigner_) revert SignerIsCosigner();
        safe = safe_;
        roles = roles_;
        usdc = usdc_;
        agentRoleKey = agentRoleKey_;
        policySigner = policySigner_;
        cosigner = cosigner_;
        currentPolicyHash = policyHash_;
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

        if (d.tier != 1 && d.tier != 3) revert InvalidTier();

        // 4. policy signature over the EIP-712 digest of the decision
        bytes32 pdrHash = _hashTypedDataV4(d.hashDecision());
        if (!SignatureChecker.isValidSignatureNow(policySigner, pdrHash, sigPolicy)) revert BadPolicySignature();

        // 5. policy version
        if (d.policyHash != currentPolicyHash) revert StalePolicy();

        // 6. expiry of the decision and deadline of the intent
        // block.timestamp is intentional: expiries set by the policy engine are expected to be
        // minutes to hours long (the contract does not enforce this), while a block producer can
        // only shift the timestamp by seconds.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > d.expiresAt || block.timestamp > intent.deadline) revert Expired();

        // 7. nonce
        if (nonceUsed[intent.nonce]) revert NonceUsed();
        nonceUsed[intent.nonce] = true;

        // 8. on-chain idempotency (critique 11)
        if (invoicePaid[intent.invoiceKey]) revert InvoiceAlreadyPaid();
        invoicePaid[intent.invoiceKey] = true;

        // 9. amount threshold the Safe itself cannot express (critique 15)
        if (d.tier == 3) {
            if (!SignatureChecker.isValidSignatureNow(cosigner, pdrHash, sigCosigner)) revert MissingCosignature();
        }

        // 10. emitted before the external call (checks, effects, interactions). If the call
        // fails, the whole transaction reverts (state rollback proven by the tests named in the
        // @dev above); under EVM semantics its logs are discarded too, which Foundry's log
        // recording cannot observe, so that part is not covered by a test. The only earlier
        // external calls are the ERC-1271 checks in SignatureChecker, which use staticcall and
        // cannot change state.
        // forge-lint: disable-next-line(reentrancy-events)
        emit PaymentExecuted(intentHash, pdrHash, d.tier, intent.invoiceKey);

        // 11. defense in depth: Roles re-checks target, selector, recipient and allowance
        bool ok = roles.execTransactionWithRole(address(usdc), 0, data, IRoles.Operation.Call, agentRoleKey, true);
        if (!ok) revert ExecutionFailed();
    }

    // ----------------------------------------------------------------- views for off-chain parity (T2.1)

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function intentHashOf(PaymentIntent calldata intent) external pure returns (bytes32) {
        return KeelHashing.hashIntent(intent);
    }

    /// @notice The digest the policy signer (and the cosigner, for tier 3) signs. Equals `pdrHash`.
    function digestOf(PolicyDecision calldata d) external view returns (bytes32) {
        return _hashTypedDataV4(KeelHashing.hashDecision(d));
    }

    // ----------------------------------------------------------------- configuration
    // All Safe-only. In production they must only arrive through the Delay Modifier (T1.4);
    // enforcing that the owner cannot call them directly is the ConfigGuard (T1.5).

    /// @notice Panic button. The COSIGNER role in Roles is scoped to call only this
    /// function (through the Safe), so the cosigner can stop payments but never start one.
    /// @dev `by` is always the Safe, since every call arrives through it.
    function pause() external onlySafe {
        paused = true;
        emit GatePaused(msg.sender);
    }

    function unpause() external onlySafe {
        paused = false;
        emit GateUnpaused(msg.sender);
    }

    function setPolicySigner(address s) external onlySafe {
        if (s == address(0)) revert ZeroAddress();
        if (s == cosigner) revert SignerIsCosigner();
        policySigner = s;
        emit PolicySignerSet(s);
    }

    function setPolicyHash(bytes32 h) external onlySafe {
        currentPolicyHash = h;
        emit PolicyHashSet(h);
    }

    function setCosigner(address c) external onlySafe {
        if (c == address(0)) revert ZeroAddress();
        if (c == policySigner) revert SignerIsCosigner();
        cosigner = c;
        emit CosignerSet(c);
    }
}
