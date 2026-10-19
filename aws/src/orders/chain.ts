// What the orders API asks the chain, all read-only: whether a signature is valid for an address
// the way TradeEscrow will check it, the escrow's current cancelNonceOf, and a Safe's balance of
// the order token (GET /wallet). Nothing
// here signs or sends a transaction; submitting what the API stores is the agent's job.
//
// RPC endpoint: KEEL_RPC_URL when set (local runs), else the secret `rpc_url`.
import { EIP712_TYPES, type Eip712Type, type Hex, keelDomain } from "@keel/schemas";
import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  createPublicClient,
  hashTypedData,
  http,
  isAddressEqual,
  parseAbi,
  type PublicClient,
  RawContractError,
  recoverAddress,
} from "viem";
import type { Env } from "../config";
import { HttpError } from "../http";
import { secret } from "../secrets";

// The digest the escrow hashes (`_hashTypedDataV4`) for one of its structs
export function escrowDigest<T extends Eip712Type>(chainId: number, escrow: Hex, primaryType: T, message: unknown): Hex {
  return hashTypedData({
    domain: keelDomain(chainId, escrow),
    types: { [primaryType]: EIP712_TYPES[primaryType] },
    primaryType,
    message,
  } as never);
}

// Whether `signature` is valid for `signer` over `digest`, as OpenZeppelin's SignatureChecker in
// TradeEscrow decides it: an ECDSA signature that recovers to `signer`, or `signer` is a contract
// whose isValidSignature(digest, signature) returns the ERC-1271 magic value (a Safe through its
// CompatibilityFallbackHandler: an owner's signature of the SafeMessage, see
// app/src/data/signOrder.ts). Throws HttpError 502 when the chain cannot be asked.
export type SignatureVerifier = (signer: Hex, digest: Hex, signature: Hex) => Promise<boolean>;

export interface ChainDeps {
  verify: SignatureVerifier;
  // TradeEscrow.cancelNonceOf(orderId): (stateVersion << 8) | state
  cancelNonceOf(escrow: Hex, orderId: Hex): Promise<bigint>;
  // ERC-20 balanceOf(holder) of `token`, in token minor units
  balanceOf(token: Hex, holder: Hex): Promise<bigint>;
}

const ERC1271_MAGIC = "0x1626ba7e";
const ABI = parseAbi([
  "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)",
  "function cancelNonceOf(bytes32 orderId) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
]);

export const rpcUnavailable = () => new HttpError(502, "rpc_unavailable");

// A revert or an empty answer means "not valid"; anything else (network, node) is not an answer
const isRevert = (e: unknown) =>
  e instanceof BaseError &&
  !!e.walk((x) => x instanceof ContractFunctionRevertedError || x instanceof ContractFunctionZeroDataError || x instanceof RawContractError);

async function recovers(signer: Hex, digest: Hex, signature: Hex): Promise<boolean> {
  try {
    return isAddressEqual(await recoverAddress({ hash: digest, signature }), signer);
  } catch {
    return false;
  }
}

// Not viem's publicClient.verifyTypedData: that one also accepts ERC-6492 and ERC-8010 wrapped
// signatures of undeployed wallets, which SignatureChecker refuses. Storing such a signature would
// make the agent's `open` revert later, so the API asks exactly what the escrow will ask.
export function rpcChainDeps(client: Pick<PublicClient, "getCode" | "readContract">): ChainDeps {
  return {
    async verify(signer, digest, signature) {
      // ECDSA first, as SignatureChecker does: no RPC needed for an EOA
      if (await recovers(signer, digest, signature)) return true;
      let code: Hex | undefined;
      try {
        code = await client.getCode({ address: signer });
      } catch {
        throw rpcUnavailable();
      }
      if (!code || code === "0x") return false;
      try {
        const magic = await client.readContract({ address: signer, abi: ABI, functionName: "isValidSignature", args: [digest, signature] });
        return magic.toLowerCase() === ERC1271_MAGIC;
      } catch (e) {
        if (isRevert(e)) return false;
        throw rpcUnavailable();
      }
    },
    async cancelNonceOf(escrow, orderId) {
      try {
        return await client.readContract({ address: escrow, abi: ABI, functionName: "cancelNonceOf", args: [orderId] });
      } catch {
        throw rpcUnavailable();
      }
    },
    async balanceOf(token, holder) {
      try {
        return await client.readContract({ address: token, abi: ABI, functionName: "balanceOf", args: [holder] });
      } catch {
        throw rpcUnavailable();
      }
    },
  };
}

let override: ChainDeps | undefined;
let cached: Promise<ChainDeps> | undefined;

// For tests: a fake verifier (for example an ERC-1271 Safe) and a fixed cancel nonce
export function setChainDeps(deps: ChainDeps | undefined) {
  override = deps;
  cached = undefined;
}

export function chainDeps(env: Env = process.env): Promise<ChainDeps> {
  if (override) return Promise.resolve(override);
  cached ??= (async () => {
    const url = env.KEEL_RPC_URL ?? (await secret("rpc_url", env));
    return rpcChainDeps(createPublicClient({ transport: http(url) }));
  })();
  // A failed secret read is retried on the next request instead of being cached
  cached.catch(() => (cached = undefined));
  return cached;
}
