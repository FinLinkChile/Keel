// Chain access: clients, the context every case receives, and the two ways a transaction is sent.
// `sendOk` simulates and sends a transaction that must succeed. `sendExpectRevert` captures the
// exact error with eth_call, sends the transaction anyway with a fixed gas (no estimation),
// confirms status 0 and decodes the error of the mined transaction.
import type { Hex } from "@keel/schemas";
import {
  type Chain,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  encodeFunctionData,
  erc20Abi,
  http,
  type Log,
  type PublicClient,
  type TransactionReceipt,
  toHex,
  zeroAddress,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { type Abis, type DecodedError, decodeRevert, loadAbis, safeAbi } from "./abi";
import { type Actor, type Deployment, loadAddresses, type Options, PreconditionError, type Signer, signerLoader } from "./config";
import type { ExpectedError, RevertEvidence, TxRef } from "./record";

export interface Ctx {
  chainId: number;
  chain: Chain;
  pub: PublicClient;
  isAnvil: boolean;
  opts: Options;
  abis: Abis;
  // Every party by its *_ADDRESS; keys only through `signer`, loaded on first use
  addr: Record<Actor, Hex>;
  signer: (s: Signer) => PrivateKeyAccount;
  d: Deployment & { token: Hex };
  // POLICY_SIGNER_ADDRESS: the document verifier of the evidence orders
  verifier: Hex;
  // Highest block this run knows about (its receipts, the end of a wait). Every read, simulation
  // and gas estimate runs at this block or later, never on a node that is still behind it.
  minBlock: bigint;
  // Next Safe nonce, kept by the script after each Safe transaction it sends
  safeNonce?: bigint;
}

export class CaseFailure extends Error {
  override name = "CaseFailure";
}

export async function connect(opts: Options, d: Deployment, verifier: Hex): Promise<Ctx> {
  const probe = createPublicClient({ transport: http(opts.rpcUrl) });
  const chainId = await probe.getChainId();
  if (chainId !== d.chainId) throw new PreconditionError(`RPC is chain ${chainId}, deployments file is for ${d.chainId}`);
  const client = String(await probe.request({ method: "web3_clientVersion" }).catch(() => ""));
  const isAnvil = /anvil/i.test(client);
  if (!isAnvil && !opts.live) {
    throw new PreconditionError(`the RPC is not a local anvil node (${client || "unknown client"}): pass --live to send to a real chain`);
  }
  const chain = defineChain({
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [opts.rpcUrl] } },
  });
  const pub = createPublicClient({ chain, transport: http(opts.rpcUrl) }) as PublicClient;
  const abis = loadAbis(opts.artifactsDir);
  const token = (await pub.readContract({ address: d.fundingGate, abi: abis.gate, functionName: "token" })) as Hex;
  return { chainId, chain, pub, isAnvil, opts, abis, addr: loadAddresses(), signer: signerLoader(), d: { ...d, token }, verifier, minBlock: 0n };
}

export function wallet(ctx: Ctx, actor: Signer | PrivateKeyAccount) {
  const account = typeof actor === "string" ? ctx.signer(actor) : actor;
  return createWalletClient({ account, chain: ctx.chain, transport: http(ctx.opts.rpcUrl) });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A block number at or after ctx.minBlock, as the RPC reports it (waits up to 60 s for it).
export async function syncedBlock(ctx: Ctx): Promise<bigint> {
  for (let i = 0; i < 60; i++) {
    const n = await ctx.pub.getBlockNumber({ cacheTime: 0 });
    if (n >= ctx.minBlock) return n;
    await sleep(1_000);
  }
  throw new Error(`the RPC stayed behind block ${ctx.minBlock} for 60 s`);
}

export function seeBlock(ctx: Ctx, n: bigint) {
  if (n > ctx.minBlock) ctx.minBlock = n;
}

// A load-balanced RPC may route a call at an explicit block to a node that does not have it yet.
const BEHIND = /header not found|block not found|unknown block|missing trie node|block.*not.*available/i;
async function atBlock<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= 10 || !BEHIND.test(String((err as Error)?.message))) throw err;
      await sleep(1_000);
    }
  }
}

