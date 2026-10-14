// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {
    PurchaseOrder,
    ShipmentAttestation,
    CancelOrder,
    DisputeResolution,
    FundIntent,
    PolicyDecision,
    DocumentDecision
} from "../src/KeelTypes.sol";
import {KeelHash} from "../src/KeelHash.sol";

// Exposes KeelHash so that schemas/src/hash.test.ts can compare it with the TypeScript hashes.
contract KeelHashHarness {
    function domainSeparator(uint256 chainId, address verifyingContract) external pure returns (bytes32) {
        return KeelHash.domainSeparator(chainId, verifyingContract);
    }

    function digest(bytes32 separator, bytes32 structHash) external pure returns (bytes32) {
        return KeelHash.digest(separator, structHash);
    }

    function bytes32Text(string calldata text) external pure returns (bytes32) {
        return bytes32(bytes(text));
    }

    function hashPurchaseOrder(PurchaseOrder calldata po) external pure returns (bytes32) {
        return KeelHash.hash(po);
    }

    function hashShipmentAttestation(ShipmentAttestation calldata att) external pure returns (bytes32) {
        return KeelHash.hash(att);
    }

    function hashCancelOrder(CancelOrder calldata c) external pure returns (bytes32) {
        return KeelHash.hash(c);
    }

    function hashDisputeResolution(DisputeResolution calldata r) external pure returns (bytes32) {
        return KeelHash.hash(r);
    }

    function hashFundIntent(FundIntent calldata intent) external pure returns (bytes32) {
        return KeelHash.hash(intent);
    }

    function hashPolicyDecision(PolicyDecision calldata d) external pure returns (bytes32) {
        return KeelHash.hash(d);
    }

    function hashDocumentDecision(DocumentDecision calldata d) external pure returns (bytes32) {
        return KeelHash.hash(d);
    }
}
