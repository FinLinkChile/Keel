# engine (Area 2)

Deterministic policy engine, PDR issuance, EIP-712 signature, deadline watcher, monitor and verifier.

In Keel Personal the engine decides whether a bill is paid: `evaluate(extraction, context)` checks the alias, the issuer, the amount against the history, the allowance, the exchange rate, idempotency, account change mentions and hidden text. The result is a `PolicyDecision` that `PDRGate` verifies.

In Keel Trade it decides at two moments of the flow in [docs/flujo_clave.md](../docs/flujo_clave.md):

* Funding: the order is signed by both parties, the supplier is known and the amount fits the allowance. The result is a `PolicyDecision` that `PDRGate` verifies.
* Trigger 2: the bill of lading and the invoice match the order and the shipment attestation signed by the carrier. The result is a `DocumentDecision` that `TradeEscrow` verifies.

Every evaluation must stay a pure function: no network, no LLM, and the time comes in as a parameter.

`src/index.ts` currently declares `evaluate(extraction, context)` for Keel Personal. `evaluateFunding` and `evaluateDocuments` are added next to it once the Keel Trade interfaces are frozen.

```sh
npm test
npm run typecheck -w engine
```

## Tasks

Tasks are described in [docs/keel_division_trabajo.md](../docs/keel_division_trabajo.md). A task that exists in both modes keeps one number: its base text is Keel Personal and Keel Trade adds to it.

| Task | Issue |
|---|---|
| T2.2 Deterministic engine (bill rules; funding and document rules) | #10 |
| T2.3 Exchange rate (Keel Personal only) | #11 |
| T2.4 PDR issuance and signature | #12 |
| T2.5 Pre-flight simulation with `eth_call` | #13 |
| T2.6 Payment and order states, fail closed notices | #14 |
| T2.7 Key custody and rotation | #15 |
| T2.8 Out of system usage monitor | #16 |
| T2.9 Reproducible verifier (`keel verify <txHash>`) | #17 |
| T2.10 Deadline watcher (refund after deadline, shipment submission; added by Trade) | to be created |
