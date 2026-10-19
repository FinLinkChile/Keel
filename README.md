# Keel

An agent wallet that pays only when verifiable conditions are met. The AI interprets once, the contract always obeys.

Keel has two modes on the same wallet:

* **Keel Trade**, the main mode and the demo: it pays international purchase orders through a programmable escrow, instead of the bank custody of a letter of credit.
* **Keel Personal**, the second mode: it pays a person's recurring bills (rent, electricity, internet) against authenticated invoices, to beneficiaries that are already registered.

Built for the 2026 Shenzhen FinTechathon, International Track, Topic F: Agent Wallet. The Keel Trade use case is Chilean companies importing goods from China, with Chile and Hong Kong as the target corridor.

## Contents

1. [Demo video](#demo-video)
2. [How Keel Trade works](#how-keel-trade-works)
3. [How Keel Personal works](#how-keel-personal-works)
4. [Architecture](#architecture)
5. [Repository layout](#repository-layout)
6. [Live test deployment](#live-test-deployment)
7. [Getting started](#getting-started)
8. [Run everything locally](#run-everything-locally)
9. [Deploy the contracts](#deploy-the-contracts)
10. [Deploy the backend on AWS](#deploy-the-backend-on-aws)
11. [Run the app against AWS](#run-the-app-against-aws)
12. [Walk through an order end to end](#walk-through-an-order-end-to-end)
13. [Security notes](#security-notes)
14. [Documentation](#documentation)

## Demo video

[keel-demo-video.mp4](keel-demo-video.mp4) (4:18, English, 1080p) walks through Keel Trade. Its live part is a real run of the app against the Keel API on AWS and the contracts on Base Sepolia, recorded on 19 Oct 2026 with an order of one test dollar: the AI reads the proforma, both companies sign, the agent deposits and pays the advance, the exporter uploads the bill of lading and the invoice, Harbor Line attests the shipment and the balance is paid.

The evidence of that run is in [evidence/demo-video/](evidence/demo-video/):

* [execution-evidence.md](evidence/demo-video/execution-evidence.md): the order, the API calls and the transaction hash of every step, plus the on-chain rejection shown in the video.
* [keel-demo-video.en.srt](evidence/demo-video/keel-demo-video.en.srt): English subtitles.
* [narration-script.txt](evidence/demo-video/narration-script.txt): the narration script.

## How Keel Trade works

1. Importer and exporter sign the purchase order as EIP-712 structured data. The payout address, amounts, deadlines, carrier and arbiter are fixed in what both sign.
2. The agent opens the order in the escrow and deposits the full amount from the importer's Safe. The funds are locked: the importer cannot withdraw them alone and the exporter has not received them yet.
3. Trigger 1: with the order signed by both parties and funded, the contract pays the advance to the exporter.
4. The exporter ships. The carrier signs a shipment attestation, and the exporter uploads the bill of lading and the invoice.
5. Trigger 2: the contract checks the carrier signature and the on-board date. The balance is released when the policy engine signs a Policy Decision Record (PDR) stating that the documents match the order, or when the importer approves it.
6. If no valid proof of shipment arrives before the deadline, the balance goes back to the importer.

Nothing in an email or a PDF can become a payment address: the payout address comes from the purchase order signed by both parties, and changing it requires a new signed order.

## How Keel Personal works

1. A bill arrives by email. The sender domain is authenticated against the domain registered for that beneficiary.
2. A deterministic parser and a quarantined LLM extractor read the invoice, and both must agree.
3. The policy engine decides the permission tier and signs a PDR. The recipient comes from the table of registered beneficiaries, never from the invoice.
4. `PDRGate` verifies the PDR and the Safe pays, inside the allowance of the agent role.
5. An invoice that mentions a new account never pays: it opens a beneficiary change request that waits in the Delay, where the cosigner can veto it.

## Architecture

Both modes share the wallet: a Safe with the Zodiac Roles and Delay modifiers. Powers are separated: the AI reads, the engine decides, people authorize and the contract executes.

| Layer | What it does | Where |
| --- | --- | --- |
| Contracts | `TradeEscrow` holds each order's funds and moves them only through its state machine. `FundingGate` is the only way the agent can fund an order, inside a role with a spending allowance. `PDRGate` does the same for Keel Personal. | `contracts/` |
| Policy engine and agent | Checks every order and document against what was signed, signs PDRs, and sends the transactions (`open`, `fund`, `submitShipment`, `approveBalance`). It never holds the owners' keys. | `engine/` |
| Ingest | Receives documents, reads them with a deterministic parser and a quarantined LLM extractor (no tools, a fixed output schema, no free text), and compares both readings. | `ingest/` |
| App | React Native (Expo) app for the importer and the exporter: propose and sign orders, upload documents, approve the balance, see balances and on-chain progress. | `app/` |
| Bot | Telegram bot that sends template notices. It signs nothing. | `bot/` |
| Backend on AWS | The same engine, ingest and orders API as serverless functions: API Gateway, Lambda, DynamoDB, S3, SQS, KMS and SSM. | `aws/`, `infra/terraform/` |

The backend runs in one of two ways: **locally** (ingest server, engine agent and bot as Node processes on your machine) or **on AWS** (Terraform). The app talks to either one, chosen by `app/.env`.

## Repository layout

| Folder | Contents | Area |
| --- | --- | --- |
| `contracts/` | Solidity and Foundry: `TradeEscrow`, `FundingGate`, `PDRGate`, deployment scripts, `deployments/<chainId>.json` | 1 |
| `schemas/` | Shared TypeScript types, EIP-712 structs and hashing (`@keel/schemas`) | 2 |
| `engine/` | Policy engine, PDRs, the agent and the monitor, the `keel` CLI | 2 |
| `aws/` | Lambda handlers, the orders API and the command-line tools of the carrier and the arbiter | 2, 5 |
| `infra/terraform/` | The AWS infrastructure | 2, 5 |
| `ingest/` | Document intake, parser, quarantined extractor, purchase analysis | 3 |
| `app/` | React Native (Expo) app | 4 |
| `bot/` | Telegram bot with template messages | 4 |
| `redteam/` | Attack scenarios, adversarial corpus, metrics, on-chain evidence scripts | 5 |
| `evidence/` | PDR records, on-chain evidence and the evidence of the demo video run | 5 |
| `docs/` | Project goal, flow, design, decisions and security analysis | 5 |

Each folder has its own README with the details of how to run it.

## Live test deployment

Keel Trade is deployed on **Base Sepolia** (chain id 84532), a public test network, with test USDC. The addresses are in [contracts/deployments/84532.json](contracts/deployments/84532.json):

| Contract | Address |
| --- | --- |
| Importer Safe | `0x366E72921895dBFD7688822418BE43E02551Ee82` |
| `TradeEscrow` | `0x8346c6F1AfbaFF8140D35116fAF5ec07e4232970` |
| `FundingGate` | `0x2bc56bbB5B47B493009531e751C8Bd90513e927f` |
| USDC (Base Sepolia) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

The carrier and the arbiter are represented by test keys registered in the gate. The permissioned network is the target for a pilot.

## Getting started

Requirements:

* Node.js 24 or newer.
* [Foundry](https://book.getfoundry.sh/getting-started/installation) for `contracts/`.
* For the AWS backend: Terraform 1.6 or newer and the AWS CLI with credentials for your account.

```sh
git clone --recurse-submodules https://github.com/FinLinkChile/Keel.git
cd Keel
npm install
cp .env.example .env      # fill in only what you need; never commit it
npm run typecheck
npm test
```

The TypeScript packages are npm workspaces and import each other from source (`@keel/schemas`, `@keel/engine`, `@keel/ingest`). There is no build step, except for the AWS bundles.

Contract tests:

```sh
cd contracts
forge build
forge test
```

On Windows PowerShell, if `npm` is blocked by the execution policy, use `npm.cmd` and `npx.cmd` instead.

## Run everything locally

Every value goes in the root `.env`; [.env.example](.env.example) documents each one.

1. **Ingest** (documents, proforma reading, purchase analysis). Needs an LLM key (`LLM_PROVIDER` and `LLM_API_KEY`, or `ANTHROPIC_API_KEY`) and `INGEST_WEBHOOK_TOKEN`. For Keel Trade, set `INGEST_CHAIN_ID`, `INGEST_ESCROW_ADDRESS` and `INGEST_AGENT_DIR`.

   ```sh
   npm run serve -w ingest          # http://127.0.0.1:8788
   ```

2. **Agent** of one importer Safe. It reads the signed orders from its data folder (ingest writes them there, `INGEST_AGENT_DIR`) and sends the transactions. Needs `KEEL_RPC_URL` (a Base Sepolia RPC), `RELAYER_PRIVATE_KEY` and `POLICY_SIGNER_PRIVATE_KEY`. The `keel` CLI does not read `.env` by itself, so load it with Node:

   ```sh
   node --env-file=.env --import tsx engine/src/cli.ts agent --data <agent-dir> --deployments contracts/deployments
   ```

3. **Monitor** (optional): watches the gate and pauses it on an anomaly when `MONITOR_PAUSER_PRIVATE_KEY` is set; otherwise it only alerts.

   ```sh
   node --env-file=.env --import tsx engine/src/cli.ts monitor --data <agent-dir> --deployments contracts/deployments
   ```

4. **Bot** (optional). With `BOT_SENDER=console` it prints the notices instead of sending them.

   ```sh
   npm run start -w bot
   ```

5. **App**. Copy [app/.env.example](app/.env.example) to `app/.env`. On a phone, `EXPO_PUBLIC_INGEST_URL` must be your computer's LAN address, never `localhost`. Leave `EXPO_PUBLIC_API_URL` empty.

   ```sh
   cd app
   npx expo start -c        # press w for the web version, or scan the QR code with Expo Go
   ```

Verify a payment and every PDR it carries, from the chain:

```sh
npm run keel -- verify <txHash> --rpc <rpc-url> --deployments contracts/deployments
```

It exits 0 when everything matches and is anchored to the deployed contracts.

## Deploy the contracts

The Base Sepolia deployment above already exists; deploy again only for a new Safe or network. Set `BASE_SEPOLIA_RPC_URL` (Foundry's `base_sepolia` endpoint) and the deployment variables of `.env` (`DEPLOYER_PRIVATE_KEY`, `OWNER_ADDRESS`, `POLICY_SIGNER_ADDRESS`, `COSIGNER_ADDRESS`, `RELAYER_ADDRESS`, `GUARDIAN_ADDRESS`, `REFUND_GRACE`, `CONFIG_DELAY`, `AGENT_CAP`, `COSIGNED_CAP`, `ALLOWANCE_PERIOD`; all addresses must differ). Then, from `contracts/`:

```sh
forge script script/DeployTrade.s.sol --rpc-url base_sepolia                       # 1. simulate, sends nothing
forge script script/DeployTrade.s.sol --rpc-url base_sepolia --broadcast --slow    # 2. send
forge script script/DeployTrade.s.sol --rpc-url base_sepolia \
  --sig "record(address,uint256)" <safe> <deployBlock>                             # 3. check on chain, write deployments/84532.json
```

Then set the trade policy hash through the Delay with `script/SetTradePolicy.s.sol`, register the supplier, carrier and arbiter in `FundingGate`, and fund the Safe with test USDC and the relayer with test ETH. [contracts/README.md](contracts/README.md) explains each script.

## Deploy the backend on AWS

The full procedure is in [infra/terraform/README.md](infra/terraform/README.md) (in Spanish). In short:

1. **Choose a region** your account allows. Set it in `infra/terraform/terraform.tfvars` (not in git), with any other variables you need:

   ```hcl
   region             = "us-east-2"
   alert_email        = "you@example.com"   # alarms and budget by email
   app_origin         = "https://keel-app-finlink.vercel.app"   # the app's origin: CORS and the bot's links
   extra_app_origins  = ["http://localhost:8081"]      # more origins allowed by CORS, such as the local app
   anthropic_base_url = ""                  # https URL of an Anthropic proxy, or empty for the Anthropic API
   log_block_range    = 200                 # blocks per eth_getLogs; 10 on Alchemy's free tier
   key_source_pauser  = "ssm"               # "" runs the monitor in alert-only mode
   demo_auto_attest   = false               # demo shortcut, see Security notes
   ```

   The contract addresses default to the Base Sepolia deployment (`variables.tf`).

2. **Build the functions and apply:**

   ```sh
   npm run build -w aws
   cd infra/terraform
   terraform init
   terraform apply
   ```

   The outputs include `api_endpoint` and `secrets_to_load`.

3. **Load the secrets by hand** as SSM SecureStrings. Terraform never holds them, so their values never reach its state. Write each value to a file outside the repository, load it, and delete the file:

   ```sh
   aws ssm put-parameter --region <region> --type SecureString \
     --name /keel-secrets/84532/<name> --value file://value.txt
   ```

   | Secret | Value |
   | --- | --- |
   | `rpc_url` | Full RPC URL of Base Sepolia (`https://sepolia.base.org` works with `log_block_range = 200`) |
   | `relayer_private_key`, `policy_signer_private_key`, `pauser_private_key` | The keys whose addresses are registered on chain |
   | `llm_keys` | JSON such as `{"anthropic": "<key>"}`; with a proxy, the proxy's token |
   | `telegram_bot_token` | The bot token |
   | `bot_inbound_token`, `bot_admin_token`, `directory_admin_token`, `ingest_webhook_token`, `ingest_admin_token` | Different random strings of at least 32 characters |
   | `carrier_private_key` | Only with `demo_auto_attest = true`: the carrier's test key |

   A function whose secret is missing logs its exact name (`secret X is not loaded`).

4. **Register who may act**, with `directory_admin_token` as a bearer token:
   * `POST /importers` with the Safe and its representatives: the owners' addresses and each phone wallet that signs for the importer.
   * `POST /suppliers` with the exporter and its payout address.

   ```sh
   curl -X POST "$API/suppliers" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"exporter":"0x…","payoutAddress":"0x…","name":"Supplier"}'
   ```

After a code change, run `npm run build -w aws` and `terraform apply` again.

## Run the app against AWS

Set `app/.env` with the API and the Base Sepolia deployment:

```sh
EXPO_PUBLIC_INGEST_URL=
EXPO_PUBLIC_API_URL=https://<api-id>.execute-api.<region>.amazonaws.com
EXPO_PUBLIC_CHAIN_ID=84532
EXPO_PUBLIC_ESCROW_ADDRESS=0x8346c6F1AfbaFF8140D35116fAF5ec07e4232970
EXPO_PUBLIC_IMPORTER_SAFE=0x366E72921895dBFD7688822418BE43E02551Ee82
EXPO_PUBLIC_WALLET_CHECK=1      # test builds only: lets you import test keys
```

Start it from `app/` (not from the repository root) with `npx expo start -c`. With `EXPO_PUBLIC_WALLET_CHECK=1`, **Connect → Wallet check** imports a test key into the role you are connected as. The importer key must belong to an owner of the Safe, and the exporter key to the registered supplier.

## Walk through an order end to end

For the same walk-through screen by screen, with screenshots, see the [user manual](docs/entrega/user-manual.md).

To try the app without building it, install the test APK (`keel.apk`) from https://github.com/FinLinkChile/Keel/releases/latest , under **Assets**.

1. **Importer:** create an order with the registered supplier and sign it.
2. **Exporter:** open the order and sign it. The agent opens it in the escrow and funds it on its next pass (every minute on AWS). The advance reaches the exporter's payout address.
3. **Exporter:** upload the bill of lading and the commercial invoice. Ingest reads them.
4. **Carrier:** sign the shipment attestation and send it:

   ```sh
   CARRIER_PRIVATE_KEY=0x… npx tsx aws/scripts/carrier-attest.ts --api <api-url> \
     --order <orderId> --bl-number <BL number> --on-board <ISO date> --port <UN/LOCODE> \
     --file bl.pdf --file invoice.pdf --dry-run
   ```

   Remove `--dry-run` to send it. The agent submits it and the order becomes SHIPPED.
5. **Importer:** approve the balance. The agent sends it and the escrow pays the balance to the exporter. The order shows as complete in the app.

Each step leaves a transaction hash on Base Sepolia. `aws/scripts/arbiter-resolve.ts` is the arbiter's tool for a dispute.

## Security notes

* **Keys never enter the repository.** `.env`, `app/.env` and `*.tfvars` are ignored by git. The owners' keys never live on a server: owners sign from their own wallet.
* **The relayer, policy signer, cosigner and pauser keys must be different**, and the engine refuses to load them otherwise. In the demo they come from SSM; for production, `key_source_* = "kms"` moves them to KMS once their addresses are registered in the contracts.
* **The quarantined extractor has no tools and no free-text output.** Documents sent to a proxy (`anthropic_base_url`) are seen by that proxy's operator too.
* **`demo_auto_attest` is a demo shortcut that breaks the separation of powers.** With it on, AWS signs the carrier's attestation as soon as the exporter uploads a bill of lading, so a fabricated bill of lading proves a shipment. It is off by default; use it only in a test deployment with test keys. The threat is recorded in [docs/flujo/amenazas.md](docs/flujo/amenazas.md).

## Documentation

[docs/flujo/](docs/flujo/index.md) defines the goal of the project and the Keel Trade flow; it is the reference before designing any component, starting at [docs/flujo/checklist-componente.md](docs/flujo/checklist-componente.md). Keel Personal is designed in [docs/personal/keel-personal.md](docs/personal/keel-personal.md). The documentation is split into short files, one concept each, listed in [docs/index.md](docs/index.md). Internal working documents are in Spanish.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the working rules and the [project board](https://github.com/orgs/FinLinkChile/projects/2) for the tasks.
