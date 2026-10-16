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
}

export async function renderTransport(spec: TransportSpec): Promise<Uint8Array> {
  const notes = spec.notes ?? [];
  if (spec.layout === "oceanlink") {
    return render(
      { company: "OCEANLINK SHIPPING CO., LTD.", title: spec.title ?? "BILL OF LADING" },
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
        "Signed for the carrier OCEANLINK SHIPPING CO., LTD. as carrier",
      ],
      spec.extra,
      spec.seed,
    );
  }
  if (spec.layout === "pacific") {
    return render(
      { company: "PACIFIC STAR LINES", title: spec.title ?? "BILL OF LADING FOR OCEAN TRANSPORT" },
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
    { company: "SKYBRIDGE CARGO AIRLINES", title: spec.title ?? "AIR WAYBILL" },
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
  items: { description: string; hs: string; qty: number; unitPrice: string; amount: string }[];
  // Overrides the computed total line(s)
  totalLines?: string[];
  bankLines?: string[];
  notes?: string[];
  extra?: ExtraText[];
  seed?: string;
}

export async function renderCommercialInvoice(spec: CommercialInvoiceSpec): Promise<Uint8Array> {
  const items = spec.items.map(
    (i) => `${i.description}  ${i.qty} PCS  ${spec.currency} ${i.unitPrice}  ${spec.currency} ${i.amount}  HS Code: ${i.hs}`,
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
