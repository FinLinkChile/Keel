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
export { MAX_EMAIL_BYTES, MIME_FAILURES, type MimeFailure } from "./email/mime";
export { MAX_PDF_BYTES } from "./pdf/text";
export { receiveEmail, type EmailOutcome, type QuarantineReason } from "./email/receive";
export {
  ACTOR_RE,
  AliasTableSchema,
  createHandler,
  MAX_ADMIN_BODY_BYTES,
  MAX_TRADE_BODY_BYTES,
  MIN_TOKEN_LENGTH,
  PROFORMA_REJECTION_STATUS,
  ProformaUploadBody,
  ServerConfigError,
  startServer,
  TRADE_REJECTION_STATUS,
  TradeOrderEntrySchema,
  TradeUploadBody,
  type LogEntry,
  type ProformaLogEntry,
  type TradeLogEntry,
} from "./server";
export {
  BotConfigError,
  botNotifierFromEnv,
  changeDigestPayload,
  createBotNotifier,
  scheduleChangeDigest,
  type BotLogEntry,
  type BotNotifier,
  type BotPayload,
} from "./botNotifier";
export {
  baseUrlsFromEnv,
  fileSettingsBackend,
  IngestSettings,
  initialSettings,
  KEY_ENV,
  keysFromEnv,
  SettingsChange,
  SettingsError,
  SettingsStore,
  type ApiKeys,
  type BaseUrls,
  type SettingsAudit,
  type SettingsBackend,
  type StoredSettings,
} from "./settings";
export {
  CHANGE_COOLDOWN_DAYS,
  CHANGE_RESOLUTIONS,
  DAY_MS,
  MAX_DOCUMENTS_PER_ORDER_PER_DAY,
  MAX_EMAILS_PER_SENDER_PER_DAY,
  packageFrom,
  READ_EXTRACTOR_FAILED,
  utcDay,
  type AcceptedDocument,
  type ChangeResolution,
  type IngestRepo,
  type StoredChangeRequest,
  type StoredDocument,
  type StoredUpload,
  type TradePackage,
  type UploadAdmission,
  type UploadEntry,
} from "./repo";
export { IngestStore } from "./store";
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
export { LLM_PURPOSES, PII_PATTERNS, transferLog } from "./privacy";
export {
  configFromEnv,
  createExtractor,
  EXTRACTION_FAILURES,
  ExtractionError,
  ExtractorConfigError,
  LLM_TIMEOUT_MS,
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
export {
  admitTradeUpload,
  readTradeDocument,
  receivedOf,
  receiveTradeDocument,
  type Received,
  type TradeOutcome,
  type TradeQuarantineReason,
} from "./trade/receive";
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
  authorizeDeclaredUpload,
  authorizeUpload,
  fileHash,
  staticOrders,
  UPLOAD_MAX_SKEW_SECONDS,
  UPLOAD_REJECTIONS,
  UPLOAD_TYPES,
  uploadDomain,
  type DeclaredUpload,
  type DocumentUpload,
  type OrderRegistry,
  type Party,
  type TradeOrderEntry,
  type UploadRejection,
} from "./trade/upload";
export {
  INSIGHTS_REJECTION_STATUS,
  INSIGHTS_TYPES,
  InsightsBody,
  inputHash as insightsInputHash,
  MAX_INPUT_BYTES as MAX_INSIGHTS_INPUT_BYTES,
  receiveInsights,
  type InsightsOutcome,
} from "./trade/insights";
