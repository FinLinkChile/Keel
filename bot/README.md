# bot (Area 4)

Telegram bot of Keel. It tells people what happened to their orders and bills: deposits, payments, held operations, deadlines and account change attempts. It never decides or executes anything:

* It does not sign, read balances or move funds. Its links only open the Keel app, where the person's own wallet signs.
* Messages come only from fixed templates and typed, validated fields: enums, amounts, dates and values that match a strict regex. No free text from outside (document text, email subject or sender, domain, proposed payment address) ever reaches a message.
* It answers only to the chats in `TELEGRAM_ALLOWED_CHAT_IDS`. Other chats are ignored and logged.
* No LLM (D2). Plain text, no `parse_mode`: there is no formatting to escape or inject.

It serves the whole flow rather than one step: steps 1 to 6 of Keel Trade and the dispute, and in Keel Personal held payments, bills that need a cosignature and beneficiary change requests. It is the channel of T2.6 (alerting when Keel fails closed) and the answer to critical 8 (injection towards the human channel): the threat is not that someone manipulates the bot, which has no LLM, but that text chosen by an attacker reaches a person through a channel they trust.

| Task | Issue |
|---|---|
| T4.3 Safe Telegram bot | #28 |
| T4.6 Held payment, held operation and deadline notices | #31 |

## Run it

From the repository root, with variables in the root `.env` (see `.env.example`):

```sh
# Send one file of notices and exit. BOT_SENDER=console prints instead of sending.
npm run notify -w bot -- examples/act2-document-fraud.json

# Long running: POST /notices (if BOT_INBOUND_TOKEN is set), POST /ingest/outcomes
# (if BOT_INGEST_TOKEN is set) and /start, /status
npm run start -w bot
```

To try it without a `.env`:

```sh
BOT_SENDER=console BOT_RECIPIENTS_FILE=examples/recipients.json \
TELEGRAM_ALLOWED_CHAT_IDS=1001,1002,1003,2001,2002,3001,4001,4002 \
npm run notify -w bot -- examples/act1-happy-path.json
```

Messages go to stdout. The activity log goes to stderr as JSON lines and carries ids, kinds, enums and counts, never a value from a notice.

### With real Telegram

