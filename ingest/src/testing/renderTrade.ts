// Renders synthetic Keel Trade documents for tests and the corpus (T3.8): ocean bills of lading
// in two carrier layouts, an air waybill and a commercial invoice. Every company is fictitious.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { drawExtras, type ExtraText } from "./renderInvoice";

// Fixed metadata, so the same spec always renders the same bytes (and the same file hash)
const RENDERED_AT = new Date("2026-10-01T00:00:00Z");

async function newPage() {
  const doc = await PDFDocument.create();
  doc.setCreationDate(RENDERED_AT);
  doc.setModificationDate(RENDERED_AT);
  doc.setProducer("keel-corpus");
  doc.setCreator("keel-corpus");
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { doc, page, font, bold };
}

type Row = string | [string, string];

// Each row is a line of text, or two boxes side by side on the same line.
async function render(header: { company: string; title: string }, rows: Row[], extra: ExtraText[] = [], seed?: string) {
  const { doc, page, font, bold } = await newPage();
  page.drawText(header.company, { x: 40, y: 790, size: 13, font: bold });
  page.drawText(header.title, { x: 40, y: 768, size: 12, font: bold, color: rgb(0, 0.2, 0.5) });
  let y = 735;
  for (const row of rows) {
    if (typeof row === "string") {
      page.drawText(row, { x: 40, y, size: 10, font });
    } else {
      page.drawText(row[0], { x: 40, y, size: 10, font });
      page.drawText(row[1], { x: 320, y, size: 10, font });
    }
    y -= 18;
  }
  // A visually negligible change: same text, different bytes (the "re-rendered" attack)
  if (seed) page.drawText(seed, { x: 560, y: 20, size: 4, font, color: rgb(0.85, 0.85, 0.85) });
  drawExtras(doc, page, font, extra);
  return doc.save();
}

export interface TransportSpec {
  kind: "BILL_OF_LADING" | "AIR_WAYBILL";
  // Carrier template: two ocean layouts and one air layout
  layout: "oceanlink" | "pacific" | "skybridge";
  number: string;
  onBoardDate: string;
  portOfLoading: string;
  portOfDischarge: string;
  shipper: string;
  consignee: string;
  goods: string;
  vessel?: string;
  notes?: string[];
  extra?: ExtraText[];
  // Adds an almost invisible mark so the file hash changes but no field does
  seed?: string;
  // Overrides the title printed at the top
  title?: string;
  // Overrides the carrier printed in the header and the signature line of its layout
  company?: string;
}

export async function renderTransport(spec: TransportSpec): Promise<Uint8Array> {
  const notes = spec.notes ?? [];
  if (spec.layout === "oceanlink") {
    const company = spec.company ?? "OCEANLINK SHIPPING CO., LTD.";
    return render(
      { company, title: spec.title ?? "BILL OF LADING" },
      [
        `B/L No.: ${spec.number}`,
        `Shipper: ${spec.shipper}`,
        `Consignee: ${spec.consignee}`,
        "Notify Party: SAME AS CONSIGNEE",
        `Vessel / Voyage: ${spec.vessel ?? "OCEANLINK HARMONY 026E"}`,
        `Port of Loading: ${spec.portOfLoading}`,
        `Port of Discharge: ${spec.portOfDischarge}`,
        `Description of Goods: ${spec.goods}`,
        "Freight: PREPAID",
        `Shipped on Board Date: ${spec.onBoardDate}`,
        ...notes,
        `Signed for the carrier ${company} as carrier`,
      ],
      spec.extra,
      spec.seed,
    );
  }
  if (spec.layout === "pacific") {
    return render(
      { company: spec.company ?? "PACIFIC STAR LINES", title: spec.title ?? "BILL OF LADING FOR OCEAN TRANSPORT" },
      [
        `BILL OF LADING NUMBER ${spec.number}`,
        [`SHIPPER: ${spec.shipper}`, `CONSIGNEE: ${spec.consignee}`],
        [`PORT OF LOADING ${spec.portOfLoading}`, `PORT OF DISCHARGE ${spec.portOfDischarge}`],
        `VESSEL ${spec.vessel ?? "PACIFIC STAR AURORA V.118W"}`,
        `GOODS: ${spec.goods}`,
        `LADEN ON BOARD: ${spec.onBoardDate}`,
        ...notes,
      ],
      spec.extra,
      spec.seed,
    );
  }
  return render(
    { company: spec.company ?? "SKYBRIDGE CARGO AIRLINES", title: spec.title ?? "AIR WAYBILL" },
    [
      `AWB No.: ${spec.number}`,
      `Shipper: ${spec.shipper}`,
      `Consignee: ${spec.consignee}`,
      `Airport of Departure: ${spec.portOfLoading}`,
      `Airport of Destination: ${spec.portOfDischarge}`,
      `Nature and Quantity of Goods: ${spec.goods}`,
      `Flight Date: ${spec.onBoardDate}`,
      ...notes,
    ],
    spec.extra,
    spec.seed,
  );
}

