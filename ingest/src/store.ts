// Ingest state for flood protection and deduplication. T3.2, issue #19.
// node:sqlite, so there is no extra dependency. Stores hashes, domains, aliases and change
// requests; never email bodies or invoice text. The local implementation of IngestRepo
// (./repo.ts): node:sqlite is synchronous, so each method settles at once.
import { DatabaseSync } from "node:sqlite";
import type { AliasId, Hex, RequiredDocType } from "@keel/schemas";
import type { ChangeRequest } from "./beneficiaryChange";
import {
  CHANGE_COOLDOWN_DAYS,
  DAY_MS,
  MAX_DOCUMENTS_PER_ORDER_PER_DAY,
  packageFrom,
  type AcceptedDocument,
  type ChangeResolution,
  type IngestRepo,
  type StoredChangeRequest,
  type StoredUpload,
  type TradePackage,
  type UploadAdmission,
  type UploadEntry,
} from "./repo";
import type { AccountAlert } from "./trade/accountAlert";

export {
  CHANGE_COOLDOWN_DAYS,
  CHANGE_RESOLUTIONS,
  MAX_DOCUMENTS_PER_ORDER_PER_DAY,
  MAX_EMAILS_PER_SENDER_PER_DAY,
  type ChangeResolution,
  type StoredChangeRequest,
  type TradePackage,
} from "./repo";

export class IngestStore implements IngestRepo {
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

