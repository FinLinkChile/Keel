# engine (Area 2)

Deterministic policy engine, PDR issuance, EIP-712 signature, exchange rate, monitor and verifier.

`src/index.ts` declares `evaluate(extraction, context)`. It must stay a pure function: no network, no LLM, and the time comes in as a parameter.

```sh
npm test
npm run typecheck -w engine
```

## Tasks

| Task | Issue |
|---|---|
| T2.2 Deterministic engine | #10 |
| T2.3 Exchange rate | #11 |
| T2.4 PDR issuance and signature | #12 |
| T2.5 Pre-flight simulation with `eth_call` | #13 |
| T2.6 Payment states and fail closed notices | #14 |
| T2.7 Key custody and rotation | #15 |
| T2.8 Out of system usage monitor | #16 |
| T2.9 Reproducible verifier (`keel verify <txHash>`) | #17 |