export interface CommercialInvoiceSpec {
  seller: string;
  buyer: string;
  // Printed RUT of the buyer, e.g. "76.543.210-3"
  buyerRut: string;
  invoiceNumber: string;
  orderNumber: string;
  date: string;
  // Printed after "Terms of Delivery:", e.g. "FOB NINGBO"
  terms: string;
  currency: string;
  // `unit` is printed after the quantity, PCS when omitted
  items: { description: string; hs: string; qty: number; unitPrice: string; amount: string; unit?: string }[];
  // Overrides the computed total line(s)
  totalLines?: string[];
  bankLines?: string[];
  notes?: string[];
  extra?: ExtraText[];
  seed?: string;
}

export async function renderCommercialInvoice(spec: CommercialInvoiceSpec): Promise<Uint8Array> {
  const items = spec.items.map(
    (i) => `${i.description}  ${i.qty} ${i.unit ?? "PCS"}  ${spec.currency} ${i.unitPrice}  ${spec.currency} ${i.amount}  HS Code: ${i.hs}`,
  );
  const total = spec.items.reduce((sum, i) => sum + Number(i.amount.replace(/,/g, "")), 0);
  const totalText = total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return render(
    { company: spec.seller, title: "COMMERCIAL INVOICE" },
    [
      `Invoice No.: ${spec.invoiceNumber}`,
      `Date: ${spec.date}`,
      `Order No.: ${spec.orderNumber}`,
      `Buyer: ${spec.buyer}`,
      `RUT: ${spec.buyerRut}`,
      `Terms of Delivery: ${spec.terms}`,
      ...items,
      ...(spec.totalLines ?? [`TOTAL AMOUNT: ${spec.currency} ${totalText}`]),
      ...(spec.bankLines ?? []),
      ...(spec.notes ?? []),
    ],
    spec.extra,
    spec.seed,
  );
}

// A bill of lading built like the carrier forms of CSAV and Hapag-Lloyd: the contract of
// carriage in two columns of fine print on the first page, and on the second a form of boxes
// with the label at the top ("B/L-No.:") and the value typed inside, next to the label or
// under it. The "received by the carrier" paragraph on the form repeats the port labels in a
// sentence. Fictitious carrier; no carrier's form is copied.
export interface CarrierFormSpec {
  // Absent fields leave their box empty, as on a blank form
  number?: string;
  onBoardDate?: string;
  portOfLoading?: string;
  portOfDischarge?: string;
  values: "inline" | "below";
  // The fine print page; on by default
  terms?: boolean;
  // Prints another label right under the empty B/L number, as the BIMCO forms do
  referenceUnderNumber?: boolean;
}

const TERMS_CLAUSE =
  "CARRIER SHALL CARRY THE GOODS FROM THE PORT OF LOADING TO THE PORT OF DISCHARGE STATED IN THIS BILL OF LADING";

