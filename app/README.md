# app (Area 4)

The Keel app, with two account types:

* Personal (Keel Personal): onboarding, beneficiary book, readable diff of beneficiary changes, activity log and tier panel.
* Company (Keel Trade): importer and exporter profiles, purchase order creation and signing, readable diff of the order, escrow status and dispute.

The cosigner view is shared by both.

React Native with Expo and TypeScript. It runs on Android, iOS and the web from the same code. Routes live in `src/app/` (Expo Router), components in `src/ui/` and data in `src/data/`; `/dev/components` shows the base components. Each party signs from their own wallet: no owner key on any server. Today that wallet is a test wallet created on the phone, whose key is generated on the device and kept in `expo-secure-store` (on the web build, for development only, in `localStorage`); WalletConnect and the browser wallet come later.

The Keel Trade flow is in [docs/flujo/flujo-clave.md](../docs/flujo/flujo-clave.md), and the Keel Personal one in [docs/personal/keel-personal.md](../docs/personal/keel-personal.md). The payout address shown to the user never comes from a document: it comes from the signed order and the party registry, or from the table of registered beneficiaries.

```sh
npm install            # from the repository root
npm run start -w app   # Expo dev server, scan the QR with Expo Go
npm run web -w app     # run in the browser
npm run typecheck -w app
```

`npx expo lint` does not run yet: the repository root uses TypeScript 7, which has no JavaScript API, and the hoisted `ts-api-utils` used by `eslint-config-expo` loads it and crashes. `app/eslint.config.js` stays ready for when the lint toolchain supports TypeScript 7 or the app gets its own TypeScript 6 for linting. Until then the checks are `npm run typecheck -w app` and the vitest tests (`npm test` from the root).

Add Expo packages with `npx expo install <package>` from this folder, so the versions match the SDK. `AGENTS.md` has the Expo conventions for AI coding agents.

The shared interfaces are imported from `@keel/schemas`. Metro resolves the workspace package from source, so there is nothing to build first.

## Demo data for the other services

The app's mock (`src/data/mock.ts`) is the single source of the demo orders. `npm run demo-data` turns it into the files ingest and the agent read, so nobody edits those JSON files by hand. It takes the public addresses of the test wallets (shown in Wallet check) and never reads or writes a key.

```sh
npm run demo-data -w app -- --exporter 0x… [--importer 0x…] [--out <dir>]
```

