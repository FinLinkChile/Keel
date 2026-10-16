// What the agent reads from TradeEscrow and the calls it sends. Mirrors contracts/src/ITradeEscrow.sol.
import {
  type DocumentDecision,
  ESCROW_STATES,
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
  "function refundGrace() view returns (uint64)",
  "function fund(bytes32 orderId)",
  "function submitShipment(bytes32 orderId, ShipmentAttestation att, bytes sigCarrier)",
  "function releaseBalance(bytes32 orderId, DocumentDecision d, bytes sigVerifier)",
  "function refundAfterDeadline(bytes32 orderId)",
  "event OrderFunded(bytes32 indexed orderId, uint256 amount)",
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

// The funding time is private in the escrow: the agent reads it from the block of OrderFunded,
// which fund emits once per order (only from OPEN).
export const ORDER_FUNDED_EVENT = getAbiItem({ abi: ESCROW_ABI, name: "OrderFunded" });

// Topics of the OrderFunded log of one order, to match a log without decoding it
export const orderFundedTopics = (orderId: Hex): Hex[] =>
  encodeEventTopics({ abi: ESCROW_ABI, eventName: "OrderFunded", args: { orderId } }) as Hex[];