export async function renderCarrierForm(spec: CarrierFormSpec): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setCreationDate(RENDERED_AT);
  doc.setModificationDate(RENDERED_AT);
  doc.setProducer("keel-corpus");
  doc.setCreator("keel-corpus");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const typed = await doc.embedFont(StandardFonts.Courier);

  if (spec.terms !== false) {
    const back = doc.addPage([595, 842]);
    back.drawText("BILL OF LADING - TERMS AND CONDITIONS", { x: 30, y: 820, size: 7, font: bold });
    for (let row = 0; row < 130; row++) {
      const y = 805 - row * 6;
      back.drawText(`${row + 1}. ${TERMS_CLAUSE}`.slice(0, 98), { x: 30, y, size: 4.5, font });
      back.drawText(`(${row + 1}) ${TERMS_CLAUSE}`.slice(0, 98), { x: 305, y, size: 4.5, font });
    }
  }

  const page = doc.addPage([595, 842]);
  const label = (t: string, x: number, y: number) => page.drawText(t, { x, y, size: 7, font: bold });
  const value = (t: string | undefined, lx: number, ly: number, ix: number) => {
    if (t === undefined) return;
    if (spec.values === "inline") page.drawText(t, { x: ix, y: ly, size: 8, font: typed });
    else page.drawText(t, { x: lx + 2, y: ly - 11, size: 8, font: typed });
  };
  page.drawText("Carrier: AUSTRAL OCEAN LINES SPA, VALPARAISO", { x: 47, y: 823, size: 8, font });
  page.drawText("Bill of Lading", { x: 263, y: 823, size: 12, font: bold });
  label("Carrier's Reference:", 309, 763);
  label("B/L-No.:", 381, 763);
  label("Page:", 517, 763);
  value(spec.number, 381, 763, 418);
  if (spec.referenceUnderNumber) label("REFERENCE NO.", 381, 754);
  label("Shipper:", 47, 810);
  page.drawText("NINGBO LINGNAN HYDROCOLLOIDS CO., LTD.", { x: 49, y: 798, size: 8, font: typed });
  label("Consignee:", 47, 726);
  page.drawText("ACME IMPORTS SPA", { x: 49, y: 714, size: 8, font: typed });
  label("Vessel(s):", 47, 558);
  label("Voyage-No.:", 249, 558);
  value("AUSTRAL TRAIGUEN", 47, 558, 92);
  value("2641W", 249, 558, 295);
  label("Port of Loading:", 47, 522);
  value(spec.portOfLoading, 47, 522, 112);
  label("Port of Discharge:", 47, 498);
  value(spec.portOfDischarge, 47, 498, 118);
  label("Place of Receipt:", 308, 618);
  label("Place of Delivery:", 308, 546);
  const received = [
    "RECEIVED by the Carrier from the Shipper in apparent good order and condition the goods",
    "for carriage subject to all the terms hereof from the Place of Receipt or the Port of Loading,",
    "whichever is applicable, to the Port of Discharge or the Place of Delivery, whichever applies.",
  ];
  received.forEach((t, i) => page.drawText(t, { x: 308, y: 240 - i * 7, size: 5, font }));
  label("Place and date of issue:", 308, 138);
  if (spec.onBoardDate !== undefined) {
    value(`NINGBO, ${spec.onBoardDate}`, 308, 138, 402);
    if (spec.values === "inline") page.drawText(`SHIPPED ON BOARD: ${spec.onBoardDate}`, { x: 310, y: 92, size: 9, font: typed });
    else {
      page.drawText("SHIPPED ON BOARD", { x: 310, y: 96, size: 9, font: typed });
      page.drawText(spec.onBoardDate, { x: 310, y: 85, size: 9, font: typed });
    }
  }
  // Box guides in a 2 pt font, as some forms draw them: hidden, but no letter or digit
  page.drawText(".......", { x: 47, y: 470, size: 2, font });
  return doc.save();
}

// A proforma invoice as an exporter sends it before the order (T3.9). Fictitious companies.
export interface ProformaSpec {
  number: string;
  date: string;
  currency: string;
  terms: string;
  items: { description: string; hs: string; qty: number; unitPrice: string; amount: string }[];
  total: string;
  shipment: string;
  payment: string;
  bankLines?: string[];
  notes?: string[];
  extra?: ExtraText[];
}

export async function renderProforma(spec: ProformaSpec): Promise<Uint8Array> {
  return render(
    { company: "NINGBO LINGNAN HYDROCOLLOIDS CO., LTD.", title: "PROFORMA INVOICE" },
    [
      `Proforma No.: ${spec.number}`,
      `Date: ${spec.date}`,
      "Buyer: ACME IMPORTS SPA, SANTIAGO, CHILE",
      `Terms of Delivery: ${spec.terms}`,
      ...spec.items.map((i) => `${i.description}  ${i.qty} PCS  ${spec.currency} ${i.unitPrice}  ${spec.currency} ${i.amount}  HS Code: ${i.hs}`),
      `TOTAL AMOUNT: ${spec.currency} ${spec.total}`,
      `Latest Shipment: ${spec.shipment}`,
      `Payment: ${spec.payment}`,
      ...(spec.bankLines ?? []),
      ...(spec.notes ?? []),
    ],
    spec.extra,
  );
}
