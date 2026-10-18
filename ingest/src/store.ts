// Ingest state for flood protection and deduplication. T3.2, issue #19.
// node:sqlite, so there is no extra dependency. Stores hashes, domains, aliases and change
// requests; never email bodies or invoice text.
import { DatabaseSync } from "node:sqlite";
import type { AliasId, Hex, RequiredDocType } from "@keel/schemas";
import { docsHash } from "@keel/schemas/hash";
import type { ChangeRequest } from "./beneficiaryChange";
import type { AccountAlert } from "./trade/accountAlert";

export const MAX_EMAILS_PER_SENDER_PER_DAY = 20;
// Keel Trade: authorized uploads per order in 24 hours. A legitimate order needs two or three.
export const MAX_DOCUMENTS_PER_ORDER_PER_DAY = 10;
export const CHANGE_COOLDOWN_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export const CHANGE_RESOLUTIONS = ["approved", "rejected", "vetoed"] as const;
export type ChangeResolution = (typeof CHANGE_RESOLUTIONS)[number];

export interface StoredChangeRequest extends ChangeRequest {
  id: number;
  status: "pending" | ChangeResolution;
  resolvedAt?: string;
}

export class IngestStore {
  private readonly db: DatabaseSync;

  // ":memory:" loses deduplication on restart: use a file outside tests
  constructor(
    path: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS emails (
        message_hash TEXT PRIMARY KEY,
        from_domain  TEXT NOT NULL,
        received_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS emails_by_sender ON emails (from_domain, received_at);
      CREATE TABLE IF NOT EXISTS invoices (
        invoice_key  TEXT PRIMARY KEY,
        message_hash TEXT NOT NULL,
        received_at  INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS change_requests (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        alias_id    TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'pending',
        created_at  INTEGER NOT NULL,
        resolved_at INTEGER,
        body        TEXT NOT NULL
      );
      -- At most one pending request per alias, enforced by the database itself
      CREATE UNIQUE INDEX IF NOT EXISTS one_pending_per_alias
        ON change_requests (alias_id) WHERE status = 'pending';

      -- Keel Trade. Every authorized upload, read or not: who uploaded which file to which order
      CREATE TABLE IF NOT EXISTS trade_uploads (
        order_id    TEXT NOT NULL,
        file_hash   TEXT NOT NULL,
        doc_type    TEXT NOT NULL,
        uploader    TEXT NOT NULL,
        party       TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        PRIMARY KEY (order_id, file_hash)
      );
      CREATE INDEX IF NOT EXISTS trade_uploads_by_order ON trade_uploads (order_id, received_at);
      -- Documents both readers agreed on: the package the engine compares with the order
      CREATE TABLE IF NOT EXISTS trade_documents (
        order_id    TEXT NOT NULL,
        file_hash   TEXT NOT NULL,
        doc_type    TEXT NOT NULL,
        bl_hash     TEXT,
        extraction  TEXT NOT NULL,
        accepted_at INTEGER NOT NULL,
        PRIMARY KEY (order_id, file_hash)
      );
      -- One bill of lading settles one order (T1.9 enforces it again on chain)
      CREATE UNIQUE INDEX IF NOT EXISTS one_order_per_bl ON trade_documents (bl_hash) WHERE bl_hash IS NOT NULL;
      CREATE TABLE IF NOT EXISTS trade_alerts (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id   TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        body       TEXT NOT NULL
      );
      -- Proformas read for an importer (T3.9): the hash and the typed reading, never the file.
      -- The reading is returned again for the same file instead of a second call to the model.
      CREATE TABLE IF NOT EXISTS proforma_reads (
        importer  TEXT NOT NULL,
        file_hash TEXT NOT NULL,
        reading   TEXT NOT NULL,
        read_at   INTEGER NOT NULL,
        PRIMARY KEY (importer, file_hash)
      );
      -- Every authorized proforma upload, read or not, for the daily limit
      CREATE TABLE IF NOT EXISTS proforma_uploads (
        importer    TEXT NOT NULL,
        file_hash   TEXT NOT NULL,
        received_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS proforma_uploads_by_importer ON proforma_uploads (importer, received_at);
      -- Every authorized request for the agent's analysis, for the daily limit. Nothing else is kept.
      CREATE TABLE IF NOT EXISTS insights_requests (
        importer    TEXT NOT NULL,
        received_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS insights_by_importer ON insights_requests (importer, received_at);
    `);
  }

  close(): void {
    this.db.close();
  }

  // false if this exact message was already received
  recordEmail(messageHash: string, fromDomain: string): boolean {
    const r = this.db
      .prepare("INSERT OR IGNORE INTO emails (message_hash, from_domain, received_at) VALUES (?, ?, ?)")
      .run(messageHash, fromDomain, this.now().getTime());
    return r.changes === 1;
  }

  // Messages accepted from this domain in the last 24 hours
  emailsFromSender(fromDomain: string): number {
    const row = this.db
      .prepare("SELECT count(*) AS n FROM emails WHERE from_domain = ? AND received_at > ?")
      .get(fromDomain, this.now().getTime() - DAY_MS) as { n: number };
    return row.n;
  }

  hasInvoice(invoiceKey: string): boolean {
    return this.db.prepare("SELECT 1 FROM invoices WHERE invoice_key = ?").get(invoiceKey) !== undefined;
  }

  recordInvoice(invoiceKey: string, messageHash: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO invoices (invoice_key, message_hash, received_at) VALUES (?, ?, ?)")
      .run(invoiceKey, messageHash, this.now().getTime());
  }

  pendingChange(aliasId: AliasId): StoredChangeRequest | undefined {
    const row = this.db
      .prepare("SELECT * FROM change_requests WHERE alias_id = ? AND status = 'pending'")
      .get(aliasId) as ChangeRow | undefined;
    return row && fromRow(row);
  }

  // A rejected or vetoed change blocks new requests for the alias for CHANGE_COOLDOWN_DAYS
  inCooldown(aliasId: AliasId): boolean {
    const row = this.db
      .prepare(
        "SELECT 1 FROM change_requests WHERE alias_id = ? AND status IN ('rejected', 'vetoed') AND resolved_at > ?",
      )
      .get(aliasId, this.now().getTime() - CHANGE_COOLDOWN_DAYS * DAY_MS);
    return row !== undefined;
  }

  // Returns the stored request, or undefined if the alias already has one pending
  addChangeRequest(request: ChangeRequest): StoredChangeRequest | undefined {
    const r = this.db
      .prepare("INSERT OR IGNORE INTO change_requests (alias_id, created_at, body) VALUES (?, ?, ?)")
      .run(request.aliasId, this.now().getTime(), JSON.stringify(request));
    if (r.changes !== 1) return undefined;
    return { ...request, id: Number(r.lastInsertRowid), status: "pending" };
  }

  // Called when the owner decides in Area 4's app, or when the on-chain veto is observed
  resolveChange(id: number, resolution: ChangeResolution): boolean {
    const r = this.db
      .prepare("UPDATE change_requests SET status = ?, resolved_at = ? WHERE id = ? AND status = 'pending'")
      .run(resolution, this.now().getTime(), id);
    return r.changes === 1;
  }

  // Requests created since `since`, for one daily summary instead of a notification each
  changeDigest(since: Date): StoredChangeRequest[] {
    const rows = this.db
      .prepare("SELECT * FROM change_requests WHERE created_at >= ? ORDER BY created_at")
      .all(since.getTime()) as unknown as ChangeRow[];
    return rows.map(fromRow);
  }

  // Keel Trade ---------------------------------------------------------------------------

  // false if this exact file was already uploaded to this order
  recordUpload(u: { orderId: Hex; fileHash: Hex; docType: RequiredDocType; uploader: Hex; party: string }): boolean {
    const r = this.db
      .prepare(
        "INSERT OR IGNORE INTO trade_uploads (order_id, file_hash, doc_type, uploader, party, received_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(u.orderId.toLowerCase(), u.fileHash, u.docType, u.uploader.toLowerCase(), u.party, this.now().getTime());
    return r.changes === 1;
  }

  // Keel Trade, proforma (T3.9) ----------------------------------------------------------

  recordProformaUpload(importer: Hex, fileHash: Hex): void {
    this.db
      .prepare("INSERT INTO proforma_uploads (importer, file_hash, received_at) VALUES (?, ?, ?)")
      .run(importer.toLowerCase(), fileHash, this.now().getTime());
  }

  // Authorized proforma uploads of this importer in the last 24 hours
  proformaUploadsToday(importer: Hex): number {
    const row = this.db
      .prepare("SELECT count(*) AS n FROM proforma_uploads WHERE importer = ? AND received_at > ?")
      .get(importer.toLowerCase(), this.now().getTime() - DAY_MS) as { n: number };
    return row.n;
  }

  recordInsights(importer: Hex): void {
    this.db.prepare("INSERT INTO insights_requests (importer, received_at) VALUES (?, ?)").run(importer.toLowerCase(), this.now().getTime());
  }

  // Authorized analysis requests of this importer in the last 24 hours
  insightsToday(importer: Hex): number {
    const row = this.db
      .prepare("SELECT count(*) AS n FROM insights_requests WHERE importer = ? AND received_at > ?")
      .get(importer.toLowerCase(), this.now().getTime() - DAY_MS) as { n: number };
    return row.n;
  }

  proformaReading<T>(importer: Hex, fileHash: Hex): T | undefined {
    const row = this.db
      .prepare("SELECT reading FROM proforma_reads WHERE importer = ? AND file_hash = ?")
      .get(importer.toLowerCase(), fileHash) as { reading: string } | undefined;
    return row ? (JSON.parse(row.reading) as T) : undefined;
  }

  saveProformaReading(importer: Hex, fileHash: Hex, reading: unknown): void {
    this.db
      .prepare("INSERT OR REPLACE INTO proforma_reads (importer, file_hash, reading, read_at) VALUES (?, ?, ?, ?)")
      .run(importer.toLowerCase(), fileHash, JSON.stringify(reading), this.now().getTime());
  }

  // Authorized uploads to this order in the last 24 hours
  uploadsForOrder(orderId: Hex): number {
    const row = this.db
      .prepare("SELECT count(*) AS n FROM trade_uploads WHERE order_id = ? AND received_at > ?")
      .get(orderId.toLowerCase(), this.now().getTime() - DAY_MS) as { n: number };
    return row.n;
  }

  // The order a bill of lading was accepted for, if any
  orderForBl(blHash: Hex): Hex | undefined {
    const row = this.db.prepare("SELECT order_id FROM trade_documents WHERE bl_hash = ?").get(blHash) as
      | { order_id: Hex }
      | undefined;
    return row?.order_id;
  }

  // false if the bill of lading was accepted for another order in the meantime
  acceptDocument(d: { orderId: Hex; fileHash: Hex; docType: RequiredDocType; blHash?: Hex; extraction: object }): boolean {
    try {
      const r = this.db
        .prepare(
          "INSERT OR IGNORE INTO trade_documents (order_id, file_hash, doc_type, bl_hash, extraction, accepted_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(d.orderId.toLowerCase(), d.fileHash, d.docType, d.blHash ?? null, JSON.stringify(d.extraction), this.now().getTime());
      return r.changes === 1;
    } catch (e) {
      if (e instanceof Error && /UNIQUE/.test(e.message)) return false;
      throw e;
    }
  }

  // The document package of an order: one accepted document per required type, and the
  // docsHash the carrier's attestation and the engine's DocumentDecision must carry.
  tradePackage(orderId: Hex, required: readonly RequiredDocType[]): TradePackage {
    const rows = this.db
      .prepare("SELECT doc_type, file_hash, bl_hash, extraction FROM trade_documents WHERE order_id = ? ORDER BY accepted_at")
      .all(orderId.toLowerCase()) as unknown as { doc_type: RequiredDocType; file_hash: Hex; bl_hash: Hex | null; extraction: string }[];
    const missing = required.filter((t) => !rows.some((r) => r.doc_type === t));
    if (missing.length > 0) return { status: "incomplete", missing };
    const repeated = required.find((t) => rows.filter((r) => r.doc_type === t).length > 1);
    if (repeated) return { status: "ambiguous", docType: repeated };
    const documents = required.map((t) => {
      const r = rows.find((row) => row.doc_type === t)!;
      return { docType: t, fileHash: r.file_hash, extraction: JSON.parse(r.extraction) as object };
    });
    const bl = rows.find((r) => required.includes(r.doc_type) && r.bl_hash)?.bl_hash ?? undefined;
    return { status: "complete", docsHash: docsHash(documents.map((d) => d.fileHash)), blNumberHash: bl, documents };
  }

  addAlert(alert: AccountAlert): number {
    const r = this.db
      .prepare("INSERT INTO trade_alerts (order_id, created_at, body) VALUES (?, ?, ?)")
      .run(alert.orderId.toLowerCase(), this.now().getTime(), JSON.stringify(alert));
    return Number(r.lastInsertRowid);
  }

  // Alerts created since `since`, for one summary instead of a notification each
  alertDigest(since: Date): (AccountAlert & { id: number })[] {
    const rows = this.db
      .prepare("SELECT id, body FROM trade_alerts WHERE created_at >= ? ORDER BY created_at")
      .all(since.getTime()) as unknown as { id: number; body: string }[];
    return rows.map((r) => ({ ...(JSON.parse(r.body) as AccountAlert), id: r.id }));
  }
}

export type TradePackage =
  | { status: "complete"; docsHash: Hex; blNumberHash?: Hex; documents: { docType: RequiredDocType; fileHash: Hex; extraction: object }[] }
  | { status: "incomplete"; missing: RequiredDocType[] }
  // Two accepted documents of the same type: a person decides which one counts
  | { status: "ambiguous"; docType: RequiredDocType };

interface ChangeRow {
  id: number;
  alias_id: string;
  status: StoredChangeRequest["status"];
  created_at: number;
  resolved_at: number | null;
  body: string;
}

function fromRow(row: ChangeRow): StoredChangeRequest {
  return {
    ...(JSON.parse(row.body) as ChangeRequest),
    id: row.id,
    status: row.status,
    ...(row.resolved_at ? { resolvedAt: new Date(row.resolved_at).toISOString() } : {}),
  };
}
