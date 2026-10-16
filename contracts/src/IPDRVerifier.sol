// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

/// @notice Events and errors shared by the gate of each mode (PDRGate for Personal, FundingGate
/// for Trade): the verification of a Policy Decision Record and the gate configuration.
/// @dev Moved out of IPDRGate (which now inherits this interface) so that both gates can share
/// PDRVerifier without declaring them twice. The compiled ABI of PDRGate is unchanged.
/// Names are fixed (docs/interfaces/eventos-y-errores.md).
interface IPDRVerifier {
    event GatePaused(address indexed by);
    /// @dev Proposed additions, useful for the monitor (T2.8) and the activity log.
    event GateUnpaused(address indexed by);
    event PolicySignerSet(address signer);
    event PolicyHashSet(bytes32 policyHash);
    event CosignerSet(address cosigner);

    error IntentMismatch();
    error CalldataMismatch();
    error BadPolicySignature();
    error MissingCosignature();
    error StalePolicy();
    error Expired();
    error NonceUsed();
    error GateIsPaused();

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
}
