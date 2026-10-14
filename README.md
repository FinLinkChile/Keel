# Keel

An agent wallet for cross-border trade. It pays international purchase orders only when verifiable conditions are met, using a programmable escrow instead of the bank custody of a letter of credit. The AI interprets once, the contract always obeys.

Built for the 2026 Shenzhen FinTechathon, International Track, Topic F: Agent Wallet.

Use case: Chilean companies importing goods from China, with Chile and Hong Kong as the target corridor, on a permissioned network.

## How it works

1. Importer and exporter sign the purchase order as EIP-712 structured data. The payout address, amounts, deadlines, carrier and arbiter are fixed in what both sign.
2. The importer deposits the full amount in the escrow contract. The funds are locked: the importer cannot withdraw them unilaterally and the exporter has not received them yet.
3. Trigger 1: with the order signed by both parties and the funds deposited, the contract releases the advance to the exporter.
4. The exporter ships. The carrier signs a shipment attestation, and the exporter uploads the bill of lading and the invoice.
5. Trigger 2: the contract checks the carrier signature and the on board date, and the policy engine issues a signed Policy Decision Record (PDR) stating that the documents match the order. The contract releases the balance.
6. If no valid proof of shipment arrives before the deadline, the balance goes back to the importer.

Nothing in an email or a PDF can become a payment address: the payout address comes from the purchase order signed by both parties, and changing it requires a new signed order.

The wallet side is a Safe with the Zodiac Roles and Delay modifiers. The agent (a quarantined LLM extractor, a deterministic policy engine and a relayer) can only act through `PDRGate`, inside a role limited to the escrow contract and a spending allowance.

[docs/flujo_clave.md](docs/flujo_clave.md) defines the goal of the project and the flow in detail. It is the reference to check before designing or creating any component.

## Repository layout

| Folder | Contents | Area |
|---|---|---|
| `contracts/` | Solidity, Foundry, deployment scripts: escrow, `PDRGate`, Safe configuration | 1 |
| `schemas/` | JSON Schema, TypeScript types, EIP-712 structs | 2 |
| `engine/` | Policy engine, PDR, signatures, verifier | 2 |
| `ingest/` | Trade document intake, parser, quarantined extractor | 3 |
| `app/` | React Native (Expo) app: importer and exporter profiles, order signing, readable diff, cosigner view | 4 |
| `bot/` | Telegram bot with template messages | 4 |
| `redteam/` | Scenarios, adversarial corpus, metrics | 5 |
| `docs/` | Project goal, technical document, security report, evidence, deck | 5 |
| `evidence/` | PDR records and on-chain evidence | 5 |

Each folder has a README with its tasks and how to run it.

The project changed direction on October 13, 2026: it was a utility bill payer before. The code scaffolding and the folder READMEs still carry the interfaces of that scope until each area migrates them.

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
