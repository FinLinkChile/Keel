// What the agent reads from TradeEscrow and the calls it sends. Mirrors contracts/src/ITradeEscrow.sol.
import {
  type DocumentDecision,
  ESCROW_STATES,
  type EscrowEvent,
  type EscrowState,
  type Hex,
  type PurchaseOrder,
  type ShipmentAttestation,
} from "@keel/schemas";
import { decodeFunctionResult, encodeEventTopics, encodeFunctionData, getAbiItem, parseAbi } from "viem";

export const ESCROW_ABI = parseAbi([
  "struct PurchaseOrder { bytes32 orderId; address importer; address exporter; address payoutAddress; address token; uint256 totalAmount; uint16 advanceBps; uint64 shipmentDeadline; uint64 disputeWindow; address carrier; address arbiter; address documentVerifier; bytes32 incoterm; bytes32 termsHash; bytes32 requiredDocsHash; uint256 nonce; }",
  "struct ShipmentAttestation { bytes32 orderId; bytes32 blNumberHash; uint64 onBoardDate; bytes32 portOfLoading; bytes32 docsHash; }",
  "struct DocumentDecision { bytes32 orderId; bytes32 attestationHash; bytes32 docsHash; bytes32 policyHash; bytes32 inputsHash; uint64 expiresAt; }",
  "struct OrderRecord { PurchaseOrder po; uint8 state; uint64 stateVersion; bytes32 orderHash; uint256 paidOut; bytes32 attestationHash; bytes32 docsHash; uint64 shippedAt; bool funded; }",
  "function orderOf(bytes32 orderId) view returns (OrderRecord)",
  "function open(PurchaseOrder po, bytes sigImporter, bytes sigExporter) returns (bytes32 orderHash)",
  "function refundGrace() view returns (uint64)",
  "function fund(bytes32 orderId)",
  "function submitShipment(bytes32 orderId, ShipmentAttestation att, bytes sigCarrier)",
  "function releaseBalance(bytes32 orderId, DocumentDecision d, bytes sigVerifier)",
  "function refundAfterDeadline(bytes32 orderId)",
  // Permissionless calls the agent relays with signatures people gave (open, BalanceApproval,
  // CancelOrder, DisputeResolution): the relayer adds no authority, the escrow checks each one
  "function approveBalance(bytes32 orderId, bytes sigImporter)",
  "function cancel(bytes32 orderId, bytes sigImporter, bytes sigExporter)",
  "function resolve(bytes32 orderId, uint256 toImporter, uint256 toExporter, bytes sigArbiter)",
  "function cancelNonceOf(bytes32 orderId) view returns (uint256)",
  // Every event of the escrow, for the indexer that mirrors order states (aws/src/handlers/indexer.ts)
  "event OrderOpened(bytes32 indexed orderId, bytes32 orderHash, address indexed importer, address indexed exporter, address payoutAddress, uint256 totalAmount)",
  "event OrderFunded(bytes32 indexed orderId, uint256 amount)",
  "event AdvanceReleased(bytes32 indexed orderId, address indexed to, uint256 amount)",
  "event ShipmentAccepted(bytes32 indexed orderId, bytes32 attestationHash, bytes32 blKey, uint64 onBoardDate)",
  "event BalanceReleased(bytes32 indexed orderId, address indexed to, uint256 amount, bytes32 authorizationDigest)",
  "event Refunded(bytes32 indexed orderId, address indexed to, uint256 amount)",
  "event DisputeRaised(bytes32 indexed orderId, address indexed by)",
  "event DisputeResolved(bytes32 indexed orderId, uint256 toImporter, uint256 toExporter)",
  "event OrderCancelled(bytes32 indexed orderId, uint256 refunded)",
  // Every error TradeEscrow declares (schemas ESCROW_ERRORS, checked in escrow.test.ts)
  "error InvalidState()",
  "error OrderExists()",
  "error BadImporterSignature()",
  "error BadExporterSignature()",
  "error BadCarrierSignature()",
  "error BadDocumentDecision()",
  "error ShipmentTooLate()",
  "error BillOfLadingAlreadyUsed()",
  "error DeadlineNotReached()",
  "error NotParty()",
  "error BadResolution()",
  "error TokenNotAllowed()",
  "error AmountMismatch()",
  "error ZeroAddress()",
  "error InvalidOrder()",
  "error BadOrderId()",
  "error DeadlinePassed()",
  "error InvalidAttestation()",
  "error BadArbiterSignature()",
]);

export interface Call {
  to: Hex;
  data: Hex;
}

export interface OrderRecord {
  po: PurchaseOrder;
  state: EscrowState;
  orderHash: Hex;
  attestationHash: Hex;
  shippedAt: bigint;
}

