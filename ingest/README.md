# ingest (Area 3)

Authenticated email channel, deterministic PDF parser, quarantined LLM extractor and the comparison between both.

`src/index.ts` declares `parseInvoice`, `extractInvoice` and `invoiceKey`. Both readers return the `InvoiceExtraction` schema from `@keel/schemas`, which has no free text. Addresses found in a document never reach a payment: they go only to the beneficiary change flow.

```sh
npm run serve -w ingest       # inbound webhook, needs INGEST_* and LLM_* in .env
npm run typecheck -w ingest
```

## Inbound email (T3.1)

The mail forwarder POSTs the raw MIME message to `POST /inbound` with `Authorization: Bearer $INGEST_WEBHOOK_TOKEN` and the SMTP envelope in `X-Envelope-Ip`, `X-Envelope-Helo` and `X-Envelope-From`. `receiveEmail` then:

1. Authenticates the author domain with `mailauth`: DMARC must pass, or, for a domain without a DMARC record, an aligned DKIM signature must. SPF alone never authenticates the visible From.
2. Requires that domain (or a subdomain of it) to be registered for an alias.
3. Takes exactly one attachment that is a PDF by content.
4. Reads it with both readers (T3.5) and requires the issuer's alias to be one of the sender domain's aliases.

Anything else is quarantined with a typed reason, before the model is called. Step 1 follows the `requireDmarc` setting below: when it is `false`, an aligned DKIM signature also authenticates a domain that publishes no DMARC record.

## Beneficiary change requests (T3.6)

A destination in a document never becomes a payment address. If the document announces new bank details, or contains a bank account or wallet that is not in the alias's `knownDestinations` (hidden text included), the outcome is `change_requested` instead of `ready`, with a `ChangeRequest`: alias, previous and proposed destinations, triggers, sender domain with its SPF/DKIM/DMARC results, and the hashes of the PDF and the email. Area 4 shows it as a readable diff; if the owner confirms, Area 1's Delay Modifier queues it.

Onboarding should register, per alias, the payout wallet and the bank account the issuer prints on its invoices; otherwise every legitimate invoice opens a request.

## Flood protection (T3.2)

Checks run cheapest first, so a flood costs no LLM calls. State lives in SQLite (`INGEST_DB_FILE`) and holds hashes, domains and change requests, never message content.

| Control | Outcome |
|---|---|
| Same message received again | `duplicate` |
| More than 20 authenticated messages from one domain in 24 hours | `quarantined: rate_limited` |
| Same `invoiceKey` in a new message (checked after the parser, before the model) | `duplicate`, no LLM call |
| A change request already pending for the alias (enforced by a unique index) | `quarantined: change_pending` |
| A change for the alias rejected or vetoed in the last 7 days | `quarantined: change_cooldown` |

Only authenticated mail counts against a domain's quota, so a spoofer cannot exhaust it. `IngestStore.resolveChange(id, "approved" | "rejected" | "vetoed")` records the owner's decision (Area 4) or the on-chain veto, and `changeDigest(since)` returns the day's requests for one summary message instead of one notification each.

## Admin settings API (for Area 4's admin screen)

An admin can switch the LLM and the DMARC policy at runtime. Requests carry `Authorization: Bearer $INGEST_ADMIN_TOKEN`; without that variable the routes do not exist.

`GET /admin/settings`

```json
{
  "settings": { "provider": "anthropic", "model": "claude-opus-5-5", "requireDmarc": true },
  "updatedAt": "2026-10-12T15:04:05.000Z",
  "updatedBy": "env",
  "availableProviders": ["anthropic", "openai-compatible"]
}
```

`PUT /admin/settings` with header `X-Admin-Actor: <who>` and any subset of the settings:

```json
{ "provider": "openai-compatible", "model": "qwen-plus", "baseURL": "https://<endpoint>/v1", "requireDmarc": false }
```

