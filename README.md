# Keel

A utility bill payer that resists fraudulent invoices. The AI interprets once, the contract always obeys.

Built for the 2026 Shenzhen FinTechathon, International Track, Topic F: Agent Wallet.

## How it works

1. An invoice arrives by email and is authenticated (SPF, DKIM, DMARC).
2. A quarantined LLM extractor and a deterministic parser read it into a schema with no free text. Both must agree.
3. A deterministic policy engine evaluates the extraction and issues a signed Policy Decision Record (PDR).
4. `PDRGate` verifies the PDR on chain and executes the USDC transfer through a Safe with the Zodiac Roles Modifier.

Nothing in an email or a PDF can become a payment address: recipients come from an alias table registered during onboarding, and changes go through a delay with a veto window.

## Repository layout

| Folder | Contents | Area |
|---|---|---|
| `contracts/` | Solidity, Foundry, deployment scripts | 1 |
| `schemas/` | JSON Schema, TypeScript types, EIP-712 structs | 2 |
| `engine/` | Policy engine, PDR, signatures, verifier | 2 |
| `ingest/` | Email, PDF, extractor, idempotency | 3 |
| `app/` | React Native (Expo) app: onboarding, readable diff, cosigner view | 4 |
| `bot/` | Telegram bot with template messages | 4 |
| `redteam/` | Scenarios, adversarial corpus, metrics | 5 |
| `docs/` | Technical document, security report, evidence, deck | 5 |
| `evidence/` | PDR records and on-chain evidence | 5 |

Each folder has a README with its tasks and how to run it.

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