export const read = async <T>(ctx: Ctx, address: Hex, abi: Abis[keyof Abis] | typeof safeAbi, functionName: string, args: unknown[] = []) => {
  const blockNumber = await syncedBlock(ctx);
  return atBlock(() => ctx.pub.readContract({ address, abi, functionName, args, blockNumber } as never) as Promise<T>);
};

export const gateRead = <T>(ctx: Ctx, fn: string, args: unknown[] = []) => read<T>(ctx, ctx.d.fundingGate, ctx.abis.gate, fn, args);
export const escrowRead = <T>(ctx: Ctx, fn: string, args: unknown[] = []) => read<T>(ctx, ctx.d.tradeEscrow, ctx.abis.escrow, fn, args);

export async function latestBlock(ctx: Ctx): Promise<{ number: bigint; timestamp: bigint }> {
  const blockNumber = await syncedBlock(ctx);
  const b = await atBlock(() => ctx.pub.getBlock({ blockNumber }));
  return { number: b.number, timestamp: b.timestamp };
}

export async function latestTimestamp(ctx: Ctx): Promise<bigint> {
  return (await latestBlock(ctx)).timestamp;
}

export async function usdcBalance(ctx: Ctx, who: Hex): Promise<bigint> {
  const blockNumber = await syncedBlock(ctx);
  return atBlock(() => ctx.pub.readContract({ address: ctx.d.token, abi: erc20Abi, functionName: "balanceOf", args: [who], blockNumber }));
}

// Revert data of a failed eth_call, wherever viem nests it. Any other failure is rethrown.
function revertData(err: unknown): Hex | undefined {
  let isRevert = false;
  for (let e = err as { data?: unknown; cause?: unknown; message?: string; code?: number } | undefined; e; e = e.cause as typeof e) {
    if (typeof e.data === "string" && e.data.startsWith("0x")) return e.data as Hex;
    const nested = (e.data as { data?: unknown } | undefined)?.data;
    if (typeof nested === "string" && nested.startsWith("0x")) return nested as Hex;
    if (e.code === 3 || /revert/i.test(e.message ?? "")) isRevert = true;
  }
  return isRevert ? "0x" : undefined;
}

// eth_call with the exact sender, calldata and gas. Returns the decoded revert, or null if it succeeds.
// "latest" means: the newest block at or after ctx.minBlock.
async function simulate(ctx: Ctx, from: Hex, to: Hex, data: Hex, gas: bigint | undefined, block: Hex | "latest"): Promise<DecodedError | null> {
  const tag = block === "latest" ? toHex(await syncedBlock(ctx)) : block;
  try {
    await atBlock(() =>
      ctx.pub.request({
        method: "eth_call",
        params: [{ from, to, data, ...(gas ? { gas: toHex(gas) } : {}) }, tag],
      } as never),
    );
    return null;
  } catch (err) {
    const data = revertData(err);
    if (data === undefined) throw err;
    return decodeRevert(ctx.abis, data);
  }
}

// eth_call at the newest synced block from any address (for example the Safe, to dry-run a Safe call's inner call).
export const simulateFrom = (ctx: Ctx, from: Hex, to: Hex, data: Hex) => simulate(ctx, from, to, data, undefined, "latest");

function txRef(label: string, receipt: TransactionReceipt, gasLimit: bigint): TxRef {
  return {
    label,
    hash: receipt.transactionHash,
    blockNumber: receipt.blockNumber,
    from: receipt.from,
    to: receipt.to ?? zeroAddress,
    status: receipt.status,
    gasUsed: receipt.gasUsed,
    gasLimit,
  };
}

export interface Sent {
  tx: TxRef;
  receipt: TransactionReceipt;
}

