# schemas (Area 2)

The shared interfaces of Keel. Every other package imports them as `@keel/schemas`.

## Current state

The files here hold the Keel Personal interfaces, frozen on Monday Oct 12:

* `src/index.ts`: zod schema of the invoice extraction, `PaymentIntent`, `PolicyDecision`, EIP-712 types and domain, event and error names, payment states.
* `json/invoice-extraction.schema.json`: the same extraction schema as JSON Schema, for the LLM structured output.
* The Solidity structs live in `contracts/src/KeelTypes.sol`.

`InvoiceExtraction` and `PaymentIntent` stay for Keel Personal. Do not build Keel Trade components on them.

## Interfaces added by Keel Trade

Proposed in [docs/interfaces/](../docs/interfaces/index.md), to be frozen on Wednesday Oct 14 at 20:00 (Chile time):

* Document extraction, with no free text: transport document (bill of lading or air waybill) and commercial invoice.
* `PurchaseOrder` and `ShipmentAttestation`, signed with EIP-712.
* `FundIntent`, `PolicyDecision` (shared by both modes) and `DocumentDecision`.
* Event and error names of `PDRGate` and `TradeEscrow`.

After the freeze, a change requires notifying all five areas.

```sh
npm test
```

## Tasks

| Task | Issue |
|---|---|
| T2.1 Freeze the interfaces of both modes, with tests that TS, JSON Schema and Solidity hash the same data identically | #9 |
