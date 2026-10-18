import type { TextRun } from "./text";

export const HIDDEN_REASONS = [
  "invisible_mode",
  "hidden_layer",
  "annotation",
  "tiny_font",
  "squeezed",
  "off_page",
  "transparent",
  "background_color",
] as const;
export type HiddenReason = (typeof HIDDEN_REASONS)[number];

export const MIN_VISIBLE_FONT_PT = 4;
const MIN_VISIBLE_ALPHA = 0.1;
// Relative luminance above this is treated as white on the (assumed white) page
const BACKGROUND_LUMINANCE = 0.92;

function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Why a run would not be seen by a person reading the invoice, or null if it is visible.
// Text drawn by an annotation is treated as hidden: the payment fields must come from the
// page content, and annotations are a known place to tuck content away.
export function hiddenReason(run: TextRun): HiddenReason | null {
  const mode = run.renderMode;
  if (mode === 3 || mode === 7) return "invisible_mode";
  if (run.hiddenLayer) return "hidden_layer";
  if (run.annotation) return "annotation";
  if (run.size < MIN_VISIBLE_FONT_PT) return "tiny_font";
  if (run.width < MIN_VISIBLE_FONT_PT / 2) return "squeezed";
  const [x0, y0, x1, y1] = run.pageBox;
  if (run.x < x0 || run.x >= x1 || run.y < y0 || run.y >= y1) return "off_page";

  // Modes 0, 2, 4, 6 fill the glyphs; 1, 2, 5, 6 stroke them
  const painted: { color: [number, number, number]; alpha: number }[] = [];
  if ([0, 2, 4, 6].includes(mode)) painted.push({ color: run.fill, alpha: run.fillAlpha });
  if ([1, 2, 5, 6].includes(mode)) painted.push({ color: run.stroke, alpha: run.strokeAlpha });
  const opaque = painted.filter((p) => p.alpha >= MIN_VISIBLE_ALPHA);
  if (opaque.length === 0) return "transparent";
  if (opaque.every((p) => luminance(p.color) > BACKGROUND_LUMINANCE)) return "background_color";
  return null;
}

export interface VisibilitySplit {
  visible: TextRun[];
  hidden: { run: TextRun; reason: HiddenReason }[];
}

// A hidden run without a letter or a digit is dropped, not reported: it cannot carry an
// instruction, an amount or a destination, and real forms draw boxes and rules that way
// (the "○○○○" guides of the SHUBIL form are in a 2 pt font).
const CARRIES_TEXT = /[\p{L}\p{N}]/u;

export function splitByVisibility(runs: TextRun[]): VisibilitySplit {
  const split: VisibilitySplit = { visible: [], hidden: [] };
  for (const run of runs) {
    const reason = hiddenReason(run);
    if (reason === null) split.visible.push(run);
    else if (CARRIES_TEXT.test(run.text)) split.hidden.push({ run, reason });
  }
  return split;
}
