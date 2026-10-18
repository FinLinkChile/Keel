// Personal data never reaches the LLM. Built on privacy-kit-cl (Ley 21.719):
// every match below is replaced by a token before the text leaves Keel, and only the
// fields the extractor returns are rehydrated, inside Keel.
import { randomBytes } from "node:crypto";
import { PrivacyKit, type RedactionResult } from "privacy-kit-cl";

// Applied in order. Label-based patterns go first so a whole line is masked once.
// Destinations (accounts, wallets) are masked too: the model never sees an attacker's address.
// The English labels and the IBAN cover the trade documents (bill of lading, commercial invoice).
export const PII_PATTERNS: Record<string, string> = {
  nombre: String.raw`(?<=(?i:se[ñn]or(?:\(es\))?|raz[oó]n\s+social|cliente|receptor|shipper|consignee|notify\s+party|buyer|seller|sold\s+to|bill\s+to|messrs\.?)\s*:\s*)\S[^\n]*`,
  direccion: String.raw`(?<=(?i:direcci[oó]n|domicilio|address)\s*:\s*)\S[^\n]*`,
  email: String.raw`\b[\w.+-]+@[\w-]+\.[\w.-]+\b`,
  wallet: String.raw`\b0[xX][0-9a-fA-F]{40}\b`,
  cuenta: String.raw`(?<=(?i:cuenta\s+(?:corriente|vista|rut|de\s+ahorro)|cta\.?\s*(?:cte|vista)\.?|n[°º]?\s*(?:de\s+)?cuenta|account\s*(?:no\.?|number)?|a\/c\s*(?:no\.?)?)\s*:?\s*(?:(?i:n)[°º]\s*)?)[0-9][0-9\- ]{4,22}[0-9]`,
  iban: String.raw`\b[A-Z]{2}[0-9]{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,4})?\b`,
  rut: String.raw`\b\d{1,2}\.?\d{3}\.?\d{3}\s*-\s*[\dkK]\b`,
  telefono: String.raw`(?:\+?56)?\s?9\s?\d{4}\s?\d{4}\b`,
  tarjeta: String.raw`\b(?:\d[ -]?){13,19}\b`,
};

// analisis_compras: the analyst gets aggregated metrics of the company's orders, no document
export const LLM_PURPOSES = ["extraccion_factura", "extraccion_documento_comercio", "extraccion_proforma", "analisis_compras"] as const;
export type LlmPurpose = (typeof LLM_PURPOSES)[number];

const kit = PrivacyKit.fromObject({
  piiPatterns: PII_PATTERNS,
  purposes: Object.fromEntries(LLM_PURPOSES.map((p) => [p, { legalBasis: "contrato" }])),
  thirdParties: {
    anthropic: { pais: "US", rol: "encargado", base: "contrato" },
    // Claude through a third-party proxy (LiteLLM): its operator receives the redacted text too
    "anthropic-proxy": { pais: "?", rol: "encargado", base: "contrato" },
    openai: { pais: "US", rol: "encargado", base: "contrato" },
    gemini: { pais: "US", rol: "encargado", base: "contrato" },
    "openai-compatible": { pais: "?", rol: "encargado", base: "contrato" },
  },
});

// A fresh random salt per call. privacy-kit-cl derives tokens as sha256(salt:value), and a
// RUT has about 10^8 values: with a fixed salt a provider could brute-force every token.
export function redactForLlm(text: string): RedactionResult {
  return kit.redaction.redact(text, randomBytes(16).toString("hex"));
}

export function rehydrate(value: string, tokenMap: Record<string, string>): string {
  return kit.redaction.rehydrate(value, tokenMap);
}

// Sending a document to an LLM vendor is a transfer to a third party (Ley 21.719).
export function logTransfer(
  provider: string,
  categories: string[],
  purpose: LlmPurpose = "extraccion_factura",
  subjectId = "owner",
): void {
  kit.transfers.log(subjectId, provider, purpose, categories);
}

export function transferLog(): Record<string, unknown>[] {
  return kit.store.find("privacy_transfers", {});
}
