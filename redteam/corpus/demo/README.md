# Demo documents of PO-0142

The bill of lading and the commercial invoice of the order of act 1 of the demo, the happy path:
Lingnan Hydrocolloids sells 6,000 kg of agar powder (HS 1302.31) to Pacífico Foods SpA for
USD 48,000.00, FOB Hong Kong, shipped by Harbor Line from Hong Kong to San Antonio. The values
are the ones of PO-0142 in `app/src/data/mock.ts`. The companies and accounts are fictitious.

| File | What it carries |
| --- | --- |
| `PO-0142-bill-of-lading.pdf` | B/L `HLIN-2610-0142`, on board 30 Oct 2026 (the deadline of the order is 20 Nov), HKHKG to CLSAI |
| `PO-0142-commercial-invoice.pdf` | Invoice `LH-2026-0142`, order `PO-0142`, buyer RUT 76.543.210-3, USD 48,000.00, FOB, account `0128 4407 5512 0142` |

Both are rendered by `ingest/src/testing/demoOrder.ts`, and `ingest/src/trade/demoOrder.test.ts`
checks that these files are what it renders, so they cannot drift from the values above.

To upload them from the phone, send them to it (mail, Drive or AirDrop) and use **Upload** on the
order as the exporter. Ingest should answer `ready`, and the invoice should raise no account
alert because the account it prints is the one registered for the exporter.

The order id depends on the wallets of the app, so the files the agent reads are made per setup:

```sh
npm run demo-docs -w ingest -- --importer 0x<importer wallet> --exporter 0x<exporter wallet> \
  --out app/demo-data --escrow 0x<TradeEscrow> --chain-id 84532
```

That writes `documents.json` (what ingest reads, with the hash of each file) and `shipment.json`
(the carrier's attestation of that package, signed with the demo carrier key) in
`app/demo-data/agent/orders/<orderId>/`, next to the `order.json` that app's `demo-data` writes.
The attestation is signed for one escrow contract, so `--escrow` is the deployed address.

The carrier key is `testAccount("demo:carrier:harbor-line")` of `ingest/src/testing/tradeCorpus.ts`.
The order names the address of Harbor Line as its carrier, so that party in `app/src/data/mock.ts`
has to carry the address of this key; the script prints both when they differ.
