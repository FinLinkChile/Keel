# schemas (Area 2)

The shared interfaces of Keel. Every other package imports them as `@keel/schemas`.

* `src/index.ts`: zod schema of the invoice extraction, `PaymentIntent`, `PolicyDecision`, EIP-712 types and domain, event and error names, payment states.
* `json/invoice-extraction.schema.json`: the same extraction schema as JSON Schema, for the LLM structured output.
* The Solidity structs live in `contracts/src/KeelTypes.sol`.

These definitions are a draft until the freeze on Monday Oct 12 at 20:00 (Chile time). After the freeze, a change requires notifying all five areas.

```sh
npm test
```

## Tasks

| Task | Issue |
|---|---|
| T2.1 Freeze interfaces, with tests that TS, JSON Schema and Solidity hash the same data identically | #9 |
