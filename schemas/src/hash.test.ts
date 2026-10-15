import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createEVM } from "@ethereumjs/evm";
import solc from "solc";
import {
  type Abi,
  encodeAbiParameters,
  bytesToHex,
  decodeFunctionResult,
  encodeFunctionData,
  hexToBytes,
  keccak256,
  recoverAddress,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { beforeAll, describe, expect, it } from "vitest";
import {
  blNumberHash,
  bytes32Text,
  docsHash,
  domainSeparator,
  paymentIntentHash,
  requiredDocsHash,
  structHash,
  typedDataDigest,
} from "./hash";
import {
  type CancelOrder,
  type DisputeResolution,
  type DocumentDecision,
  EIP712_TYPES,
  type Eip712Messages,
  type Eip712Type,
  type FundIntent,
  type Hex,
  keelDomain,
  type PaymentIntent,
  type PolicyDecision,
  type PurchaseOrder,
  type ShipmentAttestation,
} from "./index";

const CONTRACTS = fileURLToPath(new URL("../../contracts/", import.meta.url));
const HARNESS = "test/KeelHashHarness.sol";

// Compiles the harness with the settings of contracts/foundry.toml and runs its
// runtime bytecode in a local EVM. Every function of the harness is pure.
async function loadHarness() {
  const input = {
    language: "Solidity",
    sources: { [HARNESS]: { content: readFileSync(CONTRACTS + HARNESS, "utf8") } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.deployedBytecode.object"] } },
    },
  };
  const findImports = (path: string) => ({ contents: readFileSync(CONTRACTS + path, "utf8") });
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  const errors = (output.errors ?? []).filter((e: { severity: string }) => e.severity === "error");
  if (errors.length > 0) throw new Error(errors.map((e: { formattedMessage: string }) => e.formattedMessage).join("\n"));

  const contract = output.contracts[HARNESS].KeelHashHarness;
  const abi = contract.abi as Abi;
  const code = hexToBytes(`0x${contract.evm.deployedBytecode.object}`);
  const evm = await createEVM();

  return async (functionName: string, args: unknown[]): Promise<Hex> => {
    const data = hexToBytes(encodeFunctionData({ abi, functionName, args }));
    const result = await evm.runCode({ code, data, gasLimit: 10_000_000n });
    if (result.exceptionError) throw new Error(`${functionName} reverted: ${result.exceptionError.error}`);
    return decodeFunctionResult({ abi, functionName, data: bytesToHex(result.returnValue) }) as Hex;
  };
}

const address = (n: number): Hex => `0x${n.toString(16).padStart(40, "0")}`;
const word = (label: string): Hex => keccak256(toBytes(label));

const order: PurchaseOrder = {
  orderId: word("PO-2026-0042"),
  importer: address(0xa1),
  exporter: address(0xb2),
  payoutAddress: address(0xb3),
  token: address(0xc4),
  totalAmount: 10_000_000_000n,
  advanceBps: 5000,
  shipmentDeadline: 1_793_491_200n,
  disputeWindow: 604_800n,
  carrier: address(0xd5),
  arbiter: address(0xe6),
  incoterm: bytes32Text("CIF"),
  termsHash: word("terms"),
  requiredDocsHash: requiredDocsHash(["BILL_OF_LADING", "COMMERCIAL_INVOICE"]),
  nonce: 7n,
};

const attestation: ShipmentAttestation = {
  orderId: order.orderId,
  blNumberHash: blNumberHash(order.carrier, "EGLV123456789"),
  onBoardDate: 1_792_886_400n,
  portOfLoading: bytes32Text("CNSZX"),
  docsHash: docsHash([word("bl.pdf"), word("invoice.pdf")]),
};

const cancel: CancelOrder = { orderId: order.orderId, nonce: 8n };

const resolution: DisputeResolution = { orderId: order.orderId, toImporter: 3_000_000_000n, toExporter: 2_000_000_000n };

const intent: FundIntent = {
  orderId: order.orderId,
  orderHash: structHash("PurchaseOrder", order),
  escrow: address(0xf7),
  token: order.token,
  amount: order.totalAmount,
  deadline: 1_792_000_000n,
  nonce: 1n,
};

const policyDecision: PolicyDecision = {
  intentHash: structHash("FundIntent", intent),
  calldataHash: word("calldata"),
  policyHash: word("policy"),
  inputsHash: word("inputs"),
  tier: 3,
  expiresAt: 1_792_000_600n,
};

const documentDecision: DocumentDecision = {
  orderId: order.orderId,
  attestationHash: structHash("ShipmentAttestation", attestation),
  docsHash: attestation.docsHash,
  policyHash: word("policy"),
  inputsHash: word("extractions"),
  expiresAt: 1_792_900_000n,
};

const samples: { [T in Eip712Type]: Eip712Messages[T] } = {
  PurchaseOrder: order,
  ShipmentAttestation: attestation,
  CancelOrder: cancel,
  DisputeResolution: resolution,
  FundIntent: intent,
  PolicyDecision: policyDecision,
  DocumentDecision: documentDecision,
};

// The largest value of each field type, to catch a wrong width or padding.
const maxOf = (type: string): unknown => {
  if (type === "address") return `0x${"ff".repeat(20)}`;
  if (type === "bytes32") return `0x${"ff".repeat(32)}`;
  const bits = Number(type.slice(4));
  const max = 2n ** BigInt(bits) - 1n;
  return bits <= 32 ? Number(max) : max;
};

const TYPES = Object.keys(EIP712_TYPES) as Eip712Type[];
const domain = keelDomain(31337, address(0x1234));

describe("EIP-712 hashes: TypeScript against Solidity (T2.1)", () => {
  let solidity: Awaited<ReturnType<typeof loadHarness>>;
  beforeAll(async () => {
    solidity = await loadHarness();
  }, 120_000);

  it.each(TYPES)("%s: same struct hash", async (type) => {
    expect(await solidity(`hash${type}`, [samples[type]])).toBe(structHash(type, samples[type]));
  });

  it.each(TYPES)("%s: same struct hash at the limits of every field", async (type) => {
    const extreme = Object.fromEntries(EIP712_TYPES[type].map((f) => [f.name, maxOf(f.type)])) as never;
    expect(await solidity(`hash${type}`, [extreme])).toBe(structHash(type, extreme));
  });

  it.each(TYPES)("%s: a change in any field changes the hash", (type) => {
    const base = structHash(type, samples[type]);
    for (const field of EIP712_TYPES[type]) {
      const changed = { ...samples[type], [field.name]: maxOf(field.type) } as never;
      expect(structHash(type, changed), field.name).not.toBe(base);
    }
  });

  it("PaymentIntent: KeelHash.sol matches the Personal hash the engine signs", async () => {
    const payment: PaymentIntent = {
      aliasId: 2,
      recipient: address(0xb0b),
      amountUsdc: 45_300_000n,
      invoiceKey: word("invoice"),
      deadline: 1_762_300_800n,
      nonce: 7n,
    };
    expect(await solidity("hashPaymentIntent", [payment])).toBe(paymentIntentHash(payment));
  });

  it("same domain separator", async () => {
    expect(await solidity("domainSeparator", [BigInt(domain.chainId), domain.verifyingContract])).toBe(
      domainSeparator(domain),
    );
  });

  it.each(TYPES)("%s: same digest to sign", async (type) => {
    const digest = await solidity("digest", [domainSeparator(domain), structHash(type, samples[type])]);
    expect(digest).toBe(typedDataDigest(domain, type, samples[type]));
  });

  it("a wallet signature over the typed data recovers against the Solidity digest", async () => {
    const importer = privateKeyToAccount(word("test importer key"));
    const signature = await importer.signTypedData({
      domain,
      types: EIP712_TYPES,
      primaryType: "PurchaseOrder",
      message: order,
    });
    const digest = await solidity("digest", [
      await solidity("domainSeparator", [BigInt(domain.chainId), domain.verifyingContract]),
      await solidity("hashPurchaseOrder", [order]),
    ]);
    expect(await recoverAddress({ hash: digest, signature })).toBe(importer.address);
  });

  it("the digest is bound to the chain and to the verifying contract", () => {
    const digest = typedDataDigest(domain, "PurchaseOrder", order);
    expect(typedDataDigest(keelDomain(1, domain.verifyingContract), "PurchaseOrder", order)).not.toBe(digest);
    expect(typedDataDigest(keelDomain(domain.chainId, address(0x5678)), "PurchaseOrder", order)).not.toBe(digest);
  });

  it("bytes32 text matches bytes32(\"...\") in Solidity", async () => {
    for (const text of ["CIF", "EXW", "CNSZX", "CLVAP"]) {
      expect(await solidity("bytes32Text", [text])).toBe(bytes32Text(text));
    }
  });
});

describe("field hashes", () => {
  it("blNumberHash takes the number exactly as the extractor returns it", () => {
    const carrier = order.carrier;
    expect(blNumberHash(carrier, "EGLV123456789")).toBe(
      keccak256(encodeAbiParameters([{ type: "address" }, { type: "string" }], [carrier, "EGLV123456789"])),
    );
    expect(() => blNumberHash(carrier, "eglv123456789")).toThrow();
    expect(() => blNumberHash(carrier, "EGLV-123456789")).toThrow();
  });

  it("blNumberHash depends on the carrier: the same number at two carriers is two different BLs", () => {
    expect(blNumberHash(address(0xd5), "EGLV123456789")).not.toBe(blNumberHash(address(0xd6), "EGLV123456789"));
  });

  it("requiredDocsHash ignores order and duplicates", () => {
    const expected = requiredDocsHash(["BILL_OF_LADING", "COMMERCIAL_INVOICE"]);
    expect(requiredDocsHash(["COMMERCIAL_INVOICE", "BILL_OF_LADING", "COMMERCIAL_INVOICE"])).toBe(expected);
    expect(requiredDocsHash(["AIR_WAYBILL", "COMMERCIAL_INVOICE"])).not.toBe(expected);
    expect(() => requiredDocsHash([])).toThrow();
  });

  it("docsHash ignores the upload order and changes with any file", () => {
    const [a, b, c] = [word("bl.pdf"), word("invoice.pdf"), word("other.pdf")];
    expect(docsHash([b, a])).toBe(docsHash([a, b]));
    expect(docsHash([a, c])).not.toBe(docsHash([a, b]));
    expect(() => docsHash([a, a])).toThrow("same file twice");
    expect(() => docsHash([])).toThrow();
  });

  it("bytes32Text rejects anything that is not short uppercase text", () => {
    expect(() => bytes32Text("cif")).toThrow();
    expect(() => bytes32Text("")).toThrow();
    expect(() => bytes32Text("A".repeat(32))).toThrow();
  });
});
