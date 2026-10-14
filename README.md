# Keel

An agent wallet that pays only when verifiable conditions are met. The AI interprets once, the contract always obeys.

Keel has two modes on the same wallet:

* **Keel Trade**, the main mode and the demo: it pays international purchase orders through a programmable escrow, instead of the bank custody of a letter of credit.
* **Keel Personal**, the second mode: it pays a person's recurring bills (rent, electricity, internet) against authenticated invoices, to beneficiaries that are already registered.

Built for the 2026 Shenzhen FinTechathon, International Track, Topic F: Agent Wallet.

Keel Trade use case: Chilean companies importing goods from China, with Chile and Hong Kong as the target corridor, on a permissioned network.

## How Keel Trade works

1. Importer and exporter sign the purchase order as EIP-712 structured data. The payout address, amounts, deadlines, carrier and arbiter are fixed in what both sign.
2. The importer deposits the full amount in the escrow contract. The funds are locked: the importer cannot withdraw them unilaterally and the exporter has not received them yet.
3. Trigger 1: with the order signed by both parties and the funds deposited, the contract releases the advance to the exporter.
4. The exporter ships. The carrier signs a shipment attestation, and the exporter uploads the bill of lading and the invoice.
5. Trigger 2: the contract checks the carrier signature and the on board date, and the policy engine issues a signed Policy Decision Record (PDR) stating that the documents match the order. The contract releases the balance.
6. If no valid proof of shipment arrives before the deadline, the balance goes back to the importer.

Nothing in an email or a PDF can become a payment address: the payout address comes from the purchase order signed by both parties, and changing it requires a new signed order.

## How Keel Personal works

1. A bill arrives by email. The sender domain is authenticated against the domain registered for that beneficiary.
2. A deterministic parser and a quarantined LLM extractor read the invoice, and both must agree.
3. The policy engine decides the permission tier and signs a Policy Decision Record (PDR). The recipient comes from the table of registered beneficiaries, never from the invoice.
4. `PDRGate` verifies the PDR and the Safe pays, inside the allowance of the agent role.
5. An invoice that mentions a new account never pays: it opens a beneficiary change request that waits in the Delay, where the cosigner can veto it.

## The wallet

Both modes share the wallet: a Safe with the Zodiac Roles and Delay modifiers. The agent (a quarantined LLM extractor, a deterministic policy engine and a relayer) can only act through `PDRGate`, inside a role with a spending allowance. In Keel Trade that role is limited to the escrow contract; in Keel Personal, to transfers to the whitelisted beneficiaries.

[docs/flujo/](docs/flujo/index.md) defines the goal of the project and the Keel Trade flow in detail. It is the reference to check before designing or creating any component, starting at [docs/flujo/checklist-componente.md](docs/flujo/checklist-componente.md). Keel Personal is designed in [docs/personal/keel-personal.md](docs/personal/keel-personal.md). The documentation is split into short files, one concept each: [docs/index.md](docs/index.md) lists them.

## Repository layout

| Folder | Contents | Area |
|---|---|---|
| `contracts/` | Solidity, Foundry, deployment scripts: escrow, `PDRGate`, Safe configuration | 1 |
| `schemas/` | JSON Schema, TypeScript types, EIP-712 structs | 2 |
| `engine/` | Policy engine, PDR, signatures, verifier | 2 |
| `ingest/` | Intake of bills and trade documents, parser, quarantined extractor | 3 |
| `app/` | React Native (Expo) app: personal and company accounts, importer and exporter profiles, signing, readable diff, cosigner view | 4 |
| `bot/` | Telegram bot with template messages | 4 |
| `redteam/` | Scenarios, adversarial corpus, metrics | 5 |
| `docs/` | Project goal, technical document, security report, evidence, deck | 5 |
| `evidence/` | PDR records and on-chain evidence | 5 |

Each folder has a README with its tasks and how to run it.

The focus moved from utility bill payments to trade escrow on October 13, 2026, and Keel Personal came back into scope the same day as the second mode. The code scaffolding carries the Keel Personal interfaces; the Keel Trade ones are added as each area builds them. How deep Keel Personal goes in the submission is still to be confirmed by the team (open decision 14 in `docs/decisiones/abiertas.md`).

## Getting started

Requirements: Node.js 22 or newer, and [Foundry](https://book.getfoundry.sh/getting-started/installation) for `contracts/`.

```sh
npm install
cp .env.example .env   # fill in only the keys your area needs
npm run typecheck
npm test
```

The TypeScript packages are npm workspaces and import the shared interfaces as `@keel/schemas`. There is no build step: packages are consumed from source.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the working rules, and the [project board](https://github.com/orgs/FinLinkChile/projects/2) for the tasks.
