// Test helper: compiles the real contracts with solc 0.8.26 (settings of contracts/foundry.toml)
// and runs them in a local EVM, so engine tests check against the contracts Area 1 ships.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createEVM } from "@ethereumjs/evm";
import { createAddressFromString, createZeroAddress } from "@ethereumjs/util";
import solc from "solc";
import {
  type Abi,
  bytesToHex,
  decodeErrorResult,
  decodeFunctionResult,
  encodeDeployData,
  encodeFunctionData,
  type Hex,
  hexToBytes,
} from "viem";

const CONTRACTS = fileURLToPath(new URL("../../../contracts/", import.meta.url));
const REMAPPINGS = ["@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/", "forge-std/=lib/forge-std/src/"];

type Artifact = { abi: Abi; bytecode: Hex };

export function compile(sources: string[]): Record<string, Artifact> {
  const input = {
    language: "Solidity",
    sources: Object.fromEntries(sources.map((s) => [s, { content: readFileSync(CONTRACTS + s, "utf8") }])),
    settings: {
      remappings: REMAPPINGS,
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const findImports = (path: string) => ({ contents: readFileSync(CONTRACTS + path, "utf8") });
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  const errors = (output.errors ?? []).filter((e: { severity: string }) => e.severity === "error");
  if (errors.length > 0) throw new Error(errors.map((e: { formattedMessage: string }) => e.formattedMessage).join("\n"));

  const artifacts: Record<string, Artifact> = {};
  for (const file of Object.values(output.contracts) as Record<string, { abi: Abi; evm: { bytecode: { object: string } } }>[]) {
    for (const [name, c] of Object.entries(file)) artifacts[name] = { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` };
  }
  return artifacts;
}

export class RevertError extends Error {
  constructor(readonly errorName: string) {
    super(`reverted with ${errorName}`);
  }
}

export async function createChain(artifacts: Record<string, Artifact>) {
  const evm = await createEVM();
  // Every custom error of every compiled contract, to name a revert
  const allErrors = Object.values(artifacts).flatMap((a) => a.abi.filter((x) => x.type === "error"));
  let timestamp = 1_762_000_000n;

  const block = () => ({
    header: {
      number: 1n,
      coinbase: createZeroAddress(),
      timestamp,
      difficulty: 0n,
      prevRandao: new Uint8Array(32),
      gasLimit: 30_000_000n,
      baseFeePerGas: 0n,
      getBlobGasPrice: () => 0n,
    },
  });

  async function run(from: Hex, to: Hex | undefined, data: Hex) {
    const result = await evm.runCall({
      caller: createAddressFromString(from),
      to: to ? createAddressFromString(to) : undefined,
      data: hexToBytes(data),
      gasLimit: 30_000_000n,
      skipBalance: true,
      block: block(),
    });
    if (result.execResult.exceptionError) {
      const raw = bytesToHex(result.execResult.returnValue);
      let name: string = raw;
      try {
        name = decodeErrorResult({ abi: allErrors, data: raw }).errorName;
      } catch {
        // Not a custom error: keep the raw bytes (string reverts, panics)
      }
      throw new RevertError(name);
    }
    return result;
  }

  // Every log of a sent transaction with the time of its block, like eth_getLogs plus the block
  const history: { address: Hex; topics: Hex[]; data: Hex; timestamp: bigint }[] = [];

  async function sendRaw(from: Hex, to: Hex, data: Hex) {
    const result = await run(from, to, data);
    const logs = (result.execResult.logs ?? []).map(([address, topics, data]) => ({
      address: bytesToHex(address),
      topics: topics.map((t) => bytesToHex(t)),
      data: bytesToHex(data),
    }));
    history.push(...logs.map((l) => ({ ...l, timestamp })));
    return logs;
  }

  return {
    setTime(t: bigint) {
      timestamp = t;
    },
    async deploy(name: string, args: unknown[], from: Hex): Promise<Hex> {
      const { abi, bytecode } = artifacts[name]!;
      const result = await run(from, undefined, encodeDeployData({ abi, bytecode, args }));
      return result.createdAddress!.toString() as Hex;
    },
    // Returns the logs, in the shape an RPC receipt gives them
    async send(name: string, to: Hex, functionName: string, args: unknown[], from: Hex) {
      return sendRaw(from, to, encodeFunctionData({ abi: artifacts[name]!.abi, functionName, args }));
    },
    sendRaw,
    // Like eth_call: runs the call and throws its effects away
    async simulate(from: Hex, to: Hex, data: Hex): Promise<Hex> {
      await evm.stateManager.checkpoint();
      try {
        return bytesToHex((await run(from, to, data)).execResult.returnValue);
      } finally {
        await evm.stateManager.revert();
      }
    },
    time: () => timestamp,
    logs: () => history,
    async read<T = unknown>(name: string, to: Hex, functionName: string, args: unknown[] = []): Promise<T> {
      const abi = artifacts[name]!.abi;
      const result = await run(`0x${"00".repeat(19)}01`, to, encodeFunctionData({ abi, functionName, args }));
      return decodeFunctionResult({ abi, functionName, data: bytesToHex(result.execResult.returnValue) }) as T;
    },
    calldata(name: string, functionName: string, args: unknown[]): Hex {
      return encodeFunctionData({ abi: artifacts[name]!.abi, functionName, args });
    },
  };
}
