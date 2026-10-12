// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

// Shared structs of Keel. They mirror schemas/src/index.ts and are owned by Area 2.
// DRAFT until the interface freeze (Monday Oct 12, 20:00 CLT).

struct PaymentIntent {
    uint8 aliasId; // enum of registered beneficiaries
    address recipient; // resolved from the alias table, never from the document
    uint256 amountUsdc; // 6 decimals
    bytes32 invoiceKey; // keccak256(issuerTaxId, invoiceNumber, period)
    uint64 deadline;
    uint256 nonce;
}

struct PolicyDecision {
    bytes32 intentHash; // EIP-712 hash of PaymentIntent
    bytes32 calldataHash; // keccak256 of the exact USDC.transfer calldata
    bytes32 policyHash; // current version of the rules
    bytes32 inputsHash; // FX rate, sources, allowlist version
    uint8 tier; // 1 or 3 (tiers 0, 2 and 4 never reach the gate)
    uint64 expiresAt;
}
