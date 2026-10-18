# Real carrier forms

Specimen bill of lading forms that carriers publish, used to check that ingest reads real carrier layouts and not only the synthetic corpus of `../trade`. The repository is private; these files are the carriers' published specimens, all marked "SAMPLE" or "NOT VALID", and are kept for testing only.

| Folder | Content |
|---|---|
| `blank/` | The specimens as downloaded: CSAV and Hapag-Lloyd bills of lading, a Hapag-Lloyd sea waybill, the BIMCO HEAVYCONBILL and the SHUBIL-1994 form |
| `filled/` | The CSAV and Hapag-Lloyd bills of lading typed with known corridor data, by `npm run carrier-forms -w ingest` |
| `manifest.json` | The truth of every filled file and the expected reading of every blank one |

Each filled form exists in four versions: the value next to its label (`inline`) or under it inside the box (`below`), as the whole file with the terms on the back or as the form page only (`-face`). The data is fictitious; the parties match the demo order (Ningbo Lingnan Hydrocolloids to Acme Imports SpA).

| Set | B/L number | On board | Route |
|---|---|---|---|
| `csav-*` | `CSVNGB26100447` | 15 OCT 2026 | Ningbo (CNNGB) to San Antonio (CLSAI) |
| `hapag-*` | `HLCUSHA261009812` | 09 OCT 2026 | Shanghai (CNSHA) to Valparaíso (CLVAP) |

## Checks

* `ingest/src/carrierForms.test.ts`, with no network: the parser reads every field of the eight filled files and holds the five blank ones without taking a label as a value.
* `npm run carrier-forms:run -w ingest`, live: the parser and the configured model on the eight filled files. Measured on 2026-10-16 with `claude-opus-5-5` through the hackathon proxy: 32/32 fields right for the parser and 32/32 for the model, the whole two page files included.

The filled files are not `ready` end to end, and should not be: the specimens draw their "SAMPLE" watermark in an invisible rendering mode, and the Hapag-Lloyd one leaves its printer's slug outside the page, so the parser raises `hidden_text_detected` and the engine holds with `HIDDEN_TEXT`. An issued bill of lading carries neither.

The sea waybill is held as an unknown document type: `SEA_WAYBILL` is not in the schema (`@keel/schemas`, Area 2).
