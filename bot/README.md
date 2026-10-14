# bot (Area 4)

Telegram bot. It sends template messages built from typed fields only, answers only to registered chats and signs nothing: its buttons open the Keel app.

It never forwards text from a document or an email. In Keel Personal the notices cover executed payments, held payments with their due date and the manual alternative, and beneficiary change requests. In Keel Trade they cover the steps of the flow in [docs/flujo/flujo-clave.md](../docs/flujo/flujo-clave.md): deposit, advance, shipment, balance, refund, held operations, approaching shipment deadlines and account change alerts.

```sh
npm run start -w bot
```

`TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_CHAT_IDS` come from `.env`.

## Tasks

| Task | Issue |
|---|---|
| T4.3 Safe Telegram bot | #28 |
| T4.6 Held payment, held operation and deadline notices | #31 |
