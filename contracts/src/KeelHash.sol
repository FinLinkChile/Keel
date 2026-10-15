// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {
    PurchaseOrder,
    ShipmentAttestation,
    CancelOrder,
    DisputeResolution,
    FundIntent,
    PolicyDecision,
    DocumentDecision,
    PaymentIntent
} from "./KeelTypes.sol";

// EIP-712 hashes of the shared structs. Owned by Area 2.
// It must match schemas/src/hash.ts byte for byte: schemas/src/hash.test.ts runs both.
// Domain: name = "Keel", version = "1", chainId, verifyingContract = the contract that
// checks the signature (the gate of the mode for PolicyDecision, TradeEscrow for
// everything else). PaymentIntent is here so PDRGate can move to this single source.
library KeelHash {
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    bytes32 internal constant PURCHASE_ORDER_TYPEHASH = keccak256(
        "PurchaseOrder(bytes32 orderId,address importer,address exporter,address payoutAddress,address token,uint256 totalAmount,uint16 advanceBps,uint64 shipmentDeadline,uint64 disputeWindow,address carrier,address arbiter,bytes32 incoterm,bytes32 termsHash,bytes32 requiredDocsHash,uint256 nonce)"
    );

    bytes32 internal constant SHIPMENT_ATTESTATION_TYPEHASH = keccak256(
        "ShipmentAttestation(bytes32 orderId,bytes32 blNumberHash,uint64 onBoardDate,bytes32 portOfLoading,bytes32 docsHash)"
    );

    bytes32 internal constant CANCEL_ORDER_TYPEHASH = keccak256("CancelOrder(bytes32 orderId,uint256 nonce)");

    bytes32 internal constant DISPUTE_RESOLUTION_TYPEHASH =
        keccak256("DisputeResolution(bytes32 orderId,uint256 toImporter,uint256 toExporter)");

    bytes32 internal constant FUND_INTENT_TYPEHASH = keccak256(
        "FundIntent(bytes32 orderId,bytes32 orderHash,address escrow,address token,uint256 amount,uint64 deadline,uint256 nonce)"
    );

    bytes32 internal constant PAYMENT_INTENT_TYPEHASH = keccak256(
        "PaymentIntent(uint8 aliasId,address recipient,uint256 amountUsdc,bytes32 invoiceKey,uint64 deadline,uint256 nonce)"
    );

    bytes32 internal constant POLICY_DECISION_TYPEHASH = keccak256(
        "PolicyDecision(bytes32 intentHash,bytes32 calldataHash,bytes32 policyHash,bytes32 inputsHash,uint8 tier,uint64 expiresAt)"
    );

    bytes32 internal constant DOCUMENT_DECISION_TYPEHASH = keccak256(
        "DocumentDecision(bytes32 orderId,bytes32 attestationHash,bytes32 docsHash,bytes32 policyHash,bytes32 inputsHash,uint64 expiresAt)"
    );

    function domainSeparator(uint256 chainId, address verifyingContract) internal pure returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("Keel"), keccak256("1"), chainId, verifyingContract));
    }

    // The digest that gets signed.
    function digest(bytes32 separator, bytes32 structHash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(hex"1901", separator, structHash));
    }

    // Encoded in two halves to stay within the stack limit. Every field is a static
    // type, so the concatenation equals a single abi.encode.
    function hash(PurchaseOrder memory po) internal pure returns (bytes32) {
        return keccak256(
            bytes.concat(
                abi.encode(
                    PURCHASE_ORDER_TYPEHASH,
                    po.orderId,
                    po.importer,
                    po.exporter,
                    po.payoutAddress,
                    po.token,
                    po.totalAmount,
                    po.advanceBps
                ),
                abi.encode(
                    po.shipmentDeadline,
                    po.disputeWindow,
                    po.carrier,
                    po.arbiter,
                    po.incoterm,
                    po.termsHash,
                    po.requiredDocsHash,
                    po.nonce
                )
            )
        );
    }

    function hash(ShipmentAttestation memory att) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SHIPMENT_ATTESTATION_TYPEHASH,
                att.orderId,
                att.blNumberHash,
                att.onBoardDate,
                att.portOfLoading,
                att.docsHash
            )
        );
    }

    function hash(CancelOrder memory c) internal pure returns (bytes32) {
        return keccak256(abi.encode(CANCEL_ORDER_TYPEHASH, c.orderId, c.nonce));
    }

    function hash(DisputeResolution memory r) internal pure returns (bytes32) {
        return keccak256(abi.encode(DISPUTE_RESOLUTION_TYPEHASH, r.orderId, r.toImporter, r.toExporter));
    }

    function hash(FundIntent memory intent) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                FUND_INTENT_TYPEHASH,
                intent.orderId,
                intent.orderHash,
                intent.escrow,
                intent.token,
                intent.amount,
                intent.deadline,
                intent.nonce
            )
        );
    }

    function hash(PaymentIntent memory i) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(PAYMENT_INTENT_TYPEHASH, i.aliasId, i.recipient, i.amountUsdc, i.invoiceKey, i.deadline, i.nonce)
        );
    }

    function hash(PolicyDecision memory d) internal pure returns (bytes32) {
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

    function hash(DocumentDecision memory d) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                DOCUMENT_DECISION_TYPEHASH,
                d.orderId,
                d.attestationHash,
                d.docsHash,
                d.policyHash,
                d.inputsHash,
                d.expiresAt
            )
        );
    }
}
