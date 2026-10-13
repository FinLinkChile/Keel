// Invoice ingestion. Owned by Area 3.
export { invoiceKey } from "./invoiceKey";
export {
  foldHomoglyphs,
  NormalizationError,
  normalizeInvoiceNumber,
  normalizePeriod,
  normalizeRut,
} from "./normalize";
export {
  findPaymentDestinations,
  mentionsAccountChange,
  parseInvoice,
  ParseError,
  PARSE_FAILURES,
  type AliasEntry,
  type AliasTable,
  type ParsedInvoice,
  type ParseFailure,
  type PaymentDestination,
} from "./parser";
export { HIDDEN_REASONS, type HiddenReason } from "./pdf/hidden";
export { PII_PATTERNS, transferLog } from "./privacy";
export {
  configFromEnv,
  createExtractor,
  EXTRACTION_FAILURES,
  ExtractionError,
  ExtractorConfigError,
  extractInvoice,
  PROVIDERS,
  type ExtractionFailure,
  type ExtractorConfig,
  type ExtractorProvider,
  type ProviderName,
} from "./extractor";