export const orderOfCall = (escrow: Hex, orderId: Hex): Call => ({
  to: escrow,
  data: encodeFunctionData({ abi: ESCROW_ABI, functionName: "orderOf", args: [orderId] }),
});

export function decodeOrderOf(data: Hex): OrderRecord {
  const r = decodeFunctionResult({ abi: ESCROW_ABI, functionName: "orderOf", data });
  return { po: r.po, state: ESCROW_STATES[r.state] ?? "NONE", orderHash: r.orderHash, attestationHash: r.attestationHash, shippedAt: r.shippedAt };
}

export const openCall = (escrow: Hex, po: PurchaseOrder, sigImporter: Hex, sigExporter: Hex): Call => ({
  to: escrow,
  data: encodeFunctionData({ abi: ESCROW_ABI, functionName: "open", args: [po, sigImporter, sigExporter] }),
});

export const refundGraceCall = (escrow: Hex): Call => ({
  to: escrow,
  data: encodeFunctionData({ abi: ESCROW_ABI, functionName: "refundGrace" }),
});

export const decodeRefundGrace = (data: Hex): bigint => decodeFunctionResult({ abi: ESCROW_ABI, functionName: "refundGrace", data });

export const submitShipmentCall = (escrow: Hex, attestation: ShipmentAttestation, sigCarrier: Hex): Call => ({
  to: escrow,
  data: encodeFunctionData({ abi: ESCROW_ABI, functionName: "submitShipment", args: [attestation.orderId, attestation, sigCarrier] }),
});

export const releaseBalanceCall = (escrow: Hex, decision: DocumentDecision, sigVerifier: Hex): Call => ({
  to: escrow,
  data: encodeFunctionData({ abi: ESCROW_ABI, functionName: "releaseBalance", args: [decision.orderId, decision, sigVerifier] }),
});

export const refundCall = (escrow: Hex, orderId: Hex): Call => ({
  to: escrow,
  data: encodeFunctionData({ abi: ESCROW_ABI, functionName: "refundAfterDeadline", args: [orderId] }),
});

// The importer's BalanceApproval: the escrow rebuilds it from the attestation it accepted
export const approveBalanceCall = (escrow: Hex, orderId: Hex, sigImporter: Hex): Call => ({
  to: escrow,
  data: encodeFunctionData({ abi: ESCROW_ABI, functionName: "approveBalance", args: [orderId, sigImporter] }),
});

// CancelOrder{orderId, cancelNonceOf(orderId)} signed by both parties
export const cancelCall = (escrow: Hex, orderId: Hex, sigImporter: Hex, sigExporter: Hex): Call => ({
  to: escrow,
  data: encodeFunctionData({ abi: ESCROW_ABI, functionName: "cancel", args: [orderId, sigImporter, sigExporter] }),
});

// DisputeResolution signed by the arbiter; the recipients are fixed by the order
export const resolveCall = (escrow: Hex, orderId: Hex, toImporter: bigint, toExporter: bigint, sigArbiter: Hex): Call => ({
  to: escrow,
  data: encodeFunctionData({ abi: ESCROW_ABI, functionName: "resolve", args: [orderId, toImporter, toExporter, sigArbiter] }),
});

export const cancelNonceOfCall = (escrow: Hex, orderId: Hex): Call => ({
  to: escrow,
  data: encodeFunctionData({ abi: ESCROW_ABI, functionName: "cancelNonceOf", args: [orderId] }),
});

export const decodeCancelNonce = (data: Hex): bigint => decodeFunctionResult({ abi: ESCROW_ABI, functionName: "cancelNonceOf", data });

// The state each escrow event leaves its order in (contracts/src/TradeEscrow.sol). AdvanceReleased
// moves nothing: fund emits it right after OrderFunded, in the same transaction.
export const EVENT_STATE: Partial<Record<EscrowEvent, EscrowState>> = {
  OrderOpened: "OPEN",
  OrderFunded: "ADVANCE_PAID",
  ShipmentAccepted: "SHIPPED",
  BalanceReleased: "SETTLED",
  Refunded: "REFUNDED",
  DisputeRaised: "DISPUTED",
  DisputeResolved: "RESOLVED",
  OrderCancelled: "CANCELLED",
};

// The funding time is private in the escrow: the agent reads it from the block of OrderFunded,
// which fund emits once per order (only from OPEN).
export const ORDER_FUNDED_EVENT = getAbiItem({ abi: ESCROW_ABI, name: "OrderFunded" });

// Topics of the OrderFunded log of one order, to match a log without decoding it
export const orderFundedTopics = (orderId: Hex): Hex[] =>
  encodeEventTopics({ abi: ESCROW_ABI, eventName: "OrderFunded", args: { orderId } }) as Hex[];
