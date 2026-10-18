// Revert names for the holds of the agent. A simulation can revert in the escrow, in the Trade
// gate, in the Roles Modifier the gate calls, or in the token: each one is named, never guessed.
import type { Hex } from "@keel/schemas";
import { type Abi, decodeErrorResult, parseAbi } from "viem";
import { ESCROW_ABI } from "./escrow";
import { FUNDING_GATE_ABI } from "./gate";

// Zodiac Roles Modifier v2 errors the deposit can hit (mirrored by MockTradeRoles)
export const ROLES_ERRORS_ABI = parseAbi([
  "error NoMembership()",
  "error ConditionViolation(uint8 status, bytes32 info)",
  "error ModuleTransactionFailed()",
]);

// OpenZeppelin token errors (SafeERC20, IERC20Errors) a transfer inside a step can bubble up
export const TOKEN_ERRORS_ABI = parseAbi([
  "error SafeERC20FailedOperation(address token)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
]);

const errorsOf = (abi: Abi): Abi => abi.filter((x) => x.type === "error");

// ZeroAddress() is declared by the escrow and the gate with the same selector: either name fits
export const REVERT_ABI: Abi = [...errorsOf(ESCROW_ABI), ...errorsOf(FUNDING_GATE_ABI), ...errorsOf(ROLES_ERRORS_ABI), ...errorsOf(TOKEN_ERRORS_ABI)];

// The error name of a revert, for the reason of a hold. Unknown data stays as hex.
export function revertName(data: Hex | undefined): string {
  if (!data || data === "0x") return "REVERTED";
  try {
    return decodeErrorResult({ abi: REVERT_ABI, data }).errorName;
  } catch {
    return data;
  }
}
