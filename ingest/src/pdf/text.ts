/// <reference path="./pdfjs-worker.d.ts" />
// Reads every text run of a PDF with the attributes needed to tell visible from hidden
// text. Walks the pdf.js operator list instead of getTextContent, which drops color,
// opacity, layers and rendering mode.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
// Without a worker thread pdf.js loads ./pdf.worker.mjs next to itself, a file a bundle (the AWS
// Lambdas) does not have: every PDF then fails as unreadable. The worker module imported here
// is the one pdf.js uses in this thread instead.
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";

(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker ??= pdfjsWorker;

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_PAGES = 20;

// The PDF standard lets the %PDF- header appear anywhere in the first 1024 bytes, and some
// scanners write bytes before it. -1 when there is no header.
export const PDF_HEADER_WINDOW = 1024;
const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d];
export function pdfHeaderOffset(file: Uint8Array): number {
  const last = Math.min(PDF_HEADER_WINDOW, file.length) - PDF_HEADER.length;
  for (let i = 0; i <= last; i++) if (PDF_HEADER.every((b, j) => file[i + j] === b)) return i;
  return -1;
}

export const PDF_READ_FAILURES = ["too_large", "too_many_pages", "unreadable"] as const;
export type PdfReadFailure = (typeof PDF_READ_FAILURES)[number];

export class PdfReadError extends Error {
  constructor(
    readonly reason: PdfReadFailure,
    options?: { cause?: unknown },
  ) {
    super(reason, options);
    this.name = "PdfReadError";
  }
}

type RGB = [number, number, number];

export interface TextRun {
  page: number;
  text: string;
  // Page coordinates of the run start, origin at the bottom left of the page box
  x: number;
  y: number;
  // Effective glyph height and width scale in points, after every matrix and Tz
  size: number;
  width: number;
  // Length of the run along the baseline in points, from the glyph advances
  length: number;
  fill: RGB;
  stroke: RGB;
  fillAlpha: number;
  strokeAlpha: number;
  // PDF text rendering mode 0..7
  renderMode: number;
  // Inside optional content (a layer) that is off by default
  hiddenLayer: boolean;
  // Drawn by an annotation appearance, not by the page content
  annotation: boolean;
  // Page box [x0, y0, x1, y1]
  pageBox: [number, number, number, number];
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

// m1 then m2 (PDF row-vector convention)
function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}

function toMatrix(raw: unknown): Matrix {
  const v = raw as ArrayLike<number>;
  return [v[0]!, v[1]!, v[2]!, v[3]!, v[4]!, v[5]!];
}

function parseHex(hex: unknown): RGB {
  if (typeof hex === "string" && /^#[0-9a-f]{6}$/i.test(hex)) {
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as RGB;
  }
  return [0, 0, 0];
}

interface Glyph {
  unicode?: string;
  width?: number;
}

interface GraphicsState {
  ctm: Matrix;
  fill: RGB;
  stroke: RGB;
  fillAlpha: number;
  strokeAlpha: number;
  renderMode: number;
  fontSize: number;
  leading: number;
  // Tz, as a fraction (1 = 100 %)
  hScale: number;
}

const INITIAL_STATE: GraphicsState = {
  ctm: IDENTITY,
  fill: [0, 0, 0],
  stroke: [0, 0, 0],
  fillAlpha: 1,
  strokeAlpha: 1,
  renderMode: 0,
  fontSize: 0,
  leading: 0,
  hScale: 1,
};

const OPS = pdfjs.OPS;

interface VisibilityConfig {
  isVisible(group: unknown): boolean;
}

