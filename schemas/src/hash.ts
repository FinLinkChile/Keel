// Hashing of the shared interfaces. Imported as `@keel/schemas/hash`.
// It must match contracts/src/KeelHash.sol byte for byte: hash.test.ts runs both.
import { concat, hashDomain, hashStruct, hashTypedData, keccak256, stringToHex, toBytes } from "viem";
import {
  EIP712_TYPES,
  type Eip712Messages,
  type Eip712Type,
  type Hex,
  type KeelDomain,
  PERSONAL_EIP712_TYPES,
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

// keccak256 of the document number exactly as the extractor returns it
// (`document_number`: uppercase, no separators).
export function blNumberHash(documentNumber: string): Hex {
  if (!/^[A-Z0-9]{6,20}$/.test(documentNumber)) throw new Error(`not a valid document number: ${documentNumber}`);
  return keccak256(toBytes(documentNumber));
}

// keccak256 of the required document names, sorted, without duplicates, joined with commas.
export function requiredDocsHash(docs: readonly RequiredDocType[]): Hex {
  if (docs.length === 0) throw new Error("an order requires at least one document");
  return keccak256(toBytes([...new Set(docs)].sort().join(",")));
}

// Hash of a document package: keccak256 of the concatenated keccak256 of each file,
// sorted, so the order in which the files were uploaded does not matter.
export function docsHash(fileHashes: readonly Hex[]): Hex {
  if (fileHashes.length === 0) throw new Error("a document package has at least one file");
  for (const h of fileHashes) if (!/^0x[0-9a-f]{64}$/.test(h)) throw new Error(`not a lowercase bytes32: ${h}`);
  return keccak256(concat([...fileHashes].sort()));
}
