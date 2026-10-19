// Pulls the single invoice PDF out of a raw MIME message.
import { simpleParser } from "mailparser";

export const MAX_EMAIL_BYTES = 15 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;

export const MIME_FAILURES = ["too_large", "unparseable", "too_many_attachments", "no_pdf", "multiple_pdfs"] as const;
export type MimeFailure = (typeof MIME_FAILURES)[number];

export class MimeError extends Error {
  constructor(
    readonly reason: MimeFailure,
    options?: { cause?: unknown },
  ) {
    super(reason, options);
    this.name = "MimeError";
  }
}

// Identified by content, not by the declared type or file name, which the sender controls
const isPdf = (bytes: Buffer) => bytes.subarray(0, 1024).includes("%PDF-");

// Exactly one PDF, or the message is quarantined: with two, which one would be paid?
export async function extractInvoicePdf(raw: Buffer): Promise<Uint8Array> {
  if (raw.byteLength > MAX_EMAIL_BYTES) throw new MimeError("too_large");
  let attachments: { content: Buffer }[];
  try {
    attachments = (await simpleParser(raw, { skipHtmlToText: true, skipTextToHtml: true, skipTextLinks: true }))
      .attachments;
  } catch (e) {
    throw new MimeError("unparseable", { cause: e });
  }
  if (attachments.length > MAX_ATTACHMENTS) throw new MimeError("too_many_attachments");
  const pdfs = attachments.filter((a) => isPdf(a.content));
  if (pdfs.length === 0) throw new MimeError("no_pdf");
  if (pdfs.length > 1) throw new MimeError("multiple_pdfs");
  return new Uint8Array(pdfs[0]!.content);
}
