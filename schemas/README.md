# schemas (Area 2)

The shared interfaces of Keel. Every other package imports them as `@keel/schemas`.

The Keel Personal interfaces were frozen on Monday Oct 12. The Keel Trade interfaces are a **proposal** until the interface freeze on Wednesday Oct 14 at 20:00 (Chile time). After a freeze, a change requires notifying all five areas. The source is [docs/interfaces/](../docs/interfaces/index.md) and [docs/flujo/datos-firmados-e-interfaz.md](../docs/flujo/datos-firmados-e-interfaz.md).

## What is here

| File | Content |
|---|---|
| `src/index.ts` | Keel Trade: extraction schemas (zod), the signed structs as TypeScript types, `EIP712_TYPES`, the domain, event and error names, order states. Re-exports `src/personal.ts` |
| `src/personal.ts` | Keel Personal: `InvoiceExtraction`, `PaymentIntent`, `ALIAS_IDS`, `PAYMENT_STATES` |
| `src/hash.ts` | EIP-712 hashes and the field hashes of Keel Trade. Imported as `@keel/schemas/hash` |
| `json/*.schema.json` | The extraction schemas as JSON Schema, for the LLM structured output. The Keel Trade ones are generated from zod |
| `../contracts/src/KeelTypes.sol` | The same structs in Solidity, for both modes |
| `../contracts/src/KeelHash.sol` | The Keel Trade EIP-712 hashes in Solidity |

`InvoiceExtraction` and `PaymentIntent` stay for Keel Personal. Do not build Keel Trade components on them.

## Keel Trade interfaces

* **Document extraction**, with no free text: `TransportDocumentExtraction` (bill of lading or air waybill) and `CommercialInvoiceExtraction`. There is no name, description, bank detail or destination address in them.
* **Signed by the parties**: `PurchaseOrder` (importer and exporter), `ShipmentAttestation` (carrier), `CancelOrder` (importer and exporter), `DisputeResolution` (arbiter).
* **Signed by the policy engine**: `PolicyDecision` over a `FundIntent` (`PolicyDecision` is shared by both modes), and `DocumentDecision`.
* **Names**: `GATE_EVENTS`, `GATE_ERRORS`, `ESCROW_EVENTS`, `ESCROW_ERRORS`, `ESCROW_STATES`, `HOLD_STATES`.

The EIP-712 domain is `name = "Keel"`, `version = "1"`, `chainId`, and as `verifyingContract` the contract that checks the signature: PDRGate for `PolicyDecision`, TradeEscrow for everything else. The chain is a parameter, because the closed network is still an open decision.

## How the opaque fields are computed

| Field | Value | Helper |
|---|---|---|
| `incoterm`, `portOfLoading` | The text as bytes32, right padded: `bytes32("CIF")` in Solidity | `bytes32Text` |
| `blNumberHash` | keccak256 of `document_number` exactly as the extractor returns it | `blNumberHash` |
| `requiredDocsHash` | keccak256 of the required document names, sorted and joined with commas | `requiredDocsHash` |
| `docsHash` | keccak256 of the concatenated keccak256 of each file, sorted | `docsHash` |
| `intentHash`, `attestationHash` | EIP-712 `hashStruct` of the `FundIntent` and of the `ShipmentAttestation` | `structHash` |

`termsHash`, `inputsHash` and `policyHash` are not defined here yet.

## What the tests prove

```sh
npm test
```

* `src/hash.test.ts` compiles `contracts/test/KeelHashHarness.sol` with solc 0.8.26 and the optimizer settings of `contracts/foundry.toml`, runs it in a local EVM and compares it with `src/hash.ts`: struct hash of every Keel Trade type (with sample values and with the largest value of every field), domain separator and digest. It also signs an order with a wallet and recovers the signer against the digest computed in Solidity.
* `src/index.test.ts` checks that each Keel Trade `json/*.schema.json` is exactly the zod schema, that every string field is bounded by a pattern or an enum, and that fields outside the schema are rejected.

This holds for the hashing code in this repository, on the tested values. It does not cover a contract that hashes on its own instead of using `KeelHash.sol`.

After changing a Keel Trade extraction schema, regenerate the JSON files:

```sh
npm run gen:json -w @keel/schemas
```

## Tasks

| Task | Issue |
|---|---|
| T2.1 Freeze the interfaces of both modes, with tests that TS, JSON Schema and Solidity hash the same data identically | #9 |
