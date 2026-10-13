// Ingest state for flood protection and deduplication. T3.2, issue #19.
// node:sqlite, so there is no extra dependency. Stores hashes, domains, aliases and change
// requests; never email bodies or invoice text.
import { DatabaseSync } from "node:sqlite";
import type { AliasId } from "@keel/schemas";
import type { ChangeRequest } from "./beneficiaryChange";

export const MAX_EMAILS_PER_SENDER_PER_DAY = 20;
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
}

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