function walkPage(
  pageNumber: number,
  pageBox: [number, number, number, number],
  fnArray: number[],
  argsArray: unknown[],
  layers: VisibilityConfig,
  runs: TextRun[],
): void {
  let gs: GraphicsState = { ...INITIAL_STATE };
  const stack: GraphicsState[] = [];
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  // One entry per open marked-content section: false when it is an off layer
  const marked: boolean[] = [];
  let annotationDepth = 0;

  const moveText = (tx: number, ty: number) => {
    tlm = multiply([1, 0, 0, 1, tx, ty], tlm);
    tm = tlm;
  };

  const show = (items: unknown[]) => {
    const m = multiply(tm, gs.ctm);
    let text = "";
    let advance = 0;
    for (const item of items) {
      if (typeof item === "number") {
        advance -= (item / 1000) * gs.fontSize * gs.hScale;
      } else if (item && typeof item === "object") {
        const glyph = item as Glyph;
        text += glyph.unicode ?? "";
        advance += ((glyph.width ?? 0) / 1000) * gs.fontSize * gs.hScale;
      }
    }
    if (text.length > 0) {
      const fontSize = Math.abs(gs.fontSize);
      runs.push({
        page: pageNumber,
        text,
        x: m[4],
        y: m[5],
        size: fontSize * Math.hypot(m[2], m[3]),
        width: fontSize * Math.hypot(m[0], m[1]) * Math.abs(gs.hScale),
        length: Math.abs(advance) * Math.hypot(m[0], m[1]),
        fill: gs.fill,
        stroke: gs.stroke,
        fillAlpha: gs.fillAlpha,
        strokeAlpha: gs.strokeAlpha,
        renderMode: gs.renderMode,
        hiddenLayer: marked.includes(false),
        annotation: annotationDepth > 0,
        pageBox,
      });
    }
    tm = multiply([1, 0, 0, 1, advance, 0], tm);
  };

  for (let i = 0; i < fnArray.length; i++) {
    const args = (argsArray[i] ?? []) as unknown[];
    switch (fnArray[i]) {
      case OPS.save:
        stack.push({ ...gs });
        break;
      case OPS.restore:
        gs = stack.pop() ?? gs;
        break;
      case OPS.transform:
        gs.ctm = multiply(toMatrix(args), gs.ctm);
        break;
      case OPS.paintFormXObjectBegin:
        stack.push({ ...gs });
        if (args[0]) gs.ctm = multiply(toMatrix(args[0]), gs.ctm);
        break;
      case OPS.paintFormXObjectEnd:
        gs = stack.pop() ?? gs;
        break;
      case OPS.beginAnnotation:
        annotationDepth++;
        break;
      case OPS.endAnnotation:
        annotationDepth = Math.max(0, annotationDepth - 1);
        break;
      case OPS.beginMarkedContent:
        marked.push(true);
        break;
      case OPS.beginMarkedContentProps:
        marked.push(args[0] === "OC" && args[1] ? layers.isVisible(args[1]) : true);
        break;
      case OPS.endMarkedContent:
        marked.pop();
        break;
      case OPS.setGState:
        for (const entry of (args[0] ?? []) as [string, unknown][]) {
          if (entry[0] === "ca") gs.fillAlpha = Number(entry[1]);
          if (entry[0] === "CA") gs.strokeAlpha = Number(entry[1]);
        }
        break;
      case OPS.beginText:
        tm = IDENTITY;
        tlm = IDENTITY;
        break;
      case OPS.setFont:
        gs.fontSize = Number(args[1]);
        break;
      case OPS.setLeading:
        gs.leading = Number(args[0]);
        break;
      case OPS.setHScale:
        gs.hScale = Number(args[0]) / 100;
        break;
      case OPS.setTextMatrix:
        tlm = toMatrix(args.length === 6 ? args : args[0]);
        tm = tlm;
        break;
      case OPS.moveText:
        moveText(Number(args[0]), Number(args[1]));
        break;
      case OPS.setLeadingMoveText:
        gs.leading = -Number(args[1]);
        moveText(Number(args[0]), Number(args[1]));
        break;
      case OPS.nextLine:
        moveText(0, -gs.leading);
        break;
      case OPS.setTextRenderingMode:
        gs.renderMode = Number(args[0]);
        break;
      case OPS.setFillRGBColor:
        gs.fill = parseHex(args[0]);
        break;
      case OPS.setStrokeRGBColor:
        gs.stroke = parseHex(args[0]);
        break;
      case OPS.showText:
      case OPS.showSpacedText:
        show(args[0] as unknown[]);
        break;
      case OPS.nextLineShowText:
        moveText(0, -gs.leading);
        show(args[0] as unknown[]);
        break;
      case OPS.nextLineSetSpacingShowText:
        moveText(0, -gs.leading);
        show(args[2] as unknown[]);
        break;
    }
  }
}

// Throws PdfReadError for oversized, encrypted or malformed input: callers hold the invoice.
export async function readTextRuns(pdf: Uint8Array): Promise<TextRun[]> {
  if (pdf.byteLength > MAX_PDF_BYTES) throw new PdfReadError("too_large");
  // pdf.js takes ownership of the buffer, so it gets a copy
  const task = pdfjs.getDocument({ data: pdf.slice(), verbosity: 0, disableFontFace: true, useSystemFonts: false });
  const runs: TextRun[] = [];
  try {
    const doc = await task.promise;
    if (doc.numPages > MAX_PDF_PAGES) throw new PdfReadError("too_many_pages");
    const layers: VisibilityConfig = await doc.getOptionalContentConfig();
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const { fnArray, argsArray } = await page.getOperatorList();
      walkPage(pageNumber, page.view as [number, number, number, number], fnArray, argsArray, layers, runs);
      page.cleanup();
    }
  } catch (e) {
    if (e instanceof PdfReadError) throw e;
    throw new PdfReadError("unreadable", { cause: e });
  } finally {
    await task.destroy();
  }
  return runs;
}

// One run of a line with where it starts and ends, so a reader can tell the boxes of a form apart
export interface LayoutCell {
  x: number;
  x1: number;
  text: string;
}

export interface LayoutLine {
  page: number;
  y: number;
  // Largest glyph height on the line
  size: number;
  cells: LayoutCell[];
}

// Groups runs into reading-order lines: top to bottom, then left to right. Blank runs are dropped.
export function toLayoutLines(runs: TextRun[]): LayoutLine[] {
  const sorted = [...runs].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const lines: { page: number; y: number; runs: TextRun[] }[] = [];
  for (const run of sorted) {
    const last = lines[lines.length - 1];
    if (last && last.page === run.page && Math.abs(last.y - run.y) <= Math.max(2, run.size * 0.4)) {
      last.runs.push(run);
    } else {
      lines.push({ page: run.page, y: run.y, runs: [run] });
    }
  }
  return lines
    .map((line) => ({
      page: line.page,
      y: line.y,
      size: Math.max(...line.runs.map((r) => r.size)),
      cells: line.runs
        .sort((a, b) => a.x - b.x)
        .map((r) => ({ x: r.x, x1: r.x + r.length, text: r.text.replace(/\s+/g, " ").trim() }))
        .filter((c) => c.text.length > 0),
    }))
    .filter((l) => l.cells.length > 0);
}

export const lineText = (line: LayoutLine): string => line.cells.map((c) => c.text).join(" ");

export function toLines(runs: TextRun[]): string[] {
  return toLayoutLines(runs).map(lineText);
}
