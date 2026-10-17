// Document ingestion. Owned by Area 3. Keel Personal: invoices by email. Keel Trade: the
// transport document and the commercial invoice of an order, uploaded by a party.
export {
  COMPARED_FIELDS,
  compareReadings,
  readInvoice,
  type ComparedField,
  type FieldDiff,
  type InvoiceReading,
} from "./agreement";
export {
  CHANGE_TRIGGERS,
  detectBeneficiaryChange,
  type ChangeRequest,
  type ChangeTrigger,
} from "./beneficiaryChange";
export {
  AUTH_FAILURES,
  authenticateEmail,
  type AuthFailure,
  type AuthSummary,
  type EmailAuthResult,
  type Envelope,
} from "./email/auth";
export { MIME_FAILURES, type MimeFailure } from "./email/mime";
export { receiveEmail, type EmailOutcome, type QuarantineReason } from "./email/receive";
export { createHandler, ServerConfigError, startServer, type LogEntry, type ProformaLogEntry, type TradeLogEntry } from "./server";
export {
  BotConfigError,
  botNotifierFromEnv,
  createBotNotifier,
  scheduleChangeDigest,
  type BotLogEntry,
  type BotNotifier,
  type BotPayload,
} from "./botNotifier";
export {
  IngestSettings,
  KEY_ENV,
  SettingsError,
  SettingsStore,
  type SettingsAudit,
  type StoredSettings,
} from "./settings";
export {
  CHANGE_COOLDOWN_DAYS,
  CHANGE_RESOLUTIONS,
  IngestStore,
  MAX_DOCUMENTS_PER_ORDER_PER_DAY,
  MAX_EMAILS_PER_SENDER_PER_DAY,
  type ChangeResolution,
  type StoredChangeRequest,
  type TradePackage,
} from "./store";
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
  extractCommercialInvoice,
  extractInvoice,
  extractTransportDocument,
  PROVIDERS,
  type ExtractionFailure,
  type ExtractorConfig,
  type ExtractorProvider,
  type ExtractionRequest,
  type ProviderName,
} from "./extractor";
export {
  ALERT_REMINDER,
  ALERT_TRIGGERS,
  detectAccountAlert,
  type AccountAlert,
  type AlertTrigger,
} from "./trade/accountAlert";
export {
  compareCommercialInvoice,
  compareTransport,
  INVOICE_COMPARED_FIELDS,
  readCommercialInvoice,
  readTransportDocument,
  TRANSPORT_COMPARED_FIELDS,
  type CommercialInvoiceReading,
  type TradeFieldDiff,
  type TransportReading,
} from "./trade/agreement";
export { amountToMinor, findDate, normalizeDocumentNumber, normalizeHsCode, normalizeReference, resolvePlace } from "./trade/normalize";
export {
  findTradeDestinations,
  parseCommercialInvoice,
  parseTransportDocument,
  TRADE_PARSE_FAILURES,
  TradeParseError,
  type TradeParseFailure,
} from "./trade/parser";
export { receiveTradeDocument, type TradeOutcome, type TradeQuarantineReason } from "./trade/receive";
export {
  MAX_PROFORMAS_PER_IMPORTER_PER_DAY,
  PROFORMA_REJECTIONS,
  PROFORMA_TYPES,
  receiveProforma,
  sniffMediaType,
  staticImporters,
  type ImporterRegistry,
  type ProformaOutcome,
  type ProformaRejection,
} from "./trade/proforma";
export { extractProforma, MAX_IMAGE_BYTES, MIN_PROFORMA_TEXT_CHARS, type ProformaExtraction } from "./extractor";
export { missingFields, PROFORMA_FIELDS, type ProformaReading } from "./extractor/proforma";
export {
  authorizeUpload,
  fileHash,
  staticOrders,
  UPLOAD_MAX_SKEW_SECONDS,
  UPLOAD_REJECTIONS,
  UPLOAD_TYPES,
  uploadDomain,
  type DocumentUpload,
  type OrderRegistry,
  type TradeOrderEntry,
  type UploadRejection,
} from "./trade/upload";
