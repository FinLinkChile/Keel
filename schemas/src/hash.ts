// Hashing of the shared interfaces. Imported as `@keel/schemas/hash`.
// It must match contracts/src/KeelHash.sol byte for byte: hash.test.ts runs both.
import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  hashDomain,
  hashStruct,
  hashTypedData,
  keccak256,
  parseAbi,
  stringToHex,
  toBytes,
  toFunctionSelector,
} from "viem";
import {
  API_EIP712_TYPES,
  apiDomain,
  EIP712_TYPES,
  type Eip712Messages,
  type Eip712Type,
  type Hex,
  type KeelDomain,
  OrderTerms as OrderTermsSchema,
  type OrderTerms,
  PERSONAL_EIP712_TYPES,
  TERMS_EIP712_TYPES,
  type PaymentIntent,
  type RequiredDocType,
} from "./index";

const EIP712_DOMAIN = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
] as const;

// EIP-712 `hashStruct` of a message. This is what goes in `intentHash` and `attestationHash`.
export function structHash<T extends Eip712Type>(primaryType: T, message: Eip712Messages[T]): Hex {
  return hashStruct({ types: EIP712_TYPES, primaryType, data: message } as never);
}

// Keel Personal: EIP-712 `hashStruct` of a PaymentIntent, the `intentHash` PDRGate recomputes.
export function paymentIntentHash(intent: PaymentIntent): Hex {
  return hashStruct({ types: PERSONAL_EIP712_TYPES, primaryType: "PaymentIntent", data: intent } as never);
}

export function domainSeparator(domain: KeelDomain): Hex {
  return hashDomain({ domain: { ...domain, chainId: BigInt(domain.chainId) }, types: { EIP712Domain: EIP712_DOMAIN } });
}

// The digest that gets signed: keccak256(0x1901, domainSeparator, structHash).
export function typedDataDigest<T extends Eip712Type>(
  domain: KeelDomain,
  primaryType: T,
  message: Eip712Messages[T],
): Hex {
  return hashTypedData({ domain, types: EIP712_TYPES, primaryType, message } as never);
}

// Short ASCII text as bytes32, right padded with zeros. Same as `bytes32("CIF")` in
// Solidity. Used for `incoterm` and `portOfLoading`.
export function bytes32Text(text: string): Hex {
  if (!/^[A-Z0-9]{1,31}$/.test(text)) throw new Error(`not a valid bytes32 text: ${text}`);
  return stringToHex(text, { size: 32 });
}

// keccak256(abi.encode(carrier, number)), with the number exactly as the extractor
// returns it (`document_number`: uppercase, no separators). A BL number is unique per
// carrier, not globally, so the carrier is part of the key.
export function blNumberHash(carrier: Hex, documentNumber: string): Hex {
  if (!/^[A-Z0-9]{6,20}$/.test(documentNumber)) throw new Error(`not a valid document number: ${documentNumber}`);
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "string" }], [carrier, documentNumber]));
}

// keccak256 of the required document names, sorted, without duplicates, joined with commas.
export function requiredDocsHash(docs: readonly RequiredDocType[]): Hex {
  if (docs.length === 0) throw new Error("an order requires at least one document");
  return keccak256(toBytes([...new Set(docs)].sort().join(",")));
}

// `termsHash` of the order: the EIP-712 hashStruct of its terms, exactly
//   keccak256(abi.encode(
//     keccak256("OrderTerms(string orderNumber,string currency,uint256 invoiceAmountMinor,string[] hsCodes,bytes32 documentHash)"),
//     keccak256(bytes(orderNumber)), keccak256(bytes(currency)), invoiceAmountMinor,
//     keccak256(abi.encodePacked(keccak256(bytes(hsCodes[0])), ..., keccak256(bytes(hsCodes[n])))),
//     documentHash))
// with the HS codes deduplicated and sorted ascending first, so their order does not change
// the hash, and documentHash = keccak256 of the bytes of the file the order comes from: when it
// comes from a proforma, the fileHash that POST /trade/proforma returns (decided by Area 4 in the
// #66 review). All strings are ASCII, as the schema patterns require. No domain: it is a struct hash.
export function termsHash(terms: OrderTerms): Hex {
  const parsed = OrderTermsSchema.parse(terms);
  const data = { ...parsed, hsCodes: [...new Set(parsed.hsCodes)].sort() };
  return hashStruct({ types: TERMS_EIP712_TYPES, primaryType: "OrderTerms", data } as never);
}

// Hash of a document package: keccak256 of the concatenated keccak256 of each file,
// sorted, so the order in which the files were uploaded does not matter.
export function docsHash(fileHashes: readonly Hex[]): Hex {
  if (fileHashes.length === 0) throw new Error("a document package has at least one file");
  for (const h of fileHashes) if (!/^0x[0-9a-f]{64}$/.test(h)) throw new Error(`not a lowercase bytes32: ${h}`);
  // The same file twice is not a different package
  if (new Set(fileHashes).size !== fileHashes.length) throw new Error("a document package lists the same file twice");
  return keccak256(concat([...fileHashes].sort()));
}

