// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IPDRVerifier} from "./IPDRVerifier.sol";
import {IRoles} from "./IRoles.sol";
import {PolicyDecision} from "./KeelTypes.sol";
import {KeelHashing} from "./KeelHashing.sol";

/// @title PDRVerifier
/// @notice Base of the gate of each mode (PDRGate for Personal, FundingGate for Trade): pause,
/// policy signer, cosigner, current policy version, nonces and the verification of a Policy
/// Decision Record. Each gate builds its own calldata and decides what to execute.
/// @dev Extracted from PDRGate without changing its behavior or ABI. The verification is split
/// in two steps (`_verifyPolicy`, then `_verifyCosignature`) so PDRGate keeps its order of
/// checks (its invoice check sits between the nonce and the cosignature); `_verifyDecision`
/// runs both in a row. The storage order is the one PDRGate had.
abstract contract PDRVerifier is IPDRVerifier, EIP712 {
    using KeelHashing for PolicyDecision;

    // ----------------------------------------------------------------- immutables
    address public immutable safe;
    IRoles public immutable roles;
    /// @dev The payment token. Each gate exposes it under its own name (PDRGate: `usdc`).
    IERC20 internal immutable _token;

    // ----------------------------------------------------------------- state
    address public policySigner;
    address public cosigner;
    bytes32 public currentPolicyHash;
    bool public paused;

    mapping(uint256 => bool) public nonceUsed;

    modifier onlySafe() {
        if (msg.sender != safe) revert OnlySafe();
        _;
    }

    constructor(
        address safe_,
        IRoles roles_,
        IERC20 token_,
        address policySigner_,
        address cosigner_,
        bytes32 policyHash_
    ) EIP712("Keel", "1") {
        if (
            safe_ == address(0) || address(roles_) == address(0) || address(token_) == address(0)
                || policySigner_ == address(0) || cosigner_ == address(0)
        ) revert ZeroAddress();
        if (policySigner_ == cosigner_) revert SignerIsCosigner();
        safe = safe_;
        roles = roles_;
        _token = token_;
        policySigner = policySigner_;
        cosigner = cosigner_;
        currentPolicyHash = policyHash_;
    }

    // ----------------------------------------------------------------- verification

    /// @dev Tier, policy signature over the EIP-712 digest of the decision, policy version,
    /// expiries and nonce, in this order. Marks the nonce before returning, so it is always
    /// written before the gate makes any state-changing external call. The only external calls
    /// here are the ERC-1271 checks of SignatureChecker, which use staticcall.
    /// @return pdrHash The EIP-712 digest of `d` (what the policy signer and the cosigner sign).
    function _verifyPolicy(PolicyDecision calldata d, uint64 intentDeadline, uint256 nonce, bytes calldata sigPolicy)
        internal
        returns (bytes32 pdrHash)
    {
        if (d.tier != 1 && d.tier != 3) revert InvalidTier();

        pdrHash = _hashTypedDataV4(d.hashDecision());
        if (!SignatureChecker.isValidSignatureNow(policySigner, pdrHash, sigPolicy)) revert BadPolicySignature();

        if (d.policyHash != currentPolicyHash) revert StalePolicy();

        // block.timestamp is intentional: expiries set by the policy engine are expected to be
        // minutes to hours long (the contract does not enforce this), while a block producer can
        // only shift the timestamp by seconds.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > d.expiresAt || block.timestamp > intentDeadline) revert Expired();

        if (nonceUsed[nonce]) revert NonceUsed();
        nonceUsed[nonce] = true;
    }

    /// @dev Tier 3 only: a valid cosigner signature over the same digest. This is the amount
    /// threshold the Safe itself cannot express (critique 15).
    function _verifyCosignature(PolicyDecision calldata d, bytes32 pdrHash, bytes calldata sigCosigner) internal view {
        if (d.tier == 3) {
            if (!SignatureChecker.isValidSignatureNow(cosigner, pdrHash, sigCosigner)) revert MissingCosignature();
        }
    }

    /// @dev `_verifyPolicy` followed by `_verifyCosignature`.
    function _verifyDecision(
        PolicyDecision calldata d,
        uint64 intentDeadline,
        uint256 nonce,
        bytes calldata sigPolicy,
        bytes calldata sigCosigner
    ) internal returns (bytes32 pdrHash) {
        pdrHash = _verifyPolicy(d, intentDeadline, nonce, sigPolicy);
        _verifyCosignature(d, pdrHash, sigCosigner);
    }

    // ----------------------------------------------------------------- views for off-chain parity (T2.1)

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
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
