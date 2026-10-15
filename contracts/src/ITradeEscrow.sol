// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {PurchaseOrder, ShipmentAttestation, DocumentDecision} from "./KeelTypes.sol";

/// @title ITradeEscrow
/// @notice Interface, events and errors of the Keel Trade escrow (task T1.9).
/// @dev Event and error names follow docs/interfaces/eventos-y-errores.md. Errors marked
/// "proposed" are additions of Area 1 that are not yet in schemas/src/index.ts.
interface ITradeEscrow {
    // ----------------------------------------------------------------- states
    /// @dev Values are part of the interface: off-chain code reads them as uint8.
    /// SETTLED, REFUNDED, RESOLVED and CANCELLED are final.
    enum State {
        NONE,
        OPEN,
        ADVANCE_PAID,
        SHIPPED,
        SETTLED,
        REFUNDED,
        DISPUTED,
        RESOLVED,
        CANCELLED
    }

    /// @notice Everything the escrow stores about one order.
    /// @param po The purchase order signed by importer and exporter.
    /// @param state Current state of the order.
    /// @param stateVersion Incremented on every state transition. CancelOrder.nonce must equal
    /// cancelNonceOf(orderId) = (stateVersion << 8) | uint8(state).
    /// @param orderHash EIP-712 struct hash of `po` (what FundIntent.orderHash binds).
    /// @param paidOut Amount already sent out of the escrow for this order.
    /// @param attestationHash EIP-712 struct hash of the accepted shipment attestation.
    /// @param docsHash Document package hash taken from the accepted attestation.
    /// @param shippedAt Timestamp at which the attestation was accepted.
    /// @param funded True once `fund` received the total amount.
    struct OrderRecord {
        PurchaseOrder po;
        State state;
        uint64 stateVersion;
        bytes32 orderHash;
        uint256 paidOut;
        bytes32 attestationHash;
        bytes32 docsHash;
        uint64 shippedAt;
        bool funded;
    }

    // ----------------------------------------------------------------- events
    event OrderOpened(
        bytes32 indexed orderId,
        bytes32 orderHash,
        address indexed importer,
        address indexed exporter,
        address payoutAddress,
        uint256 totalAmount
    );
    event OrderFunded(bytes32 indexed orderId, uint256 amount);
    event AdvanceReleased(bytes32 indexed orderId, address indexed to, uint256 amount);
    event ShipmentAccepted(bytes32 indexed orderId, bytes32 attestationHash, bytes32 blKey, uint64 onBoardDate);
    /// @param authorizationDigest EIP-712 digest of what released the balance: the
    /// DocumentDecision (releaseBalance) or the importer's BalanceApproval (approveBalance).
    event BalanceReleased(bytes32 indexed orderId, address indexed to, uint256 amount, bytes32 authorizationDigest);
    event Refunded(bytes32 indexed orderId, address indexed to, uint256 amount);
    event DisputeRaised(bytes32 indexed orderId, address indexed by);
    event DisputeResolved(bytes32 indexed orderId, uint256 toImporter, uint256 toExporter);
    event OrderCancelled(bytes32 indexed orderId, uint256 refunded);

    // ----------------------------------------------------------------- errors
    error InvalidState();
    error OrderExists();
    error BadImporterSignature();
    error BadExporterSignature();
    error BadCarrierSignature();
    error BadDocumentDecision();
    error ShipmentTooLate();
    error BillOfLadingAlreadyUsed();
    error DeadlineNotReached();
    error NotParty();
    error BadResolution();
    error TokenNotAllowed();
    error AmountMismatch();
    /// @dev Proposed: the token passed to the constructor is the zero address.
    error ZeroAddress();
    /// @dev Proposed: the purchase order fails a structural check in `open`.
    error InvalidOrder();
    /// @dev Proposed: orderId is not keccak256(abi.encode(importer, exporter, nonce)).
    error BadOrderId();
    /// @dev Proposed: funding at or after shipmentDeadline.
    error DeadlinePassed();
    /// @dev Proposed: the attestation is for another order or its on board date is in the future.
    error InvalidAttestation();
    /// @dev Proposed: the dispute resolution is not signed by the arbiter of the order.
    error BadArbiterSignature();

    // ----------------------------------------------------------------- functions
    function open(PurchaseOrder calldata po, bytes calldata sigImporter, bytes calldata sigExporter)
        external
        returns (bytes32 orderHash);

    function fund(bytes32 orderId) external;

    function submitShipment(bytes32 orderId, ShipmentAttestation calldata att, bytes calldata sigCarrier) external;

    function releaseBalance(bytes32 orderId, DocumentDecision calldata d, bytes calldata sigVerifier) external;

    function approveBalance(bytes32 orderId, bytes calldata sigImporter) external;

    function refundAfterDeadline(bytes32 orderId) external;

    function raiseDispute(bytes32 orderId) external;

    function resolve(bytes32 orderId, uint256 toImporter, uint256 toExporter, bytes calldata sigArbiter) external;

    function cancel(bytes32 orderId, bytes calldata sigImporter, bytes calldata sigExporter) external;

    function orderOf(bytes32 orderId) external view returns (OrderRecord memory);

    function cancelNonceOf(bytes32 orderId) external view returns (uint256);

    function isBlUsed(bytes32 blKey) external view returns (bool);
}
