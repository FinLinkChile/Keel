# ingest (Area 3)

Authenticated email channel, deterministic PDF parser, quarantined LLM extractor and the comparison between both.

`src/index.ts` declares `parseInvoice`, `extractInvoice` and `invoiceKey`. Both readers return the `InvoiceExtraction` schema from `@keel/schemas`, which has no free text. Addresses found in a document never reach a payment: they go only to the beneficiary change flow.

```sh
npm run start -w ingest
npm run typecheck -w ingest
```

The invoice corpus lives in `redteam/corpus/` so Area 5 can measure against it.

## Tasks

| Task | Issue |
|---|---|
| T3.1 Authenticated inbound channel | #18 |
| T3.2 Flood protection | #19 |
| T3.3 Deterministic parser | #20 |
| T3.4 Quarantined LLM extractor | #21 |
| T3.5 Two source agreement | #22 |
| T3.6 Beneficiary change detection | #23 |
| T3.7 Idempotency key | #24 |
| T3.8 Invoice corpus | #25 |
