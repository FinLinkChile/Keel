# redteam (Area 5)

Executable red team battery, adversarial corpus and metrics.

* `src/index.ts`: the `Scenario` shape, the attack categories and the layers that can stop an attack.
* `scenarios/`: one file per scenario (40 minimum).
* `corpus/legit/`: at least 12 anonymized legitimate invoices.
* `corpus/adversarial/`: at least 25 adversarial variants, each with its expected result.

Metrics to report: attack block rate, false positives on legitimate invoices, share of invoices paid with no human intervention, decision latency, and the layer that stopped each attack.

## Tasks

| Task | Issue |
|---|---|
| T5.4 Red team battery | #37 |
| T5.5 On-chain evidence script | #38 |
| T3.8 Invoice corpus (Area 3) | #25 |