// Keel Trade: the Zodiac Roles configuration of an importer Safe and its hash, the
// `rolesConfigHash` of the Trade policy. Mirrors contracts/script/TradeRolesConfig.sol (T1.7):
// the same ordered calls the Safe makes on its Roles instance, and
// keccak256(abi.encode(Call[] { address to; bytes data })) with `to` left as zero (each Safe has
// its own Roles instance). hash.test.ts runs both.
export interface TradeRolesParams {
  token: Hex;
  escrow: Hex;
  gate: Hex;
  agentRole: Hex;
  cosignedRole: Hex;
  agentAllowanceKey: Hex;
  cosignedAllowanceKey: Hex;
  agentCap: bigint;
  cosignedCap: bigint;
  period: bigint;
}

// Zodiac Roles v2.1.1 (gnosisguild/zodiac-modifier-roles, commit 218a5164): the builders Keel calls
const ROLES_BUILDER_ABI = parseAbi([
  "struct ConditionFlat { uint8 parent; uint8 paramType; uint8 operator; bytes compValue; }",
  "function scopeTarget(bytes32 roleKey, address targetAddress)",
  "function scopeFunction(bytes32 roleKey, address targetAddress, bytes4 selector, ConditionFlat[] conditions, uint8 options)",
  "function allowFunction(bytes32 roleKey, address targetAddress, bytes4 selector, uint8 options)",
  "function setAllowance(bytes32 key, uint128 balance, uint128 maxRefill, uint128 refill, uint64 period, uint64 timestamp)",
  "function assignRoles(address module, bytes32[] roleKeys, bool[] memberOf)",
]);
// Types.sol at 218a5164: ParameterType Static = 1, Calldata = 5; Operator Matches = 5,
// EqualTo = 16, WithinAllowance = 28; ExecutionOptions None = 0
const STATIC = 1;
const CALLDATA = 5;
const MATCHES = 5;
const EQUAL_TO = 16;
const WITHIN_ALLOWANCE = 28;
const NO_OPTIONS = 0;
const APPROVE = toFunctionSelector("approve(address,uint256)");
const FUND = toFunctionSelector("fund(bytes32)");
const ZERO = "0x0000000000000000000000000000000000000000";

export function tradeRolesConfigCalls(p: TradeRolesParams): { to: Hex; data: Hex }[] {
  const call = (data: Hex) => ({ to: ZERO as Hex, data });
  const role = (roleKey: Hex, key: Hex, cap: bigint) => [
    call(encodeFunctionData({ abi: ROLES_BUILDER_ABI, functionName: "scopeTarget", args: [roleKey, p.token] })),
    call(
      encodeFunctionData({
        abi: ROLES_BUILDER_ABI,
        functionName: "scopeFunction",
        args: [
          roleKey,
          p.token,
          APPROVE,
          // approve(spender, amount): spender is the escrow, amount within the allowance `key`
          [
            { parent: 0, paramType: CALLDATA, operator: MATCHES, compValue: "0x" },
            { parent: 0, paramType: STATIC, operator: EQUAL_TO, compValue: encodeAbiParameters([{ type: "address" }], [p.escrow]) },
            { parent: 0, paramType: STATIC, operator: WITHIN_ALLOWANCE, compValue: key },
          ],
          NO_OPTIONS,
        ],
      }),
    ),
    call(encodeFunctionData({ abi: ROLES_BUILDER_ABI, functionName: "scopeTarget", args: [roleKey, p.escrow] })),
    call(encodeFunctionData({ abi: ROLES_BUILDER_ABI, functionName: "allowFunction", args: [roleKey, p.escrow, FUND, NO_OPTIONS] })),
    call(encodeFunctionData({ abi: ROLES_BUILDER_ABI, functionName: "setAllowance", args: [key, cap, cap, cap, p.period, 0n] })),
  ];
  return [
    ...role(p.agentRole, p.agentAllowanceKey, p.agentCap),
    ...role(p.cosignedRole, p.cosignedAllowanceKey, p.cosignedCap),
    call(encodeFunctionData({ abi: ROLES_BUILDER_ABI, functionName: "assignRoles", args: [p.gate, [p.agentRole, p.cosignedRole], [true, true]] })),
  ];
}

// The ApiRequest a client signs for the Keel API (./api.ts). The same builder as
// aws/src/auth.ts `apiRequestTypedData`, here so the app can build it without importing the
// aws package (and its AWS SDK); app/src/data/api.test.ts checks both against `authenticate`.
// `body` is the raw body exactly as sent ("" for none).
export const apiBodyHash = (body: string): Hex => keccak256(toBytes(body));

export function apiRequestTypedData(chainId: number, method: string, path: string, body: string, issuedAt: number) {
  return {
    domain: apiDomain(chainId),
    types: API_EIP712_TYPES,
    primaryType: "ApiRequest" as const,
    message: { method: method.toUpperCase(), path, bodyHash: apiBodyHash(body), issuedAt: BigInt(issuedAt) },
  };
}

export function tradeRolesConfigHash(p: TradeRolesParams): Hex {
  const calls = tradeRolesConfigCalls(p);
  return keccak256(
    encodeAbiParameters([{ type: "tuple[]", components: [{ name: "to", type: "address" }, { name: "data", type: "bytes" }] }], [calls]),
  );
}
