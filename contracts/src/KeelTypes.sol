// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

// Shared structs of Keel. They mirror schemas/src/index.ts and are owned by Area 2.
// PROPOSAL until the interface freeze (Wednesday Oct 14, 20:00 CLT).
// Their EIP-712 hashes are in KeelHash.sol.

// Signed by importer and exporter over the same EIP-712 digest.
struct PurchaseOrder {
    bytes32 orderId;
    address importer;
    address exporter;
    address payoutAddress; // signed by both; never taken from a document
    address token;
    uint256 totalAmount; // in the minor unit of the token
    uint16 advanceBps; // 5000 = 50%
    uint64 shipmentDeadline; // compared with the on board date
    uint64 disputeWindow; // seconds after the shipment
    address carrier; // who can sign the shipment attestation
    address arbiter;
    address documentVerifier; // signs the DocumentDecision; never a party nor the carrier
    bytes32 incoterm; // bytes32 text: EXW, FOB, CIF, CFR
    bytes32 termsHash; // hash of the full order document, with the proforma
    bytes32 requiredDocsHash;
    uint256 nonce;
}

// Signed by the carrier fixed in the order.
struct ShipmentAttestation {
    bytes32 orderId;
    bytes32 blNumberHash; // keccak256(abi.encode(carrier, documentNumber))
    uint64 onBoardDate;
    bytes32 portOfLoading; // UN/LOCODE as bytes32 text
    bytes32 docsHash; // hash of the document package
}

// Signed by importer and exporter to cancel by mutual agreement.
struct CancelOrder {
    bytes32 orderId;
    uint256 nonce;
}

// Signed by the importer: releases the balance of an attested shipment without a
// DocumentDecision (manual alternative of trigger 2).
struct BalanceApproval {
    bytes32 orderId;
    bytes32 attestationHash; // EIP-712 hash of the accepted ShipmentAttestation
}

// Signed by the arbiter. The escrow only pays `importer` and `payoutAddress`.
struct DisputeResolution {
    bytes32 orderId;
    uint256 toImporter;
    uint256 toExporter;
}

struct FundIntent {
    bytes32 orderId;
    bytes32 orderHash; // EIP-712 struct hash of the signed PurchaseOrder
    address escrow; // the TradeEscrow contract
    address token;
    uint256 amount; // equal to the totalAmount of the order
    uint64 deadline;
    uint256 nonce;
}

struct PolicyDecision {
    bytes32 intentHash; // EIP-712 hash of PaymentIntent (Personal) or FundIntent (Trade)
    bytes32 calldataHash; // keccak256 of the exact calldata the Safe executes
    bytes32 policyHash; // current version of the rules
    bytes32 inputsHash; // order, supplier registry, allowance used
    uint8 tier; // 1 or 3 (tiers 0, 2 and 4 never reach the gate)
    uint64 expiresAt;
}

struct DocumentDecision {
    bytes32 orderId;
    bytes32 attestationHash; // EIP-712 hash of ShipmentAttestation
    bytes32 docsHash; // hash of the document package that was read
    bytes32 policyHash;
    bytes32 inputsHash; // extractions of the transport document and the invoice
    uint64 expiresAt;
}

// Keel Personal (bill payments). Used by PDRGate.sol and KeelHashing.sol.
struct PaymentIntent {
    uint8 aliasId; // enum of registered beneficiaries
    address recipient; // resolved from the alias table, never from the document
    uint256 amountUsdc; // 6 decimals
    bytes32 invoiceKey; // keccak256(abi.encode(rut, folio, period))
    uint64 deadline;
    uint256 nonce;
}