* Only providers listed in `availableProviders` (those with an API key in the environment) are accepted. API keys are never accepted or returned by this API.
* `baseURL` applies only to `openai-compatible` and must be https (plain http only to localhost).
* Invalid input returns `400 {"error": "invalid_settings", "message": ...}` and changes nothing.
* Every effective change is logged as `{"type": "settings_changed", "actor", "at", "changes": {field: {from, to}}}`. Relaxing `requireDmarc` lowers the bar for who can send invoices, and switching providers changes where redacted invoice text is sent; the screen should say so before confirming.
* `requireDmarc` defaults to `true`. The log receives only the message hash, the status, the reason and the SPF/DKIM/DMARC keywords. The server refuses to start without a token of at least 32 characters and listens on 127.0.0.1 unless `INGEST_HOST` says otherwise.

The invoice corpus lives in `redteam/corpus/` so Area 5 can measure against it.

## Choosing the LLM

The extractor is provider-agnostic. The prompt, the schema the model sees and the strict validation of its reply live in `src/extractor/contract.ts`; each vendor is a small adapter in `src/extractor/providers/`. Configure it in `.env`:

| `LLM_PROVIDER` | `LLM_MODEL` | Input sent | Notes |
|---|---|---|---|
| `anthropic` (default) | defaults to `claude-opus-5-5` | Strict JSON Schema output, server-side refusal fallback |
| `openai` | required | Responses API, strict JSON Schema |
| `gemini` | required | `responseJsonSchema`, temperature 0 |
| `openai-compatible` | required, plus `LLM_BASE_URL` | Qwen (Alibaba DashScope), DeepSeek, Kimi or a self-hosted model |

The registered issuer RUTs are never given to the model, so it cannot "correct" a fraudulent issuer and hide it from the two-source comparison. Whatever the provider returns is rejected unless it matches the schema exactly.

## Personal data never reaches the LLM

`src/privacy.ts` applies [privacy-kit-cl](https://github.com/Yugoxc/privacy-kit-cl) (Ley 21.719) before any provider call:

* The model never receives the PDF, only its text with RUTs, names, addresses, emails, phones, bank accounts and wallet addresses replaced by tokens such as `[RUT_1a2b3c4d]`. Hidden runs stay in the text, so the model still faces the injection attempt.
* The model returns the issuer's RUT token; Keel rehydrates it locally. The token map never leaves the process, and a token not issued for that invoice fails validation.
* Each call uses a fresh random salt. privacy-kit-cl derives tokens as `sha256(salt:value)`, and with its default fixed salt the roughly 10^8 possible RUTs could be brute-forced from a token.
* Each call is logged as a transfer to a third party (`transferLog()`).

## Hidden text detection

Text a person would not see never feeds the payment fields and raises `hidden_text_detected`: invisible rendering modes, layers that are off by default, annotation appearances, glyphs under 4 pt or squeezed horizontally, text outside the page, transparent text (`ca`/`CA` below 0.1), and text whose painted color (fill or stroke, by rendering mode) is white. Look-alike characters (Cyrillic, full-width, mathematical or superscript digits, zero-width) raise the same flag. Input over 10 MB or 20 pages, encrypted or malformed PDFs, and text over 20,000 characters are held with a typed reason.

Known gaps, declared rather than hidden: text covered by a white shape drawn on top of it, text cut away by a clipping path, soft masks, and text the same color as a non-white background are not detected yet.

Limits of the privacy layer: masking is pattern based. A personal name without a label (`Señor(es):`, `Cliente:`…) is not detected, and the issuer company name is left visible on purpose.

```sh
npm run extract -w ingest -- invoice.pdf   # calls the real API, prints LLM vs parser
```

## Tasks

| Task | Issue |
|---|---|
| T3.1 Authenticated inbound channel | #18 |
| T3.2 Flood protection | #19 |
| T3.3 Deterministic parser | #20 |
| T3.4 Quarantined LLM extractor | #21 |
| T3.5 Two source agreement | #22 |
| T3.6 Beneficiary change detection | #23 |
| T3.7 Idempotency key | #24 |
| T3.8 Invoice corpus | #25 |
