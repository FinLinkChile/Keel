// Fills the blank carrier forms of redteam/corpus/carrier-forms/blank (CSAV, Hapag-Lloyd) with
// known corridor data and writes them to filled/, each in two versions (the value next to its
// label or under it) and as the whole file or the form page only, plus manifest.json with the
// truth and the expected reading of every file. Usage: npm run carrier-forms -w ingest
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { findDate } from "../src/trade/normalize";

const dir = new URL("../../redteam/corpus/carrier-forms/", import.meta.url);
await mkdir(new URL("filled/", dir), { recursive: true });
const RENDERED_AT = new Date("2026-10-16T00:00:00Z");

const SETS = {
  csav: {
    file: "15269_Formular_BillofLading_CSAV.pdf",
    bl: "CSVNGB26100447",
    vessel: "CSAV TRAIGUEN",
    voyage: "2641W",
    pol: "NINGBO, CHINA",
    pod: "SAN ANTONIO, CHILE",
    por: "NINGBO CY",
    pdl: "SAN ANTONIO CY",
    date: "15 OCT 2026",
    issue: "NINGBO",
    container: "CSNU 6184520 / SEAL 4471023",
    goods: ["200 CARTONS", "ELECTRIC DRILLS", "HS CODE 8467.21"],
    gw: "20,000 KGS",
    cbm: "38.5 CBM",
    exportRef: "INV NB20261003 / PO-0142",
    truth: { document_number: "CSVNGB26100447", port_of_loading: "CNNGB", port_of_discharge: "CLSAI" },
    // The specimen's "SAMPLE" watermark is drawn in an invisible rendering mode
    hiddenReasons: ["invisible_mode"],
  },
  hapag: {
    file: "7345_BillofLading_A4.pdf",
    bl: "HLCUSHA261009812",
    vessel: "SANTOS EXPRESS",
    voyage: "042E",
    pol: "SHANGHAI, CHINA",
    pod: "VALPARAISO, CHILE",
    por: "SHANGHAI CY",
    pdl: "VALPARAISO CY",
    date: "09 OCT 2026",
    issue: "SHANGHAI",
    container: "HLXU 8823104 / SEAL 0098812",
    goods: ["120 PALLETS", "CERAMIC TILES", "HS CODE 6907.21"],
    gw: "18,400 KGS",
    cbm: "52.0 CBM",
    exportRef: "INV SH-2026-0917 / PO-0157",
    truth: { document_number: "HLCUSHA261009812", port_of_loading: "CNSHA", port_of_discharge: "CLVAP" },
    // Same watermark, plus the printer's slug left outside the page
    hiddenReasons: ["off_page", "invisible_mode"],
  },
};

// How the parser reads the blank forms: held, never a value taken from a label
const BLANK = {
  "15269_Formular_BillofLading_CSAV.pdf": { reason: "missing_field", field: "document_number" },
  "7345_BillofLading_A4.pdf": { reason: "missing_field", field: "document_number" },
  // A sea waybill is not a document type of the schema
  "7346_Sea_Waybill_LV_06-16.pdf": { reason: "unknown_document_type" },
  // The label under the empty B/L number box ("REFERENCE NO.") is not read as the number
  "sample-copy-heavyconbill.pdf": { reason: "missing_field", field: "document_number" },
  "shubil-a-sample.pdf": { reason: "missing_field", field: "document_number" },
};

const filled: Record<string, unknown> = {};
for (const [name, d] of Object.entries(SETS)) {
  for (const layout of ["inline", "below"] as const) {
    const doc = await PDFDocument.load(await readFile(new URL(`blank/${d.file}`, dir)));
    doc.setModificationDate(RENDERED_AT);
    const font = await doc.embedFont(StandardFonts.Courier);
    const page = doc.getPage(1);
    const put = (t: string, x: number, y: number, size = 8) => page.drawText(t, { x, y, size, font, color: rgb(0, 0, 0.35) });
    // Label position and where an inline value starts; "below" types it 11 pt under the label
    const field = (lx: number, ly: number, ix: number, v: string) => (layout === "inline" ? put(v, ix, ly) : put(v, lx + 2, ly - 11));
    field(381, 763, 418, d.bl);
    field(47, 558, 92, d.vessel);
    field(249, 558, 295, d.voyage);
    field(47, 522, 112, d.pol);
    field(47, 498, 118, d.pod);
    field(308, 618, 372, d.por);
    field(308, 546, 375, d.pdl);
    field(308, 138, 402, `${d.issue}, ${d.date}`);
    put("NINGBO LINGNAN HYDROCOLLOIDS CO., LTD.", 49, 798);
    put("NO. 88 BEILUN ROAD, NINGBO, CHINA", 49, 788);
    put("ACME IMPORTS SPA", 49, 714);
    put("RUT 76.543.210-3", 49, 704);
    put("AV. APOQUINDO 4500, SANTIAGO, CHILE", 49, 694);
    put("SAME AS CONSIGNEE", 49, 630);
    put(d.exportRef, 310, 726);
    put(d.container, 49, 455);
    d.goods.forEach((g, i) => put(g, 181, 455 - i * 10));
    put(d.gw, 440, 455);
    put(d.cbm, 505, 455);
    put("THREE (3)", 440, 102);
    // The on board notation, as carriers stamp it
    if (layout === "inline") put(`SHIPPED ON BOARD: ${d.date}`, 310, 92, 9);
    else {
      put("SHIPPED ON BOARD", 310, 96, 9);
      put(d.date, 310, 85, 9);
    }
    const expected = { ...d.truth, doc_type: "BILL_OF_LADING", on_board_date: findDate(d.date), hiddenReasons: d.hiddenReasons };

    const whole = `${name}-${layout}.pdf`;
    await writeFile(new URL(`filled/${whole}`, dir), await doc.save());
    filled[whole] = expected;

    // The form page alone, as a carrier often sends a copy without the terms
    const face = await PDFDocument.create();
    face.setCreationDate(RENDERED_AT);
    face.setModificationDate(RENDERED_AT);
    const [copied] = await face.copyPages(doc, [1]);
    face.addPage(copied);
    const facePath = `${name}-${layout}-face.pdf`;
    await writeFile(new URL(`filled/${facePath}`, dir), await face.save());
    filled[facePath] = expected;
  }
}

await writeFile(new URL("manifest.json", dir), `${JSON.stringify({ filled, blank: BLANK }, null, 2)}\n`);
console.log(`${Object.keys(filled).length} filled forms, ${Object.keys(BLANK).length} blank forms`);