      -- Keel Trade. Every admitted upload, read or not: who uploaded which file to which order
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
      -- The asynchronous reader's claim on an upload, and how the reading ended
      CREATE TABLE IF NOT EXISTS trade_reads (
        order_id   TEXT NOT NULL,
        file_hash  TEXT NOT NULL,
        claimed_at INTEGER NOT NULL,
        status     TEXT,
        PRIMARY KEY (order_id, file_hash)
      );
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
    `);
  }

  close(): void {
    this.db.close();
  }

  private dayAgo(): number {
    return this.now().getTime() - DAY_MS;
  }

  async recordEmail(messageHash: string, fromDomain: string): Promise<boolean> {
    const r = this.db
      .prepare("INSERT OR IGNORE INTO emails (message_hash, from_domain, received_at) VALUES (?, ?, ?)")
      .run(messageHash, fromDomain, this.now().getTime());
    return r.changes === 1;
  }

  async emailsFromSender(fromDomain: string): Promise<number> {
    const row = this.db
      .prepare("SELECT count(*) AS n FROM emails WHERE from_domain = ? AND received_at > ?")
      .get(fromDomain, this.dayAgo()) as { n: number };
    return row.n;
  }

  async hasInvoice(invoiceKey: string): Promise<boolean> {
    return this.db.prepare("SELECT 1 FROM invoices WHERE invoice_key = ?").get(invoiceKey) !== undefined;
  }

  async recordInvoice(invoiceKey: string, messageHash: string): Promise<void> {
    this.db
      .prepare("INSERT OR IGNORE INTO invoices (invoice_key, message_hash, received_at) VALUES (?, ?, ?)")
      .run(invoiceKey, messageHash, this.now().getTime());
  }

  async pendingChange(aliasId: AliasId): Promise<StoredChangeRequest | undefined> {
    const row = this.db
      .prepare("SELECT * FROM change_requests WHERE alias_id = ? AND status = 'pending'")
      .get(aliasId) as ChangeRow | undefined;
    return row && fromRow(row);
  }

  async inCooldown(aliasId: AliasId): Promise<boolean> {
    const row = this.db
      .prepare(
        "SELECT 1 FROM change_requests WHERE alias_id = ? AND status IN ('rejected', 'vetoed') AND resolved_at > ?",
      )
      .get(aliasId, this.now().getTime() - CHANGE_COOLDOWN_DAYS * DAY_MS);
    return row !== undefined;
  }

  async addChangeRequest(request: ChangeRequest): Promise<StoredChangeRequest | undefined> {
    const r = this.db
      .prepare("INSERT OR IGNORE INTO change_requests (alias_id, created_at, body) VALUES (?, ?, ?)")
      .run(request.aliasId, this.now().getTime(), JSON.stringify(request));
    if (r.changes !== 1) return undefined;
    return { ...request, id: Number(r.lastInsertRowid), status: "pending" };
  }

  // Called when the owner decides in Area 4's app, or when the on-chain veto is observed
  async resolveChange(id: number, resolution: ChangeResolution): Promise<boolean> {
    const r = this.db
      .prepare("UPDATE change_requests SET status = ?, resolved_at = ? WHERE id = ? AND status = 'pending'")
      .run(resolution, this.now().getTime(), id);
    return r.changes === 1;
  }

  async changeDigest(since: Date): Promise<StoredChangeRequest[]> {
    const rows = this.db
      .prepare("SELECT * FROM change_requests WHERE created_at >= ? ORDER BY created_at, id")
      .all(since.getTime()) as unknown as ChangeRow[];
    return rows.map(fromRow);
  }

  // Keel Trade ---------------------------------------------------------------------------

  // The three steps run synchronously, with no await between them, so another upload's
  // cannot interleave
  async admitUpload(u: UploadEntry, max = MAX_DOCUMENTS_PER_ORDER_PER_DAY): Promise<UploadAdmission> {
    const orderId = u.orderId.toLowerCase();
    if (this.db.prepare("SELECT 1 FROM trade_uploads WHERE order_id = ? AND file_hash = ?").get(orderId, u.fileHash)) {
      return "duplicate";
    }
    const { n } = this.db
      .prepare("SELECT count(*) AS n FROM trade_uploads WHERE order_id = ? AND received_at > ?")
      .get(orderId, this.dayAgo()) as { n: number };
    if (n >= max) return "rate_limited";
    this.db
      .prepare(
        "INSERT INTO trade_uploads (order_id, file_hash, doc_type, uploader, party, received_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(orderId, u.fileHash, u.docType, u.uploader.toLowerCase(), u.party, this.now().getTime());
    return "admitted";
  }

  async uploadsForOrder(orderId: Hex): Promise<number> {
    const row = this.db
      .prepare("SELECT count(*) AS n FROM trade_uploads WHERE order_id = ? AND received_at > ?")
      .get(orderId.toLowerCase(), this.dayAgo()) as { n: number };
    return row.n;
  }

  async upload(orderId: Hex, fileHash: Hex): Promise<StoredUpload | undefined> {
    const row = this.db
      .prepare(
        `SELECT u.*, r.claimed_at, r.status FROM trade_uploads u
         LEFT JOIN trade_reads r ON r.order_id = u.order_id AND r.file_hash = u.file_hash
         WHERE u.order_id = ? AND u.file_hash = ?`,
      )
      .get(orderId.toLowerCase(), fileHash) as UploadRow | undefined;
    if (!row) return undefined;
    return {
      orderId: row.order_id,
      fileHash: row.file_hash,
      docType: row.doc_type,
      uploader: row.uploader,
      party: row.party,
      receivedAt: new Date(row.received_at).toISOString(),
      ...(row.claimed_at !== null ? { readClaimedAt: new Date(row.claimed_at).toISOString() } : {}),
      ...(row.status !== null ? { readStatus: row.status } : {}),
    };
  }

  async claimReading(orderId: Hex, fileHash: Hex, staleAfterMs: number): Promise<boolean> {
    const id = orderId.toLowerCase();
    if (!this.db.prepare("SELECT 1 FROM trade_uploads WHERE order_id = ? AND file_hash = ?").get(id, fileHash)) return false;
    const now = this.now().getTime();
    const r = this.db
      .prepare(
        `INSERT INTO trade_reads (order_id, file_hash, claimed_at) VALUES (?, ?, ?)
         ON CONFLICT (order_id, file_hash) DO UPDATE SET claimed_at = excluded.claimed_at
         WHERE trade_reads.status IS NULL AND trade_reads.claimed_at < ?`,
      )
      .run(id, fileHash, now, now - staleAfterMs);
    return r.changes === 1;
  }

  async finishReading(orderId: Hex, fileHash: Hex, status: string): Promise<void> {
    this.db
      .prepare("UPDATE trade_reads SET status = ? WHERE order_id = ? AND file_hash = ?")
      .run(status, orderId.toLowerCase(), fileHash);
  }

  async orderForBl(blHash: Hex): Promise<Hex | undefined> {
    const row = this.db.prepare("SELECT order_id FROM trade_documents WHERE bl_hash = ?").get(blHash) as
      | { order_id: Hex }
      | undefined;
    return row?.order_id;
  }

  async acceptDocument(d: AcceptedDocument): Promise<boolean> {
    const orderId = d.orderId.toLowerCase();
    if (this.db.prepare("SELECT 1 FROM trade_documents WHERE order_id = ? AND file_hash = ?").get(orderId, d.fileHash)) {
      return true;
    }
    try {
      this.db
        .prepare(
          "INSERT INTO trade_documents (order_id, file_hash, doc_type, bl_hash, extraction, accepted_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(orderId, d.fileHash, d.docType, d.blHash ?? null, JSON.stringify(d.extraction), this.now().getTime());
      return true;
    } catch (e) {
      if (e instanceof Error && /UNIQUE/.test(e.message)) return false;
      throw e;
    }
  }

  async tradePackage(orderId: Hex, required: readonly RequiredDocType[]): Promise<TradePackage> {
    const rows = this.db
      .prepare("SELECT doc_type, file_hash, bl_hash, extraction FROM trade_documents WHERE order_id = ? ORDER BY accepted_at")
      .all(orderId.toLowerCase()) as unknown as { doc_type: RequiredDocType; file_hash: Hex; bl_hash: Hex | null; extraction: string }[];
    return packageFrom(
      rows.map((r) => ({ docType: r.doc_type, fileHash: r.file_hash, blHash: r.bl_hash, extraction: JSON.parse(r.extraction) as object })),
      required,
    );
  }

  async addAlert(alert: AccountAlert): Promise<number> {
    const r = this.db
      .prepare("INSERT INTO trade_alerts (order_id, created_at, body) VALUES (?, ?, ?)")
      .run(alert.orderId.toLowerCase(), this.now().getTime(), JSON.stringify(alert));
    return Number(r.lastInsertRowid);
  }

  async alertDigest(since: Date): Promise<(AccountAlert & { id: number })[]> {
    const rows = this.db
      .prepare("SELECT id, body FROM trade_alerts WHERE created_at >= ? ORDER BY created_at, id")
      .all(since.getTime()) as unknown as { id: number; body: string }[];
    return rows.map((r) => ({ ...(JSON.parse(r.body) as AccountAlert), id: r.id }));
  }

  // Keel Trade, proforma (T3.9) ----------------------------------------------------------

  async recordProformaUpload(importer: Hex, fileHash: Hex): Promise<void> {
    this.db
      .prepare("INSERT INTO proforma_uploads (importer, file_hash, received_at) VALUES (?, ?, ?)")
      .run(importer.toLowerCase(), fileHash, this.now().getTime());
  }

  async proformaUploadsToday(importer: Hex): Promise<number> {
    const row = this.db
      .prepare("SELECT count(*) AS n FROM proforma_uploads WHERE importer = ? AND received_at > ?")
      .get(importer.toLowerCase(), this.dayAgo()) as { n: number };
    return row.n;
  }

  async proformaReading<T>(importer: Hex, fileHash: Hex): Promise<T | undefined> {
    const row = this.db
      .prepare("SELECT reading FROM proforma_reads WHERE importer = ? AND file_hash = ?")
      .get(importer.toLowerCase(), fileHash) as { reading: string } | undefined;
    return row ? (JSON.parse(row.reading) as T) : undefined;
  }

  async saveProformaReading(importer: Hex, fileHash: Hex, reading: unknown): Promise<void> {
    this.db
      .prepare("INSERT OR REPLACE INTO proforma_reads (importer, file_hash, reading, read_at) VALUES (?, ?, ?, ?)")
      .run(importer.toLowerCase(), fileHash, JSON.stringify(reading), this.now().getTime());
  }
}

interface ChangeRow {
  id: number;
  alias_id: string;
  status: StoredChangeRequest["status"];
  created_at: number;
  resolved_at: number | null;
  body: string;
}

interface UploadRow {
  order_id: Hex;
  file_hash: Hex;
  doc_type: RequiredDocType;
  uploader: Hex;
  party: StoredUpload["party"];
  received_at: number;
  claimed_at: number | null;
  status: string | null;
}

function fromRow(row: ChangeRow): StoredChangeRequest {
  return {
    ...(JSON.parse(row.body) as ChangeRequest),
    id: row.id,
    status: row.status,
    ...(row.resolved_at ? { resolvedAt: new Date(row.resolved_at).toISOString() } : {}),
  };
}
