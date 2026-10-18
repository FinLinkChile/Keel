// ABIs: the Keel contracts from the Foundry build (contracts/out, `forge build` first) and the
// slices of Safe 1.4.1 the script calls. Every revert is decoded against `errors`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Abi, decodeErrorResult, type Hex, parseAbi } from "viem";
import { PreconditionError } from "./config";

type AbiError = Extract<Abi[number], { type: "error" }>;

export interface Abis {
  gate: Abi;
  escrow: Abi;
  roles: Abi;
  // Every custom error of the gate, the escrow and Roles, once each
  errors: Abi;
}

function artifact(outDir: string, file: string, name: string): Abi {
  const path = join(outDir, file, `${name}.json`);
  try {
    return (JSON.parse(readFileSync(path, "utf8")) as { abi: Abi }).abi;
  } catch {
    throw new PreconditionError(`missing ${path}: run \`forge build\` in contracts/ first`);
  }
}

export function loadAbis(outDir: string): Abis {
  const gate = artifact(outDir, "FundingGate.sol", "FundingGate");
  const escrow = artifact(outDir, "TradeEscrow.sol", "TradeEscrow");
  const roles = artifact(outDir, "TradeRolesConfig.sol", "IZodiacRolesV2");
  const seen = new Set<string>();
  const errors: AbiError[] = [];
  for (const item of [...gate, ...escrow, ...roles]) {
    if (item.type !== "error") continue;
    const sig = `${item.name}(${item.inputs.map((i) => i.type).join(",")})`;
    if (!seen.has(sig)) {
      seen.add(sig);
      errors.push(item);
    }
  }
  return { gate, escrow, roles, errors };
}

// safe-smart-account v1.4.1: contracts/Safe.sol, base/OwnerManager.sol, base/ModuleManager.sol
export const safeAbi = parseAbi([
  "function nonce() view returns (uint256)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function isOwner(address owner) view returns (bool)",
  "function domainSeparator() view returns (bytes32)",
  "function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)",
  "function addOwnerWithThreshold(address owner, uint256 _threshold)",
]);

export interface DecodedError {
  name: string;
  args: string[];
  data: Hex;
}

const show = (v: unknown): string => (typeof v === "string" ? v : typeof v === "bigint" ? v.toString() : JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));

// Error(string) and Panic(uint256) are decoded by viem itself. Unknown data keeps its selector.
export function decodeRevert(abis: Abis, data: Hex): DecodedError {
  if (data === "0x") return { name: "(empty revert data)", args: [], data };
  try {
    const r = decodeErrorResult({ abi: abis.errors, data });
    return { name: r.errorName, args: (r.args ?? []).map(show), data };
  } catch {
    return { name: `(unknown selector ${data.slice(0, 10)})`, args: [], data };
  }
}