| File | For | Content |
|---|---|---|
| `<out>/ingest-orders.json` | ingest, as `INGEST_ORDERS_FILE` | The open orders a test wallet can upload to: `orderId`, `payoutAddress` and `carrier` from the order, the wallets as `uploaders`, and the exporter's registered bank account as `knownDestinations`, so its own invoice raises no unknown account alert |
| `<out>/agent/orders/<orderId>/order.json` | the agent (Area 2) | `{ order, terms, label }`: the `PurchaseOrder` with its real `termsHash` and `requiredDocsHash`, the `OrderTerms` and the label of the bot notices |
| `<out>/agent/registry.json` | the agent | `parties` (address, bot account, the importer's RUT) and `history` (settled amounts by exporter) |
| `<out>/bot-orders.json` | the bot, as `BOT_ORDERS_FILE` | The label and the bot accounts of each order, by order id |

Every order id is computed the way `TradeEscrow.open` checks it, `keccak256(abi.encode(importer, exporter, nonce))`, with the addresses of the wallets given to the script: the same order has another id with other wallets, while its label (PO-0142, the nonce in hex) stays. The generated files all use the same ids. `npm run bot-examples -w app` rewrites the ids of `bot/examples` with the mock's default addresses. The default `--out` is `app/demo-data/`, ignored by git. `scripts/demoData.test.ts` checks the files against the shapes ingest (`TradeOrderEntry`), the agent (`engine/src/agent/store.ts`) and the bot read, and the orders against the checks of `TradeEscrow.open` that can be made off chain.

## Uploading a document from a phone to ingest

This is the end to end test of the signed upload (step 4 of the flow): the exporter picks a PDF on the phone, the app signs a `DocumentUpload` over the exact bytes with the test wallet and sends them to ingest, and the screen shows only the outcome. You need a computer that runs ingest and the Expo dev server, and a phone with Expo Go on the same Wi-Fi network.

1. **Get the code.** Check out the `area4/app-upload` branch and run `npm install` at the repository root.

2. **Run ingest** from `area3/trade-ingest` (or `dev`, once PR #47 is merged) with your LLM settings in the root `.env` (`LLM_PROVIDER`, `LLM_MODEL`, the provider key) and `INGEST_WEBHOOK_TOKEN` (32 characters or more). Add for this test:

   ```sh
   INGEST_CHAIN_ID=31337                 # any positive integer, the app must use the same one
   INGEST_HOST=0.0.0.0                   # the default 127.0.0.1 cannot be reached from the phone
   INGEST_PORT=8788
   INGEST_ORDERS_FILE=<path>/app/demo-data/ingest-orders.json   # generated in step 6
   ```

   Then `npm run serve -w ingest`. Ingest refuses to start without `INGEST_ORDERS_FILE`'s file, so generate it first (step 6) or come back to this step.

3. **Configure the app.** Copy `app/.env.example` to `app/.env` and set:

   ```sh
   EXPO_PUBLIC_INGEST_URL=http://192.168.1.20:8788   # the LAN IP of the computer running ingest, never localhost
   EXPO_PUBLIC_CHAIN_ID=31337                        # the same value as INGEST_CHAIN_ID
   ```

   The phone is another device, so `localhost` would point at the phone itself. On Windows `ipconfig` shows the IP; on macOS, `ipconfig getifaddr en0`.

4. **Open the app.** Run `npm run start -w app -- --clear` (`--clear` makes Expo read the new `.env`) and scan the QR with Expo Go. On Connect, choose **I export** and tap **Set up test wallet**.

5. **Copy the wallet address.** Tap **Wallet check** under the wallet (development builds only). The connected wallet is shown in full; select it and send it to the computer (a chat or an email to yourself).

6. **Generate the ingest registry** with that address, then (re)start ingest so it reads it:

   ```sh
   npm run demo-data -w app -- --exporter 0xTHE_ADDRESS
   ```

7. **Upload.** On Home, tap **Upload** on PO-0142. On the order, tap **Upload** next to **Bill of lading** and choose `redteam/corpus/demo/PO-0142-bill-of-lading.pdf`, then **Upload** next to **Commercial invoice** with `PO-0142-commercial-invoice.pdf` from the same folder (added by Area 3 in #69). They carry the values of PO-0142 and the exporter's registered account, so the invoice raises no account alert and the agent finds them consistent with the order. Both rows start empty and show only what this phone uploaded. To get the PDF onto the phone, email it to yourself or put it in Drive, and pick it from the file picker. The row should end in **Accepted**.

What each outcome means:

| On screen | Ingest answered | Meaning |
|---|---|---|
| Accepted | 200 `ready` | The document was read and recorded for the order |
| Under review | 200 `held` or `quarantined` | Recorded, but a person has to look at it (the two readings disagree, the extractor failed, the type does not match) |
| Already uploaded | 200 `duplicate` | The same file was uploaded before |
| This wallet can't upload to this order | 403 `not_a_party` | The address in the registry is not this wallet's: it was copied wrong, ingest was not restarted after step 6, or the app and ingest use different chain ids |
| Check the phone's date and time | 401 `stale_signature` or `bad_signature` | The phone's clock is more than 10 minutes off: turn on automatic date and time |
| Couldn't reach Keel | no answer | Wrong IP in `EXPO_PUBLIC_INGEST_URL`, ingest still on `127.0.0.1`, phone on another network, or the computer's firewall blocks port 8788 for Node |
| Keel does not know this order yet | 404 `unknown_order` | The registry does not contain PO-0142: generate it again with `--exporter` |
| Uploads are not set up in this app | not sent | `EXPO_PUBLIC_INGEST_URL` or `EXPO_PUBLIC_CHAIN_ID` is missing; restart with `--clear` after editing `app/.env` |

Nothing on this screen pays or changes the order: the upload only gives ingest the documents that the engine later compares with the signed order and the carrier's attestation. The screen never shows what ingest read in the file.

## Tasks

Tasks are described in [docs/trabajo/area-4-producto.md](../docs/trabajo/area-4-producto.md) (tasks T4.x). A task that exists in both modes keeps one number: its base text is Keel Personal and Keel Trade adds to it.

| Task | Issue |
|---|---|
| T4.1 Onboarding with out of band verification (beneficiary, supplier) | #26 |
| T4.2 Readable diff before signing (beneficiary change, order) | #27 |
| T4.4 Signature with no key on the server | #29 |
| T4.5 Cosigner view | #30 |
| T4.7 Activity log and tier panel | #32 |
| T4.8 English copy and demo design | #33 |
| T4.9 Account type, importer and exporter profiles, order flow (added by Trade) | to be created |
| T4.10 Dispute and cancellation (added by Trade) | to be created |