1. Create a bot with [@BotFather](https://t.me/BotFather) (`/newbot`) and copy its token. Without the Telegram app installed, t.me links open nothing: use [Telegram Web](https://web.telegram.org) to talk to BotFather and to your bot.
2. Send any message to your bot, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` and read `message.chat.id`. Group ids are negative.
3. Copy `examples/recipients.json` to `bot/recipients.local.json` and put your chat id in the roles you want to receive. `*.local.json` is ignored by git: real chat ids never enter the repository.
4. In the root `.env`:

   ```sh
   BOT_SENDER=telegram
   TELEGRAM_BOT_TOKEN=<token>
   TELEGRAM_ALLOWED_CHAT_IDS=<your chat id>
   BOT_RECIPIENTS_FILE=recipients.local.json
   ```

5. `npm run notify -w bot -- examples/act2-document-fraud.json`. A chat registered under several roles gets one message per notice.

To get buttons, set `APP_BASE_URL` to a public `https` address (a tunnel to the app works for recording the demo). With a local or `http` base the link goes at the end of the text, and without a base there is no link.

## Variables

Validated with zod at startup. A missing or malformed variable stops the bot before it sends anything, and the error names the variable, never its value.

| Variable | Use |
|---|---|
| `BOT_SENDER` | `telegram` or `console` (default `console`) |
| `TELEGRAM_BOT_TOKEN` | Required when `BOT_SENDER=telegram`. Custody per T2.7 |
| `TELEGRAM_ALLOWED_CHAT_IDS` | Required. Comma separated; group ids are negative |
| `BOT_RECIPIENTS_FILE` | Required. Directory of accounts, names and chats (below) |
| `APP_BASE_URL` | Optional, `http` or `https`. Public `https`: button. Local or `http`: URL in the text. Unset: no link |
| `BOT_INBOUND_TOKEN` | Bearer token of `POST /notices`. At least 32 characters and different from `INGEST_WEBHOOK_TOKEN`. Without it the route does not exist |
| `BOT_INGEST_TOKEN` | Bearer token of `POST /ingest/outcomes`. At least 32 characters, different from `BOT_INBOUND_TOKEN` and from `INGEST_WEBHOOK_TOKEN`. Without it the route does not exist |
| `BOT_PERSONAL_ACCOUNT_ID` | Optional. The personal account ingest reads bills for; must be in the directory. Without it, ingest's Personal sources answer `source_disabled` |
| `BOT_ORDERS_FILE` | Optional, relative to `bot/`. Order book (below). Without it, ingest's Trade source answers `source_disabled` |
| `BOT_HOST` | Default `127.0.0.1` |
| `BOT_PORT` | Default `8789` (ingest uses `8788`) |
| `BOT_MAX_MESSAGES_PER_CHAT_PER_HOUR` | Default `30` |

## Recipients

Two separate dimensions:

* **Account** (who it is): `company`, with roles `owner`, `operator` and `cosigner`; or `personal`, with `owner` and `cosigner` only. These are the two account types of T4.9.
* **Side** (what part it plays in an order), Trade only: `importer`, `exporter` or `arbiter`. It is not an account type: it comes with each notice. Personal recipients have no side.

Names live in the directory, never in a notice, so `POST /notices` has no free text input:

```json
{
  "accounts": {
    "acme-imports": { "kind": "company", "name": "Acme Imports", "roles": { "owner": [1001], "operator": [1002], "cosigner": [1003] } },
    "ana": { "kind": "personal", "name": "Ana", "roles": { "owner": [4001], "cosigner": [4002] } }
  }
}
```

Startup fails if the file does not validate, if a personal account has an `operator` or if a chat is not in `TELEGRAM_ALLOWED_CHAT_IDS`. An account or role without chats is not an error: that recipient gets nothing and it is logged.

## Orders

Ingest names an order by its bytes32 `orderId` and the parties by wallet address. A notice needs the label people use, the parties' accounts and the shipment deadline, so the bot keeps an order book that mirrors the signed orders (never a document):

```json
{
  "orders": {
    "0xd4ea1e15e78409b5ac70c0f757355733cb4685325bb9b238122ad8be30768f8e": {
      "label": "PO-0142", "importer": "acme-imports", "exporter": "lingnan", "arbiter": "hk-arbitration", "shipmentDeadline": 1795132800
    }
  }
}
```

The bytes32 id becomes the notice's `orderRef`, so the app link opens the same order. Startup fails if the file does not validate, if a label is not a valid `orderLabel`, if an account is not in the directory or if an order names the same account twice. There is no address map: ingest's outcomes already say which side uploaded (`party`), and an address is never shown. `examples/orders.json` holds the three demo orders, and the act files use their ids. The ids are computed as the escrow opens an order, `keccak256(abi.encode(importer, exporter, nonce))`, from the app's demo data: regenerate the examples with `npm run bot-examples -w app`, and a real order book for test wallets with `npm run demo-data -w app` (`bot-orders.json`).

## Layers

```
src/
  domain/          Notice (strict zod schemas), recipients, diff revalidation, Message
  application/     NotifyService, routing table, ports
  presentation/    one pure template per kind, formatting
  adapters/
    inbound/       http-source (routes), ingest-source (POST /ingest/outcomes), file-source,
                   ingest-mapper
    outbound/      telegram-sender (grammY), console-sender, link placement
    config/        env, recipients-file, orders-file
    telegram/      /start, /status and the allowlist middleware
  main.ts          composition: the only place that joins ports and adapters
  cli.ts, start.ts entry points
```

Dependency rule, checked by `architecture.test.ts`: `domain` imports nothing from the project; `application` imports only `domain` and reaches the templates through the `Renderer` port; `presentation` imports `domain`; none of the three imports `grammy`, `node:http` or `process.env`.

`NotifyService` validates each notice, rejects one that names an account outside the directory, deduplicates by `id`, routes it, applies the per-chat cap, renders and sends. A notice that does not validate is not sent: it is logged with its id and counted.

## Notices

Every notice has `id` (one per event, used to deduplicate), `occurredAt` (Unix seconds) and `mode`. Objects are strict: an extra field such as `name` fails validation.

In Trade, `orderRef` is opaque and only builds the app URL; `orderLabel` is what is shown, `^[A-Z]{1,4}-[0-9]{1,6}$`, so a phone number cannot pass as a label. Order notices carry `parties: { importer, exporter, arbiter? }` with account ids only. Wallet notices carry the `accountId` of the company that owns the wallet.

| kind | Source | Fields |
|---|---|---|
| `order_opened` | `OrderOpened` | `amountMinor`, `currency`, `shipmentDeadline` |
| `order_funded` | `OrderFunded` (not `FundingExecuted`: the same deposit would notify twice) | `amountMinor`, `currency` |
| `advance_released` | `AdvanceReleased` | `amountMinor`, `currency` |
| `shipment_accepted` | `ShipmentAccepted`. The order is shipped; the balance does not leave yet | `onBoardDate`, `balanceReleasableAt?` (shipment time plus the order's dispute window, shown as a date when present) |
| `balance_released` | `BalanceReleased`. Per `area1/trade-escrow`, the balance leaves when the dispute window closes (`releaseBalance`) or earlier if the importer approves it (`approveBalance`) | `amountMinor`, `currency` |
| `refunded` | `Refunded` | `amountMinor`, `currency` |
| `order_cancelled` | `OrderCancelled` | `amountMinor`, `currency` |
| `dispute_raised` | `DisputeRaised` | `raisedBy` |
| `dispute_resolved` | `DisputeResolved` | `toImporterMinor`, `toExporterMinor`, `currency` |
| `operation_held` | `OperationHeld` and the monitor | `reason`, `deadline?`, `amountMinor?` with `currency?`, `diffs?` (only with `two_source_mismatch`) |
| `deadline_approaching` | T2.6 scheduler | `deadline`, `daysLeft` |
| `account_change_attempt` | ingest (Trade) | none. Never the account, the sender or the text |
| `change_queued` | Delay | `changeKind`, `effectiveAt` |
| `transfer_blocked` | Roles Modifier revert (act 4) | `txHash` |
| `agent_revoked`, `gate_paused` | `AgentRoleRevoked`, `GatePaused` | none |
| `payment_held` | engine (T2.6) | `aliasId`, `amountClp`, `dueDate`, `reason` |
| `payment_deadline` | T2.6 scheduler, at 5, 3 and 1 days (three ids) | `aliasId`, `amountClp`, `dueDate`, `daysLeft` |
| `invoice_needs_cosign` | ingest, `escalated` (tier 3) | `aliasId`, `diffs` |
| `invoice_held` | ingest, `held` | `aliasId?`, `reason` |
| `change_requested` | ingest, `change_requested` | `aliasId`, `triggers`, `requestId` |
| `change_digest` | ingest, `changeDigest(since)` | `count`, `aliasIds` |
| `payment_executed` | `PaymentExecuted` | `aliasId`, `amountClp` |
| `change_vetoed` | `BeneficiaryChangeVetoed` | `aliasId` |
| `change_scheduled` | `BeneficiaryChangeQueued` | `aliasId`, `effectiveAt` |

Enums of the bot. How producers reach the bot is not decided yet: `POST /notices` is a proposal, and each producer's reason codes are mapped into these enums by its adapter, to be agreed with Area 2 (engine) and Area 3 (ingest):

* `operation_held.reason`: `new_supplier_wait`, `over_limit_cosign`, `documents_mismatch`, `two_source_mismatch`, `hidden_text`, `account_change_mention`, `bl_reused` (the bill of lading already settled another order) and `document_unreadable` (neither reader could read it; the importer is asked to get a clean copy). Three more come from the engine (T2.6): `funding_blocked` (the engine refused the deposit), `simulation_failed` (the step would revert on chain, so nothing was sent) and `agent_data_incomplete` (the agent's data does not match the order). Document reasons are the six from `documents_mismatch` to `document_unreadable`: the exporter gets the generic version.
* `payment_held.reason`: `issuer_mismatch`, `amount_out_of_range`, `over_period_limit`, `fx_divergence`, `account_change_request`, `hidden_text`, `simulation_failed`.
* `change_queued.changeKind`: `limit`, `supplier_added`, `role_change`, `policy_signer`. An assumption, to align with what Area 1's Delay queues once it exists.
* `currency`: `USD`, `EUR`, `CNY`, `HKD`, the commercial invoice enum. Decimals per currency live in `presentation/format.ts`, because the payment token is open decision 1.

### Two source mismatch (T3.5)

T3.5 says the notice shows both readings. A regex is not enough for identifiers: `56912345678` passes the invoice number regex and is a phone number. So:

* Fixed shape fields show both values, each revalidated against its field. Trade: `doc_type`, `on_board_date`, `port_of_loading` and `port_of_discharge` (UN/LOCODE, five characters), `amount_minor` with the order's currency, `currency`, `incoterm`. Personal: `period`, `amount_clp`, `alias_id`. The enums come from `@keel/schemas`.
* Identifiers only say which field disagrees. Trade: `document_number`, `invoice_number`, `order_number`, `importer_tax_id` and `hs_code` (6 to 10 digits, room for a phone number). Personal: `issuer_tax_id`, `invoice_number`. Both values are in the app (T4.2), so T3.5 is met in the app and the T4.3 rule in the chat.

Trade diffs cover the twelve fields ingest compares on a transport document and a commercial invoice, so a disagreement on any of them reaches the importer instead of failing validation.

`diffs` is a list of `{ field, a, b }`; the ingest mapper puts the parser in `a` and the LLM in `b`. If a value fails its check the notice still goes out, because it is a security alert, but that line only says the field does not match. The case is logged and counted.

## Routing

| Notice | Importer | Exporter | Arbiter |
|---|---|---|---|
| `order_opened`, `order_funded`, `shipment_accepted`, `balance_released`, `refunded`, `order_cancelled` | owner, operator | owner, operator | |
| `advance_released`, `deadline_approaching` | operator | owner, operator | |
| `operation_held` `over_limit_cosign` | cosigner, owner | | |
| `operation_held` `new_supplier_wait`, `funding_blocked`, `simulation_failed`, `agent_data_incomplete` | owner, operator | | |
| `operation_held` document reasons | owner, operator, with the detail | operator, generic version | |
| `account_change_attempt` | owner, operator | owner | |
| `change_queued` | cosigner, owner | | |
| `transfer_blocked`, `agent_revoked`, `gate_paused` | owner, cosigner | | |
| `dispute_raised`, `dispute_resolved` | owner, operator | owner, operator | owner |

The exporter is never told which control fired: "hidden text" would teach an attacker what is detected. A second document hold on the same order tells the exporter that another document is under review.

| Personal notice | Recipients |
|---|---|
| `payment_held`, `payment_deadline`, `invoice_held`, `payment_executed`, `change_vetoed` | owner |
| `change_scheduled`, `change_requested`, `change_digest` | owner, cosigner |
| `invoice_needs_cosign` | cosigner, owner |

`change_requested` carries neither the sender's domain nor the proposed destinations: a look-alike domain is the attack itself, and it is compared calmly in the app's readable diff (T4.2). Quarantined emails produce no notice, so spam never becomes notifications.

## Inputs

Both HTTP routes share one server on `BOT_HOST:BOT_PORT`, each with its own Bearer token compared in constant time and a 64 KB body limit. A route without its token does not exist (`404`).

* `POST /notices`: `Authorization: Bearer <BOT_INBOUND_TOKEN>`; a `Notice` or an array of up to 100. `401` without a valid token; `400` if any notice does not validate, and then none of the batch is sent; `202` with each notice's status otherwise.
* `POST /ingest/outcomes`: `Authorization: Bearer <BOT_INGEST_TOKEN>`; ingest's own output, which the bot maps (see "For Area 3").
* `file-source`: `npm run notify -w bot -- <file>`. The examples in `examples/` are the four Trade demo acts and `personal-two-sources.json`, with fictitious accounts and chats. `examples.test.ts` keeps them valid.
* `ingest-mapper`: turns ingest's `escalated`, `held` and `change_requested` outcomes and `changeDigest` into notices. It imports from `@keel/ingest` with `import type` only, because ingest pulls heavy SDKs. It is written against ingest's types but not wired to ingest: how producers reach the bot is not decided yet, and wiring it is Area 3's side. The personal `accountId` comes from configuration, since ingest knows no accounts.
* `ingest-trade-mapper`: turns a Trade `TradeOutcome` into zero, one or several notices (see "For Area 3"). It reads the outcome through a copy of its shape that parsing strips down to what is read, so `alert.found` and any other field never exist for the code that builds a notice. A test checks the copy against ingest's types and its constants.

### For Area 3

Ingest posts what it already produces, as is; it does not need to know the `Notice` format.

The call is optional and must never block ingest:

* Ingest calls the bot only if it has `BOT_URL` and `BOT_INGEST_TOKEN` configured.
* If the bot is down or slow, the email or document is processed anyway: a short timeout, and the error is only logged. A notice is a warning to a person, never a step of the payment path.
* Someone in ingest runs `IngestStore.changeDigest(since)` periodically, for example once a day, and posts the result.
* Still to agree with Area 3: whether change requests are also notified one by one besides the digest. Today the bot accepts both, and the per-chat cap applies to both.

```
POST /ingest/outcomes
Authorization: Bearer <BOT_INGEST_TOKEN>

{ "source": "email", "outcome": <EmailOutcome> }
{ "source": "change_digest", "since": "<ISO 8601>", "requests": [<StoredChangeRequest>, ...] }
{ "source": "trade_upload", "outcome": <TradeOutcome> }
```

* After `receiveEmail`, post its outcome. After `IngestStore.changeDigest(since)`, post the requests with the same `since`.
* Answers: `401` without the token; `400` with `invalid_body` if the body lacks this shape, `mapper_failed` if the outcome cannot be mapped (only the error class is logged) or `source_disabled` if the source is not configured; `202` with `{ "status": "accepted" | "duplicate" | "rejected" | "ignored" }`. `ignored` is for `quarantined`, `duplicate` and `ready` emails: nothing to tell. `rejected` means the mapped notice did not validate.
* Posting the same outcome twice is safe: the notice id comes from the message hash or the request id.
* `trade_upload` needs `BOT_ORDERS_FILE` to turn the `orderId` into a label, the accounts and the shipment deadline; without it the source is disabled (`400 source_disabled`), and an `orderId` that is not in the file gives `400 mapper_failed`. One upload can give several notices, and then the answer is `{ "status": <first of accepted, duplicate, rejected>, "notices": [<each status>] }`. Mapping:

| `TradeOutcome` | Notice |
|---|---|
| `held`, `disagreement` | `operation_held` `two_source_mismatch`, with `diffs` (parser in `a`, LLM in `b`) |
| `held`, `doc_type_mismatch` | `operation_held` `documents_mismatch` |
| `held`, `bl_used_by_other_order` | `operation_held` `bl_reused` |
| `held`, `parser_failed` or `extractor_failed` | `operation_held` `document_unreadable` |
| a reading (`ready` or `disagreement`) with `alert` | `account_change_attempt`, next to the hold if there is one. The destinations in `found`, the triggers and the reminder code never reach the chat: the message already says the account only changes with a new order signed by both sides |
| a reading (`ready` or `disagreement`) whose extraction has `hidden_text_detected` | `operation_held` `hidden_text`, next to any other hold |
| `ready` without `alert` or hidden text | nothing |
| `rejected`, `quarantined`, `duplicate` | nothing (ingest logs them) |

Each notice id is made from the file hash and the reason (the alert's id for an alert), so reporting the same upload twice sends it once. A comparison field that the bot does not know is dropped from `diffs`; the hold still goes out. The currency and amount of a disagreement come from the parser's reading and are used only to show an amount that disagrees.

### Adding a producer

1. Write a mapper in `adapters/inbound/` from the producer's type to `Notice`, translating its reason codes into the bot's enums.
2. Do not validate there: `NotifyService` validates every notice and drops what does not fit. It acts as the anticorruption layer.
3. Give each event its own `id`: a reminder at 5, 3 and 1 days is three notices.
4. If the transport is not HTTP (for example a queue), add a transport adapter next to `http-source`. Nothing in `domain/`, `application/` or `presentation/` changes.

## Flood control

Grouping is ingest's job (T3.2, `changeDigest`); the bot sends what arrives. As a safety net, each chat gets at most `BOT_MAX_MESSAGES_PER_CHAT_PER_HOUR` messages per window. Past the cap the chat gets one fixed message ("More alerts arrived this hour. See them in Keel.") and nothing more until the next window; what was not sent is logged and counted.

Chain and engine notices an attacker cannot repeat at will always go out: `operation_held`, `transfer_blocked`, `agent_revoked`, `gate_paused` and `payment_held`. Everything else counts toward the cap, including what is born from emails or documents (`account_change_attempt`, `change_requested`, `invoice_needs_cosign`, `invoice_held`), because an attacker can send hundreds.

The source decides, not only the kind: `operation_held` is not capped when it comes from the agent or the engine (`POST /notices`), but a hold that ingest produced from a document (`POST /ingest/outcomes`) counts, because an uploader can repeat it. The route says where a notice was born; it is never read from the notice.

## Known limits

* Deduplication and the per-chat cap are in memory: a restart can resend a notice.
* A local `APP_BASE_URL` goes as text, not as a button.
* Telegram is blocked in mainland China. The corridor is Chile and Hong Kong, where it works, but a mainland exporter would need another channel.
* How deep Keel Personal goes in the delivery is open decision 14. The bot covers all nine Personal kinds, but only those that ingest and the engine already produce are exercised by the demo files.
* How producers reach the bot is not decided yet: `POST /notices` with the bot's own `Notice` and `POST /ingest/outcomes` with ingest's own output are a proposal, and each producer's reason codes are mapped by its adapter, to be agreed with Area 2 (engine) and Area 3 (ingest).
* The order book is a file, like ingest's `INGEST_ORDERS_FILE`. Who keeps both in sync with the signed orders is not decided yet.
* Dates are shown in UTC; the year is shown only when it is not the current one.