export async function sendOk(ctx: Ctx, sender: Signer | PrivateKeyAccount, to: Hex, data: Hex, label: string): Promise<Sent> {
  const w = wallet(ctx, sender);
  const failure = await simulate(ctx, w.account.address, to, data, undefined, "latest");
  if (failure) throw new CaseFailure(`${label}: simulation reverts with ${failure.name}(${failure.args.join(", ")}), not sending`);
  // Gas estimated at a synced block: on a node behind our last receipt the estimate could fail
  // (for example a Safe transaction signed for the next Safe nonce).
  const blockNumber = await syncedBlock(ctx);
  const estimate = await atBlock(() => ctx.pub.estimateGas({ account: w.account, to, data, blockNumber }));
  const hash = await w.sendTransaction({ to, data, gas: (estimate * 12n) / 10n + 20_000n, chain: ctx.chain, account: w.account });
  const receipt = await ctx.pub.waitForTransactionReceipt({ hash });
  seeBlock(ctx, receipt.blockNumber);
  const tx = await ctx.pub.getTransaction({ hash });
  if (receipt.status !== "success") throw new CaseFailure(`${label}: transaction ${hash} reverted`);
  console.log(`  ok   ${label}  ${hash}`);
  return { tx: txRef(label, receipt, tx.gas), receipt };
}

const sameError = (expected: ExpectedError, got: DecodedError) =>
  expected.name === got.name &&
  (!expected.args || (expected.args.length === got.args.length && expected.args.every((a, i) => a.toLowerCase() === got.args[i]?.toLowerCase())));

const errText = (e: { name: string; args?: string[] }) => `${e.name}(${(e.args ?? []).join(", ")})`;

// The mined transaction's error: the trace if the node exposes it, else an eth_call replay of the
// same call on the parent block's state (exact when no earlier transaction of that block touched
// the same storage; the record says which source was used).
async function minedError(ctx: Ctx, receipt: TransactionReceipt, from: Hex, to: Hex, data: Hex, gas: bigint) {
  try {
    const trace = (await ctx.pub.request({
      method: "debug_traceTransaction",
      params: [receipt.transactionHash, { tracer: "callTracer" }],
    } as never)) as { output?: Hex; error?: string };
    if (trace?.error) return { ...decodeRevert(ctx.abis, trace.output ?? "0x"), source: "trace" as const };
  } catch {
    // Node without the debug namespace: fall back to the replay
  }
  const replay = await simulate(ctx, from, to, data, gas, toHex(receipt.blockNumber - 1n));
  if (!replay) throw new CaseFailure(`${receipt.transactionHash}: reverted on chain but the replay succeeds; check by hand`);
  return { ...replay, source: "replay" as const };
}

export async function sendExpectRevert(
  ctx: Ctx,
  sender: Signer | PrivateKeyAccount,
  to: Hex,
  data: Hex,
  expected: ExpectedError,
  label: string,
): Promise<RevertEvidence> {
  const w = wallet(ctx, sender);
  const from = w.account.address;
  const gas = ctx.opts.revertGas;

  // 1. Capture the exact error first. Never send something that would succeed, nor something
  // that fails for another reason: that would be evidence of the wrong check.
  const simulated = await simulate(ctx, from, to, data, gas, "latest");
  if (!simulated) throw new CaseFailure(`${label}: the simulation SUCCEEDS; not sending (expected ${errText(expected)})`);
  if (!sameError(expected, simulated)) {
    throw new CaseFailure(`${label}: simulation reverts with ${errText(simulated)}, expected ${errText(expected)}; not sending`);
  }

  // 2. Send anyway, with a fixed gas so no node refuses it at estimation.
  const hash = await w.sendTransaction({ to, data, gas, chain: ctx.chain, account: w.account });
  const receipt = await ctx.pub.waitForTransactionReceipt({ hash });
  seeBlock(ctx, receipt.blockNumber);
  if (receipt.status !== "reverted") throw new CaseFailure(`${label}: ${hash} did NOT revert on chain`);
  if (receipt.gasUsed >= gas) throw new CaseFailure(`${label}: ${hash} used all its gas; the revert may be out of gas`);

  // 3. Decode what the mined transaction actually reverted with.
  const actual = await minedError(ctx, receipt, from, to, data, gas);
  if (!sameError(expected, actual)) throw new CaseFailure(`${label}: mined ${hash} reverted with ${errText(actual)}, expected ${errText(expected)}`);
  console.log(`  rev  ${label}  ${errText(actual)}  ${hash}`);
  return {
    tx: txRef(label, receipt, gas),
    expected,
    simulated,
    actual,
    reproduce: `cast run ${hash} --rpc-url ${ctx.opts.rpcLabel}`,
  };
}

// ------------------------------------------------------------------ Safe

