// The Trade gate (FundingGate, Area 1) as the agent sees it: what it reads before deciding a
// deposit and the exact call it sends. Mirrors contracts/src/FundingGate.sol.
// The gate builds approve + fund itself and checks the PDR binds keccak256(abi.encode(approveData,
// fundData)), so `safeCalldata` returns exactly those bytes (engine/src/fundingGate.test.ts).
import type { FundIntent, Hex } from "@keel/schemas";
import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, erc20Abi, parseAbi } from "viem";
import type { AgentChain, FundingGatePort } from "./agent";
import { ESCROW_ABI } from "./escrow";

export const FUNDING_GATE_ABI = parseAbi([
  "struct FundIntent { bytes32 orderId; bytes32 orderHash; address escrow; address token; uint256 amount; uint64 deadline; uint256 nonce; }",
  "struct PolicyDecision { bytes32 intentHash; bytes32 calldataHash; bytes32 policyHash; bytes32 inputsHash; uint8 tier; uint64 expiresAt; }",
  "function execute(FundIntent intent, PolicyDecision d, bytes sigPolicy, bytes sigCosigner)",
  "function isKnownSupplier(address exporter, address payout) view returns (bool)",
  "function hasRole(address party, uint8 role) view returns (bool)",
  "function token() view returns (address)",
  "function roles() view returns (address)",
  "function agentRoleKey() view returns (bytes32)",
]);

// Role bits of the third-party registry
export const GATE_ROLES = { carrier: 1, arbiter: 2, verifier: 4 } as const;
export type GateRole = keyof typeof GATE_ROLES;

// Remaining allowance of the agent role in the current period. Where it is read depends on the
// Roles deployment: the demo reads MockTradeRoles; the real Zodiac Roles reader goes with T1.7.
export type AllowanceReader = () => Promise<bigint>;

// The calldata the Safe executes through Roles, in the encoding the gate hashes.
export function fundingCalldata(intent: FundIntent): Hex {
  const approveData = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [intent.escrow, intent.amount] });
  const fundData = encodeFunctionData({ abi: ESCROW_ABI, functionName: "fund", args: [intent.orderId] });
  return encodeAbiParameters([{ type: "bytes" }, { type: "bytes" }], [approveData, fundData]);
}

export function fundingGatePort(chain: AgentChain, address: Hex, allowance: AllowanceReader): FundingGatePort {
  const read = async <T>(functionName: string, args: readonly unknown[] = []): Promise<T> => {
    const data = encodeFunctionData({ abi: FUNDING_GATE_ABI, functionName, args } as never);
    return decodeFunctionResult({ abi: FUNDING_GATE_ABI, functionName, data: await chain.call({ to: address, data }) } as never) as T;
  };
  let token: Promise<Hex> | undefined;
  return {
    address,
    allowance: async () => ({ token: await (token ??= read<Hex>("token")), remaining: await allowance() }),
    isKnownSupplier: (exporter, payout) => read<boolean>("isKnownSupplier", [exporter, payout]),
    hasRole: (party, role) => read<boolean>("hasRole", [party, GATE_ROLES[role]]),
    safeCalldata: fundingCalldata,
    // Tier 1 carries no cosignature; tier 3 waits for it (Area 4) and is not sent from here yet
    executeCall: (intent, signed) => ({
      to: address,
      data: encodeFunctionData({ abi: FUNDING_GATE_ABI, functionName: "execute", args: [intent, signed.decision, signed.signature, "0x"] }),
    }),
  };
}

// Allowance reader for MockTradeRoles (`remaining(bytes32)`), the Roles stand-in of the demo.
export function mockRolesAllowance(chain: AgentChain, roles: Hex, roleKey: Hex): AllowanceReader {
  const abi = parseAbi(["function remaining(bytes32 role) view returns (uint256)"]);
  return async () => {
    const data = await chain.call({ to: roles, data: encodeFunctionData({ abi, functionName: "remaining", args: [roleKey] }) });
    return decodeFunctionResult({ abi, functionName: "remaining", data });
  };
}

// What the CLI needs to wire a deployed gate: its Roles module and the agent role key.
export async function gateDeployment(chain: AgentChain, address: Hex): Promise<{ roles: Hex; agentRoleKey: Hex }> {
  const read = async <T>(functionName: "roles" | "agentRoleKey"): Promise<T> => {
    const data = encodeFunctionData({ abi: FUNDING_GATE_ABI, functionName });
    return decodeFunctionResult({ abi: FUNDING_GATE_ABI, functionName, data: await chain.call({ to: address, data }) }) as T;
  };
  return { roles: await read<Hex>("roles"), agentRoleKey: await read<Hex>("agentRoleKey") };
}
