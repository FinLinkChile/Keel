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
| 3 | Invoice ingestion and quarantined extraction | `ingest/` | @dvni7 |
| 4 | Product, onboarding and human channel | `app/`, `bot/` | @2Chrisss |
| 5 | Red team, evidence, documentation and coordination | `redteam/`, `docs/`, `evidence/` | @Benjasncz2 |

## Integration points (Chile time)

1. Monday Oct 12, 20:00: shared interfaces frozen. After this, a change to `schemas/` must be announced to all five areas.
2. Wednesday Oct 14: addresses and ABIs published in `contracts/deployments/84532.json`.
3. Friday Oct 16: one real end to end payment on testnet, visible in the activity log.
4. Sunday Oct 18, 20:00: feature freeze and final deployment. After this, only documents change.
5. Monday Oct 19, 22:00: submission.

## Rules that apply everywhere

* The project is called Keel in code, documents and deck.
* There is no operational LLM. The only LLM is the quarantined extractor, and its output schema has no free text.
* Keys never enter the repository. Use `.env` (see `.env.example`). The owner key never lives on a server.
* Runtime simulation is `eth_call`. Anvil is only for fork tests.
* Failing closed always notifies: every held payment reports the reason, the due date and the manual alternative.
* No overclaims. Every security statement says who it holds for, where it is enforced and which test proves it.
* Everything delivered to the jury is in English.
