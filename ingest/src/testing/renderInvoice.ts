// Renders synthetic Chilean DTE-style invoices for tests and the corpus (T3.8).
import {
  PDFDocument,
  PDFName,
  PDFOperator,
  StandardFonts,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setCharacterSqueeze,
  setStrokingRgbColor,
  setTextRenderingMode,
  type PDFPage,
} from "pdf-lib";

// Ways to hide a run from a person while keeping it in the content stream
export type HideTechnique = "transparent" | "white_stroke" | "squeezed" | "hidden_layer";

export interface ExtraText {
  text: string;
  x: number;
  y: number;
  size?: number;
  // 0..1 per channel
  color?: [number, number, number];
  hide?: HideTechnique;
}

function hiddenLayerName(doc: PDFDocument, page: PDFPage): PDFName {
  const ocg = doc.context.register(doc.context.obj({ Type: "OCG", Name: "hidden" }));
  doc.catalog.set(PDFName.of("OCProperties"), doc.context.obj({ OCGs: [ocg], D: { OFF: [ocg] } }));
  page.node.Resources()!.set(PDFName.of("Properties"), doc.context.obj({ oc1: ocg }));
  return PDFName.of("oc1");
}

export interface InvoiceSpec {
  issuerName: string;
  issuerRut: string;
  folio: string;
  issueDate: string;
  dueDate: string;
  period?: string;
  receptorName: string;
  receptorRut: string;
  items: { description: string; amount: number }[];
  // Overrides the computed total line, to build inconsistent invoices
  totalLines?: string[];
  bankLines?: string[];
  notes?: string[];
  extra?: ExtraText[];
}

const clp = (n: number) => "$ " + n.toLocaleString("es-CL").replace(/,/g, ".");

export async function renderInvoice(spec: InvoiceSpec): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const red = rgb(0.8, 0, 0);

  page.drawText(spec.issuerName, { x: 40, y: 790, size: 13, font: bold });
  page.drawRectangle({ x: 370, y: 730, width: 185, height: 80, borderColor: red, borderWidth: 2 });
  page.drawText(`R.U.T.: ${spec.issuerRut}`, { x: 385, y: 790, size: 11, font: bold, color: red });
  page.drawText("FACTURA ELECTRONICA", { x: 385, y: 770, size: 11, font: bold, color: red });
  page.drawText(`N° ${spec.folio}`, { x: 385, y: 750, size: 11, font: bold, color: red });

  let y = 690;
  const line = (text: string, size = 10, f = font) => {
    page.drawText(text, { x: 40, y, size, font: f });
    y -= size + 8;
  };
  line(`Fecha Emision: ${spec.issueDate}`);
  if (spec.period) line(`Periodo: ${spec.period}`);
  line(`Fecha Vencimiento: ${spec.dueDate}`);
  line(`Senor(es): ${spec.receptorName}`);
  line(`RUT: ${spec.receptorRut}`);
  y -= 10;
  line("DETALLE", 10, bold);
  let neto = 0;
  for (const item of spec.items) {
    page.drawText(item.description, { x: 40, y, size: 10, font });
    page.drawText(clp(item.amount), { x: 450, y, size: 10, font });
    neto += item.amount;
    y -= 18;
  }
  y -= 10;
  const iva = Math.round(neto * 0.19);
  line(`MONTO NETO ${clp(neto)}`);
  line(`IVA 19% ${clp(iva)}`);
  for (const t of spec.totalLines ?? [`TOTAL ${clp(neto + iva)}`]) line(t, 12, bold);
  y -= 10;
  for (const b of spec.bankLines ?? []) line(b);
  for (const n of spec.notes ?? []) line(n);

  for (const e of spec.extra ?? []) {
    const [r, g, b] = e.color ?? [0, 0, 0];
    const draw = () =>
      page.drawText(e.text, {
        x: e.x,
        y: e.y,
        size: e.size ?? 10,
        font,
        color: rgb(r, g, b),
        opacity: e.hide === "transparent" ? 0 : 1,
      });
    if (e.hide === "white_stroke") {
      page.pushOperators(pushGraphicsState(), setTextRenderingMode(1), setStrokingRgbColor(1, 1, 1));
      draw();
      page.pushOperators(popGraphicsState());
    } else if (e.hide === "squeezed") {
      page.pushOperators(pushGraphicsState(), setCharacterSqueeze(1));
      draw();
      page.pushOperators(popGraphicsState());
    } else if (e.hide === "hidden_layer") {
      page.pushOperators(PDFOperator.of("BDC" as never, [PDFName.of("OC"), hiddenLayerName(doc, page)]));
      draw();
      page.pushOperators(PDFOperator.of("EMC" as never));
    } else {
      draw();
    }
  }
  return doc.save();
}

// A legitimate customs agent invoice: total 45.990 = 38.647 + 7.343 IVA
export const sampleSpec = (): InvoiceSpec => ({
  issuerName: "AGENCIA DE ADUANAS PEREZ Y CIA LTDA",
  issuerRut: "76.123.456-0",
  folio: "4521",
  issueDate: "05-10-2026",
  dueDate: "20-10-2026",
  period: "10/2026",
  receptorName: "IMPORTADORA LOS ANDES SPA",
  receptorRut: "12.345.678-5",
  items: [{ description: "Honorarios despacho DIN 1234567", amount: 38647 }],
  bankLines: ["Datos para transferencia: Banco Estado Cuenta Corriente N° 123456789"],
});
