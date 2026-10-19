# redteam (Area 5)

Executable red team battery, adversarial corpus and metrics.

* `src/index.ts`: the `Scenario` shape, the attack categories and the layers that can stop an attack. The categories in the code are the Keel Personal ones; the Keel Trade ones are added with T5.4.
* `scenarios/`: one file per scenario (40 minimum).
* `corpus/legit/`: at least 12 anonymized legitimate bills (Keel Personal) and at least 12 legitimate document sets (bill of lading or air waybill plus invoice, each consistent with a test order) for Keel Trade.
* `corpus/adversarial/`: at least 25 adversarial variants per mode, each with its expected result.

Keel Personal attack categories: invoice (changed account, hidden text, homoglyphs, altered amount, repeated invoice number), email (forged sender, flooding, forwarded message with a swapped attachment), interface, exchange rate, keys, contract and onboarding.

Keel Trade attack categories: payout address (account change by email, invoice with another account), documents (forged bill of lading, pasted scanned signature, altered on board date or amount, hidden text, homoglyphs), shipment (attestation signed by another key, same bill of lading on two orders, late shipment), interface, keys, escrow (importer withdrawal, double advance, early refund, calls on final states, arbiter trying to collect) and supplier onboarding.

Metrics to report: attack block rate, false positives on legitimate documents, share of bills paid with no human intervention (Keel Personal) and of orders completed with no human intervention beyond the signatures (Keel Trade), decision latency, and the layer that stopped each attack (channel, extractor, engine, gate, Roles, escrow or human).

## Tasks

Tasks are described in [docs/trabajo/area-5-redteam-evidencia.md](../docs/trabajo/area-5-redteam-evidencia.md) (tasks T5.x).

| Task | Issue |
|---|---|
| T5.4 Red team battery | #37 |
| T5.5 On-chain evidence script | #38 |
| T3.8 Document corpus (Area 3) | #25 |
