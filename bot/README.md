# bot (Area 4)

Telegram bot. It sends template messages built from typed fields only, answers only to registered chats and signs nothing: its buttons open the Keel app.

It never forwards text from a document or an email. The notices cover the steps of the flow in [docs/flujo_clave.md](../docs/flujo_clave.md): deposit, advance, shipment, balance, refund, held operations, approaching shipment deadlines and account change alerts.

```sh
npm run start -w bot
```

`TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_CHAT_IDS` come from `.env`.

## Tasks

| Task | Issue |
|---|---|
| T4.3 Safe Telegram bot | #28 |
| T4.6 Held operation and deadline notices | #31 |