// The Safe may have several owners (ours and Area 4's) with threshold 1: OWNER_PRIVATE_KEY alone
// must be enough. Checked before every phase.
export async function checkSafeOwner(ctx: Ctx): Promise<{ owners: Hex[]; threshold: bigint }> {
  const owners = await read<Hex[]>(ctx, ctx.d.safe, safeAbi, "getOwners");
  const threshold = await read<bigint>(ctx, ctx.d.safe, safeAbi, "getThreshold");
  const me = ctx.addr.owner;
  if (!owners.some((o) => o.toLowerCase() === me.toLowerCase())) {
    throw new PreconditionError(`OWNER_ADDRESS ${me} is not an owner of the Safe ${ctx.d.safe} (owners: ${owners.join(", ")})`);
  }
  if (threshold !== 1n) throw new PreconditionError(`Safe threshold is ${threshold}, the script needs 1 (one owner signature)`);
  return { owners, threshold };
}

// One Safe transaction signed by the owner over the safeTxHash (ECDSA, v = 27/28). safeTxGas =
// gasPrice = 0, so a failing inner call reverts the whole transaction (GS013).
export async function safeExec(ctx: Ctx, to: Hex, data: Hex, label: string): Promise<Sent> {
  // Read at a block at or after our last receipt, and never below the nonce this run already used
  const onChain = await read<bigint>(ctx, ctx.d.safe, safeAbi, "nonce");
  const nonce = ctx.safeNonce !== undefined && ctx.safeNonce > onChain ? ctx.safeNonce : onChain;
  const safeTxHash = await read<Hex>(ctx, ctx.d.safe, safeAbi, "getTransactionHash", [to, 0n, data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, nonce]);
  const signature = await ctx.signer("owner").sign({ hash: safeTxHash });
  const execData = encodeFunctionData({
    abi: safeAbi,
    functionName: "execTransaction",
    args: [to, 0n, data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, signature],
  });
  const sent = await sendOk(ctx, "owner", ctx.d.safe, execData, `Safe: ${label}`);
  ctx.safeNonce = nonce + 1n;
  return sent;
}

export const gateCall = (ctx: Ctx, functionName: string, args: unknown[]) => encodeFunctionData({ abi: ctx.abis.gate, functionName, args } as never);
export const escrowCall = (ctx: Ctx, functionName: string, args: unknown[]) => encodeFunctionData({ abi: ctx.abis.escrow, functionName, args } as never);

export function gateEvents(ctx: Ctx, logs: Log[]) {
  const out: { eventName: string; args: Record<string, unknown> }[] = [];
  for (const log of logs) {
    if (log.address.toLowerCase() !== ctx.d.fundingGate.toLowerCase()) continue;
    try {
      const e = decodeEventLog({ abi: ctx.abis.gate, data: log.data, topics: log.topics });
      out.push({ eventName: String(e.eventName), args: (e.args ?? {}) as Record<string, unknown> });
    } catch {
      // not a gate event
    }
  }
  return out;
}

// Waits until the latest block's timestamp reaches `target`, printing the time left. On a real
// chain this is real time; the fork test moves time with evm_increaseTime before calling.
export async function waitUntil(ctx: Ctx, target: bigint, what: string): Promise<void> {
  let last = 0;
  let seenTs = 0n;
  let seenAt = Date.now();
  for (;;) {
    const { number, timestamp: now } = await latestBlock(ctx);
    if (now !== seenTs) {
      seenTs = now;
      seenAt = Date.now();
    } else if (Date.now() - seenAt > 120_000) {
      throw new PreconditionError(`no new block for 2 minutes while waiting for ${what}: is the chain producing blocks? (anvil needs --block-time)`);
    }
    if (now >= target) {
      if (last) process.stdout.write("\n");
      // Later reads must see this block (its timestamp is what activated the change)
      seeBlock(ctx, number);
      return;
    }
    const left = Number(target - now);
    if (Date.now() - last > 10_000) {
      process.stdout.write(`\r  waiting for ${what}: ${Math.floor(left / 60)}m ${String(left % 60).padStart(2, "0")}s left   `);
      last = Date.now();
    }
    await sleep(2_000);
  }
}
