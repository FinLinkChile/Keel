// Orders, intents and decisions of the evidence cases. Orders are opened for real in the
// TradeEscrow: the importer Safe signs through ERC-1271 (the owner signs the SafeMessage) and
// the exporter signs the same EIP-712 digest.
import { randomBytes } from "node:crypto";
import { EIP712_TYPES, type FundIntent, type Hex, keelDomain, type PolicyDecision, type PurchaseOrder } from "@keel/schemas";
import { bytes32Text, structHash, typedDataDigest } from "@keel/schemas/hash";
import { concat, encodeAbiParameters, encodeFunctionData, erc20Abi, keccak256, toBytes } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { safeAbi } from "./abi";
import { type Ctx, escrowCall, escrowRead, gateCall, gateRead, latestTimestamp, read, type Sent, sendOk } from "./chain";
import type { Signer } from "./config";

// Safe 1.4.1 CompatibilityFallbackHandler: keccak256("SafeMessage(bytes message)")
const SAFE_MSG_TYPEHASH: Hex = "0x60b3cbf8b4a223d68d641b3b6ddf9a298e7f33710cf3d3a9d1146b5a6150fbca";

export const randomNonce = (): bigint => BigInt(`0x${randomBytes(8).toString("hex")}`);

// ERC-1271 signature of the Safe over a 32-byte hash, as CompatibilityFallbackHandler checks it:
// the owner signs the SafeMessage of abi.encode(hash) in the Safe's own EIP-712 domain.
export async function safeSign(ctx: Ctx, hash: Hex): Promise<Hex> {
  const safeDomain = await read<Hex>(ctx, ctx.d.safe, safeAbi, "domainSeparator");
  const safeMsg = keccak256(
    encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [SAFE_MSG_TYPEHASH, keccak256(encodeAbiParameters([{ type: "bytes32" }], [hash]))]),
  );
  return ctx.signer("owner").sign({ hash: keccak256(concat(["0x1901", safeDomain, safeMsg])) });
}

export interface OrderParties {
  // "safe": the importer Safe of the deployment; otherwise an EOA of the demo signs as importer
  importer: "safe" | Signer;
  payout: Hex;
  carrier: Hex;
  arbiter: Hex;
  verifier: Hex;
}

// The parties the Safe registers in 1.1: an order with these passes every registry check.
export const trustedParties = (ctx: Ctx): OrderParties => ({
  importer: "safe",
  payout: ctx.addr.payout,
  carrier: ctx.addr.carrier,
  arbiter: ctx.addr.arbiter,
  verifier: ctx.verifier,
});

export interface OpenedOrder {
  po: PurchaseOrder;
  orderHash: Hex;
  open: Sent;
}

export async function openOrder(ctx: Ctx, parties: OrderParties, label: string, deadlineSeconds = ctx.opts.deadlineSeconds): Promise<OpenedOrder> {
  const importer = parties.importer === "safe" ? ctx.d.safe : ctx.addr[parties.importer];
  const exporter = ctx.addr.exporter;
  const nonce = randomNonce();
  const now = await latestTimestamp(ctx);
  const po: PurchaseOrder = {
    orderId: keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [importer, exporter, nonce])),
    importer,
    exporter,
    payoutAddress: parties.payout,
    token: ctx.d.token,
    totalAmount: ctx.opts.amount,
    advanceBps: ctx.opts.advanceBps,
    shipmentDeadline: now + deadlineSeconds,
    disputeWindow: ctx.opts.disputeWindow,
    carrier: parties.carrier,
    arbiter: parties.arbiter,
    documentVerifier: parties.verifier,
    incoterm: bytes32Text("FOB"),
    termsHash: keccak256(toBytes(`keel-evidence/terms/${label}`)),
    requiredDocsHash: keccak256(toBytes("keel-evidence/BL+invoice")),
    nonce,
  };
  const domain = keelDomain(ctx.chainId, ctx.d.tradeEscrow);
  const digest = typedDataDigest(domain, "PurchaseOrder", po);
  const sigImporter =
    parties.importer === "safe"
      ? await safeSign(ctx, digest)
      : await ctx.signer(parties.importer).signTypedData({ domain, types: EIP712_TYPES, primaryType: "PurchaseOrder", message: po });
  const sigExporter = await ctx.signer("exporter").signTypedData({ domain, types: EIP712_TYPES, primaryType: "PurchaseOrder", message: po });
  const open = await sendOk(ctx, "exporter", ctx.d.tradeEscrow, escrowCall(ctx, "open", [po, sigImporter, sigExporter]), `open order ${label}`);
  const orderHash = structHash("PurchaseOrder", po);
  const stored = await escrowRead<{ orderHash: Hex }>(ctx, "orderOf", [po.orderId]);
  if (stored.orderHash !== orderHash) throw new Error(`order ${po.orderId}: stored orderHash differs from the local one`);
  return { po, orderHash, open };
}

export async function intentFor(ctx: Ctx, o: OpenedOrder): Promise<FundIntent> {
  return {
    orderId: o.po.orderId,
    orderHash: o.orderHash,
    escrow: ctx.d.tradeEscrow,
    token: ctx.d.token,
    amount: o.po.totalAmount,
    deadline: (await latestTimestamp(ctx)) + 900n,
    nonce: randomNonce(),
  };
}

// The calldata hash the gate computes for `intent` (read from the gate, for parity).
export async function fundingCalldataHash(ctx: Ctx, intent: FundIntent): Promise<Hex> {
  const [, , h] = await gateRead<[Hex, Hex, Hex]>(ctx, "fundingCalldataOf", [intent]);
  return h;
}

// What a PDR would carry if the engine had approved another calldata: approve to `spender`.
export function otherCalldataHash(ctx: Ctx, intent: FundIntent, spender: Hex): Hex {
  const approveData = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, intent.amount] });
  const fundData = escrowCall(ctx, "fund", [intent.orderId]);
  return keccak256(encodeAbiParameters([{ type: "bytes" }, { type: "bytes" }], [approveData, fundData]));
}

export async function decisionFor(ctx: Ctx, intent: FundIntent, calldataHash?: Hex): Promise<PolicyDecision> {
  return {
    intentHash: structHash("FundIntent", intent),
    calldataHash: calldataHash ?? (await fundingCalldataHash(ctx, intent)),
    policyHash: await gateRead<Hex>(ctx, "currentPolicyHash"),
    inputsHash: keccak256(toBytes("keel-evidence/inputs")),
    tier: 1,
    expiresAt: (await latestTimestamp(ctx)) + 600n,
  };
}

export const signDecision = (ctx: Ctx, d: PolicyDecision, signer: PrivateKeyAccount) =>
  signer.signTypedData({ domain: keelDomain(ctx.chainId, ctx.d.fundingGate), types: EIP712_TYPES, primaryType: "PolicyDecision", message: d });

export const executeCall = (ctx: Ctx, intent: FundIntent, d: PolicyDecision, sigPolicy: Hex, sigCosigner: Hex = "0x") =>
  gateCall(ctx, "execute", [intent, d, sigPolicy, sigCosigner]);
