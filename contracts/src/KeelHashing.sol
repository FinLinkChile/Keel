// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {PaymentIntent, PolicyDecision} from "./KeelTypes.sol";

/// @notice EIP-712 typehashes and struct hashes for the shared Keel structs.
/// @dev Kept apart from KeelTypes.sol (owned by Area 2) so that file stays untouched.
/// The type strings MUST match the TypeScript definitions in schemas/ byte for byte;
/// the parity test vector (test/Eip712Vectors.t.sol) guards that.
library KeelHashing {
    bytes32 internal constant PAYMENT_INTENT_TYPEHASH = keccak256(
        "PaymentIntent(uint8 aliasId,address recipient,uint256 amountUsdc,bytes32 invoiceKey,uint64 deadline,uint256 nonce)"
    );

    bytes32 internal constant POLICY_DECISION_TYPEHASH = keccak256(
        "PolicyDecision(bytes32 intentHash,bytes32 calldataHash,bytes32 policyHash,bytes32 inputsHash,uint8 tier,uint64 expiresAt)"
    );

    function hashIntent(PaymentIntent memory i) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                PAYMENT_INTENT_TYPEHASH, i.aliasId, i.recipient, i.amountUsdc, i.invoiceKey, i.deadline, i.nonce
            )
        );
    }

    function hashDecision(PolicyDecision memory d) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                POLICY_DECISION_TYPEHASH,
                d.intentHash,
                d.calldataHash,
                d.policyHash,
                d.inputsHash,
                d.tier,
                d.expiresAt
            )
        );
    }
}
