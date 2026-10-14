# Working rules

## Branches and pull requests

* Each area works in its own folder and its own branches: `area1/pdr-gate`, `area3/parser`, and so on.
* Open a pull request to `main` and reference the task issue in the description (`Closes #6`).
* `.github/CODEOWNERS` requests the review of the owning area automatically.
* Changes to `schemas/` are approved by Area 2. Changes to contracts that are already deployed are approved by Area 1.
* `main` must stay green: `npm run typecheck`, `npm test` and `forge build` run in CI.

## Areas

| Area | Scope | Folders | Owner |
|---|---|---|---|
| 1 | Contracts and on-chain permissions | `contracts/` | @Mrnooqmal |
| 2 | Policy engine, PDR, exchange rate and keys | `schemas/`, `engine/` | @darlopezp |
| 3 | Trade document ingestion and quarantined extraction | `ingest/` | @dvni7 |
| 4 | Product, onboarding and human channel | `app/`, `bot/` | @2Chrisss |
| 5 | Red team, evidence, documentation and coordination | `redteam/`, `docs/`, `evidence/` | @Benjasncz2 |

## Integration points (Chile time)

The project changed direction on October 13 (from utility bill payments to trade escrow), so the first three points were replanned. They are a proposal until Area 5 confirms them.

1. Wednesday Oct 14, 20:00: shared interfaces of the escrow flow frozen (purchase order, shipment attestation, document extraction, PDR). The network and the payment token are decided the same day. After this, a change to `schemas/` must be announced to all five areas.
2. Thursday Oct 15: addresses and ABIs published in `contracts/deployments/<chainId>.json`.
3. Friday Oct 16: one real end to end order on the test network (signature, deposit, advance, shipment, balance), visible in the activity log.
4. Sunday Oct 18, 20:00: feature freeze and final deployment. After this, only documents change.
5. Monday Oct 19, 22:00: submission.

## Rules that apply everywhere

* [docs/flujo_clave.md](docs/flujo_clave.md) defines the goal of the project and the flow it implements. Check it before designing or creating any component. If an idea contradicts it, raise it with the team and update that document first.
* The payout address never comes from a document. It comes from the purchase order signed by both parties.
* The project is called Keel in code, documents and deck.
* There is no operational LLM. The only LLM is the quarantined extractor, and its output schema has no free text.
* Keys never enter the repository. Use `.env` (see `.env.example`). The owner key never lives on a server.
* Runtime simulation is `eth_call`. Anvil is only for fork tests.
* Failing closed always notifies: every held payment reports the reason, the due date and the manual alternative.
* No overclaims. Every security statement says who it holds for, where it is enforced and which test proves it.
* Everything delivered to the jury is in English.
