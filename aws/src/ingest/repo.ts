// IngestRepo on the single ingest table (pk, sk; TTL attribute `ttl`). Same contract as the
// SQLite IngestStore (ingest/src/testing/repoContract.ts runs against both). Every uniqueness
// rule is a conditional write, never a read followed by a write:
//
//   pk                                  sk                      what
//   email#<messageHash>                 email                   a message already received
//   sender#<domain>#<day>               count                   messages of a sender that day (ttl)
//   invoice#<invoiceKey>                invoice                 an invoice already in the payment path
//   change#<aliasId>                    pending                 the one pending change of an alias
//   change#<aliasId>                    cooldown                until when new changes are refused
//   changes                             <createdMs>#<id>        change requests, by creation
//   changeid#<id>                       ref                     where request <id> lives
//   upload#<orderId>                    file#<fileHash>         an admitted upload, and its reading
//   upload#<orderId>#<day>              count                   admitted uploads of an order that day (ttl)
//   order#<orderId>                     entry                   TradeOrderEntry, written by the orders API
//   order#<orderId>                     doc#<fileHash>          a document both readers agreed on
//   bl#<blNumberHash>                   bl                      the one order a bill of lading settles
//   alerts                              <createdMs>#<id>        account alerts, by creation
//   counter                             alert | change          sequence numbers
//   proforma#<importer>                 read#<fileHash>         a proforma reading, returned again
//   proforma#<importer>#<day>           count                   proforma uploads that day (ttl)
//   settings                            current                 LLM and DMARC settings (./settings.ts)
//   audit#<day>                         <at>#<rand>             who changed which setting
//   transfers#<day>                     <at>#<rand>             transfers to LLM vendors (Ley 21.719)
//   aliases                             table                   Keel Personal alias table
//   cursor                              digest                  where the daily digest stopped
//
// Ids, addresses and hashes in keys are lowercase. <day> is the UTC day, YYYY-MM-DD: the daily
// limits count per UTC day here, where IngestStore counts the last 24 hours.
import { randomBytes } from "node:crypto";
import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { AliasId, Hex, RequiredDocType } from "@keel/schemas";
import {
  CHANGE_COOLDOWN_DAYS,
  DAY_MS,
  MAX_DOCUMENTS_PER_ORDER_PER_DAY,
  packageFrom,
  TradeOrderEntrySchema,
  utcDay,
  type AcceptedDocument,
  type AccountAlert,
  type ChangeRequest,
  type ChangeResolution,
  type IngestRepo,
  type StoredChangeRequest,
  type StoredUpload,
  type TradeOrderEntry,
  type TradePackage,
  type UploadAdmission,
  type UploadEntry,
} from "@keel/ingest";
import { ddb } from "../db";

type Client = Pick<DynamoDBDocumentClient, "send">;
type Item = Record<string, unknown>;

const lower = (s: string) => s.toLowerCase();
const pad = (n: number, width: number) => String(n).padStart(width, "0");
// Milliseconds since 1970 sort as text with 15 digits until the year 33658
const at = (ms: number) => pad(ms, 15);

export const ingestKey = {
  email: (messageHash: string) => ({ pk: `email#${messageHash}`, sk: "email" }),
  sender: (domain: string, day: string) => ({ pk: `sender#${lower(domain)}#${day}`, sk: "count" }),
  invoice: (key: string) => ({ pk: `invoice#${key}`, sk: "invoice" }),
  pendingChange: (alias: string) => ({ pk: `change#${alias}`, sk: "pending" }),
  cooldown: (alias: string) => ({ pk: `change#${alias}`, sk: "cooldown" }),
  change: (createdMs: number, id: number) => ({ pk: "changes", sk: `${at(createdMs)}#${pad(id, 12)}` }),
  changeRef: (id: number) => ({ pk: `changeid#${id}`, sk: "ref" }),
  upload: (orderId: string, fileHash: string) => ({ pk: `upload#${lower(orderId)}`, sk: `file#${lower(fileHash)}` }),
  uploadCount: (orderId: string, day: string) => ({ pk: `upload#${lower(orderId)}#${day}`, sk: "count" }),
  orderEntry: (orderId: string) => ({ pk: `order#${lower(orderId)}`, sk: "entry" }),
  document: (orderId: string, fileHash: string) => ({ pk: `order#${lower(orderId)}`, sk: `doc#${lower(fileHash)}` }),
  bl: (blHash: string) => ({ pk: `bl#${lower(blHash)}`, sk: "bl" }),
  alert: (createdMs: number, id: number) => ({ pk: "alerts", sk: `${at(createdMs)}#${pad(id, 12)}` }),
  counter: (name: "alert" | "change") => ({ pk: "counter", sk: name }),
  proformaRead: (importer: string, fileHash: string) => ({ pk: `proforma#${lower(importer)}`, sk: `read#${lower(fileHash)}` }),
  proformaCount: (importer: string, day: string) => ({ pk: `proforma#${lower(importer)}#${day}`, sk: "count" }),
  settings: () => ({ pk: "settings", sk: "current" }),
  audit: (iso: string) => ({ pk: `audit#${iso.slice(0, 10)}`, sk: `${iso}#${randomBytes(4).toString("hex")}` }),
  transfer: (iso: string, seq: number) => ({ pk: `transfers#${iso.slice(0, 10)}`, sk: `${iso}#${pad(seq, 4)}#${randomBytes(4).toString("hex")}` }),
  aliases: () => ({ pk: "aliases", sk: "table" }),
  digestCursor: () => ({ pk: "cursor", sk: "digest" }),
} as const;

// A daily counter disappears two days after its day ends
const counterTtl = (now: Date) => Math.floor((Date.parse(`${utcDay(now)}T00:00:00Z`) + 3 * DAY_MS) / 1000);

type Cancel = { ok: true } | { ok: false; failed: boolean[] };

export interface DigestCursor {
  // ISO times: change requests and transfers are reported from here on
  changes?: string;
  transfers?: string;
}

export class DynamoIngestRepo implements IngestRepo {
  // The document client this repo writes with; the settings backend shares it
  readonly db: () => Client;
  private readonly now: () => Date;

  constructor(
    readonly table: string,
    options: { client?: Client; now?: () => Date } = {},
  ) {
    this.db = () => options.client ?? ddb();
    this.now = options.now ?? (() => new Date());
  }

  private send<T>(command: unknown): Promise<T> {
    return this.db().send(command as never) as Promise<T>;
  }

  private async get(key: Item): Promise<Item | undefined> {
    const r = await this.send<{ Item?: Item }>(new GetCommand({ TableName: this.table, Key: key, ConsistentRead: true }));
    return r.Item;
  }

  // A conditional write that lost is an answer: which items' conditions failed. Any other
  // cancellation (a conflicting transaction, throttling) is an error for the caller to retry.
  private async transact(items: Item[]): Promise<Cancel> {
    try {
      await this.send(new TransactWriteCommand({ TransactItems: items as never }));
      return { ok: true };
    } catch (e) {
      const err = e as { name?: string; CancellationReasons?: { Code?: string }[] };
      if (err.name !== "TransactionCanceledException" || !err.CancellationReasons) throw e;
      const codes = err.CancellationReasons.map((r) => r.Code ?? "None");
      if (codes.some((c) => c !== "None" && c !== "ConditionalCheckFailed")) throw e;
      return { ok: false, failed: codes.map((c) => c === "ConditionalCheckFailed") };
    }
  }

  private async conditional(command: unknown): Promise<boolean> {
    try {
      await this.send(command);
      return true;
    } catch (e) {
      if ((e as { name?: string }).name === "ConditionalCheckFailedException") return false;
      throw e;
    }
  }

  private async queryAll(input: Item): Promise<Item[]> {
    const out: Item[] = [];
    let start: Item | undefined;
    do {
      const r = await this.send<{ Items?: Item[]; LastEvaluatedKey?: Item }>(
        new QueryCommand({ TableName: this.table, ...input, ...(start ? { ExclusiveStartKey: start } : {}) } as never),
      );
      out.push(...(r.Items ?? []));
      start = r.LastEvaluatedKey;
    } while (start);
    return out;
  }

  private async count(key: Item): Promise<number> {
    return Number((await this.get(key))?.n ?? 0);
  }

  private increment(key: Item, extra: { condition?: string; values?: Item } = {}): Item {
    return {
      TableName: this.table,
      Key: key,
      UpdateExpression: "ADD #n :one SET #ttl = :ttl",
      ...(extra.condition ? { ConditionExpression: extra.condition } : {}),
      ExpressionAttributeNames: { "#n": "n", "#ttl": "ttl" },
      ExpressionAttributeValues: { ":one": 1, ":ttl": counterTtl(this.now()), ...extra.values },
    };
  }

  private async nextId(name: "alert" | "change"): Promise<number> {
    const r = await this.send<{ Attributes?: Item }>(
      new UpdateCommand({
        TableName: this.table,
        Key: ingestKey.counter(name),
        UpdateExpression: "ADD #n :one",
        ExpressionAttributeNames: { "#n": "n" },
        ExpressionAttributeValues: { ":one": 1 },
        ReturnValues: "UPDATED_NEW",
      }),
    );
    return Number(r.Attributes?.n);
  }

  // Keel Personal ------------------------------------------------------------------------

  async recordEmail(messageHash: string, fromDomain: string): Promise<boolean> {
    const r = await this.transact([
      {
        Put: {
          TableName: this.table,
          Item: { ...ingestKey.email(messageHash), fromDomain: lower(fromDomain), receivedAt: this.now().getTime() },
          ConditionExpression: "attribute_not_exists(pk)",
        },
      },
      { Update: this.increment(ingestKey.sender(fromDomain, utcDay(this.now()))) },
    ]);
    return r.ok;
  }

  async emailsFromSender(fromDomain: string): Promise<number> {
    return this.count(ingestKey.sender(fromDomain, utcDay(this.now())));
  }

  async hasInvoice(invoiceKey: string): Promise<boolean> {
    return (await this.get(ingestKey.invoice(invoiceKey))) !== undefined;
  }

  async recordInvoice(invoiceKey: string, messageHash: string): Promise<void> {
    await this.conditional(
      new PutCommand({
        TableName: this.table,
        Item: { ...ingestKey.invoice(invoiceKey), messageHash, receivedAt: this.now().getTime() },
        ConditionExpression: "attribute_not_exists(pk)",
      }),
    );
  }

  private stored(item: Item): StoredChangeRequest {
    return {
      ...(item.body as ChangeRequest),
      id: Number(item.id),
      status: item.status as StoredChangeRequest["status"],
      ...(item.resolvedAt ? { resolvedAt: new Date(Number(item.resolvedAt)).toISOString() } : {}),
    };
  }

  async pendingChange(aliasId: AliasId): Promise<StoredChangeRequest | undefined> {
    const marker = await this.get(ingestKey.pendingChange(aliasId));
    if (!marker) return undefined;
    const item = await this.get({ pk: "changes", sk: marker.ref });
    return item && this.stored(item);
  }

  async inCooldown(aliasId: AliasId): Promise<boolean> {
    const item = await this.get(ingestKey.cooldown(aliasId));
    return item !== undefined && Number(item.until) > this.now().getTime();
  }

  async addChangeRequest(request: ChangeRequest): Promise<StoredChangeRequest | undefined> {
    // A request refused below still spends an id: ids are unique, not contiguous
    const id = await this.nextId("change");
    const created = this.now().getTime();
    const key = ingestKey.change(created, id);
    const r = await this.transact([
      {
        Put: {
          TableName: this.table,
          Item: { ...ingestKey.pendingChange(request.aliasId), id, ref: key.sk },
          ConditionExpression: "attribute_not_exists(pk)",
        },
      },
      { Put: { TableName: this.table, Item: { ...key, id, aliasId: request.aliasId, status: "pending", createdAt: created, body: request } } },
      { Put: { TableName: this.table, Item: { ...ingestKey.changeRef(id), ref: key.sk, aliasId: request.aliasId } } },
    ]);
    if (!r.ok) return undefined;
    return { ...request, id, status: "pending" };
  }

  async resolveChange(id: number, resolution: ChangeResolution): Promise<boolean> {
    const ref = await this.get(ingestKey.changeRef(id));
    if (!ref) return false;
    const now = this.now().getTime();
    const alias = ref.aliasId as string;
    const items: Item[] = [
      {
        Update: {
          TableName: this.table,
          Key: { pk: "changes", sk: ref.ref },
          UpdateExpression: "SET #s = :res, resolvedAt = :now",
          ConditionExpression: "#s = :pending",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: { ":res": resolution, ":now": now, ":pending": "pending" },
        },
      },
      {
        Delete: {
          TableName: this.table,
          Key: ingestKey.pendingChange(alias),
          ConditionExpression: "id = :id",
          ExpressionAttributeValues: { ":id": id },
        },
      },
    ];
    if (resolution !== "approved") {
      items.push({ Put: { TableName: this.table, Item: { ...ingestKey.cooldown(alias), until: now + CHANGE_COOLDOWN_DAYS * DAY_MS } } });
    }
    return (await this.transact(items)).ok;
  }

  async changeDigest(since: Date): Promise<StoredChangeRequest[]> {
    const items = await this.queryAll({
      KeyConditionExpression: "pk = :pk AND sk >= :since",
      ExpressionAttributeValues: { ":pk": "changes", ":since": at(since.getTime()) },
    });
    return items.map((i) => this.stored(i));
  }

  // Keel Trade ---------------------------------------------------------------------------

  async admitUpload(u: UploadEntry, max = MAX_DOCUMENTS_PER_ORDER_PER_DAY): Promise<UploadAdmission> {
    const now = this.now();
    const r = await this.transact([
      {
        Put: {
          TableName: this.table,
          Item: {
            ...ingestKey.upload(u.orderId, u.fileHash),
            orderId: lower(u.orderId),
            fileHash: lower(u.fileHash),
            docType: u.docType,
            uploader: lower(u.uploader),
            party: u.party,
            receivedAt: now.getTime(),
          },
          ConditionExpression: "attribute_not_exists(pk)",
        },
      },
      {
        Update: this.increment(ingestKey.uploadCount(u.orderId, utcDay(now)), {
          condition: "attribute_not_exists(#n) OR #n < :max",
          values: { ":max": max },
        }),
      },
    ]);
    if (r.ok) return "admitted";
    return r.failed[0] ? "duplicate" : "rate_limited";
  }

  async uploadsForOrder(orderId: Hex): Promise<number> {
    return this.count(ingestKey.uploadCount(orderId, utcDay(this.now())));
  }

  async upload(orderId: Hex, fileHash: Hex): Promise<StoredUpload | undefined> {
    const item = await this.get(ingestKey.upload(orderId, fileHash));
    if (!item) return undefined;
    return {
      orderId: item.orderId as Hex,
      fileHash: item.fileHash as Hex,
      docType: item.docType as RequiredDocType,
      uploader: item.uploader as Hex,
      party: item.party as StoredUpload["party"],
      receivedAt: new Date(Number(item.receivedAt)).toISOString(),
      ...(item.readClaimedAt !== undefined ? { readClaimedAt: new Date(Number(item.readClaimedAt)).toISOString() } : {}),
      ...(item.readStatus !== undefined ? { readStatus: String(item.readStatus) } : {}),
    };
  }

  async claimReading(orderId: Hex, fileHash: Hex, staleAfterMs: number): Promise<boolean> {
    const now = this.now().getTime();
    return this.conditional(
      new UpdateCommand({
        TableName: this.table,
        Key: ingestKey.upload(orderId, fileHash),
        UpdateExpression: "SET readClaimedAt = :now",
        ConditionExpression:
          "attribute_exists(pk) AND attribute_not_exists(readStatus) AND (attribute_not_exists(readClaimedAt) OR readClaimedAt < :stale)",
        ExpressionAttributeValues: { ":now": now, ":stale": now - staleAfterMs },
      }),
    );
  }

  async finishReading(orderId: Hex, fileHash: Hex, status: string): Promise<void> {
    await this.conditional(
      new UpdateCommand({
        TableName: this.table,
        Key: ingestKey.upload(orderId, fileHash),
        UpdateExpression: "SET readStatus = :s",
        ConditionExpression: "attribute_exists(pk)",
        ExpressionAttributeValues: { ":s": status },
      }),
    );
  }

  async orderForBl(blHash: Hex): Promise<Hex | undefined> {
    return (await this.get(ingestKey.bl(blHash)))?.orderId as Hex | undefined;
  }

  async acceptDocument(d: AcceptedDocument): Promise<boolean> {
    const docKey = ingestKey.document(d.orderId, d.fileHash);
    if (await this.get(docKey)) return true;
    const items: Item[] = [
      {
        Put: {
          TableName: this.table,
          Item: {
            ...docKey,
            orderId: lower(d.orderId),
            fileHash: lower(d.fileHash),
            docType: d.docType,
            ...(d.blHash ? { blHash: lower(d.blHash) } : {}),
            extraction: d.extraction,
            acceptedAt: this.now().getTime(),
          },
          ConditionExpression: "attribute_not_exists(pk)",
        },
      },
    ];
    if (d.blHash) {
      items.push({
        Put: {
          TableName: this.table,
          Item: { ...ingestKey.bl(d.blHash), orderId: lower(d.orderId), fileHash: lower(d.fileHash) },
          ConditionExpression: "attribute_not_exists(pk)",
        },
      });
    }
    const r = await this.transact(items);
    // A concurrent reading of the same file won the race: it is accepted all the same
    return r.ok || r.failed[0] === true;
  }

  async tradePackage(orderId: Hex, required: readonly RequiredDocType[]): Promise<TradePackage> {
    const items = await this.queryAll({
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :doc)",
      ExpressionAttributeValues: { ":pk": `order#${lower(orderId)}`, ":doc": "doc#" },
    });
    items.sort((a, b) => Number(a.acceptedAt) - Number(b.acceptedAt));
    return packageFrom(
      items.map((i) => ({
        docType: i.docType as RequiredDocType,
        fileHash: i.fileHash as Hex,
        blHash: (i.blHash as Hex | undefined) ?? null,
        extraction: i.extraction as object,
      })),
      required,
    );
  }

  async addAlert(alert: AccountAlert): Promise<number> {
    const id = await this.nextId("alert");
    const created = this.now().getTime();
    await this.send(
      new PutCommand({
        TableName: this.table,
        Item: { ...ingestKey.alert(created, id), id, orderId: lower(alert.orderId), createdAt: created, body: alert },
      }),
    );
    return id;
  }

  async alertDigest(since: Date): Promise<(AccountAlert & { id: number })[]> {
    const items = await this.queryAll({
      KeyConditionExpression: "pk = :pk AND sk >= :since",
      ExpressionAttributeValues: { ":pk": "alerts", ":since": at(since.getTime()) },
    });
    return items.map((i) => ({ ...(i.body as AccountAlert), id: Number(i.id) }));
  }

  // Keel Trade, proforma (T3.9) ----------------------------------------------------------

  async recordProformaUpload(importer: Hex, _fileHash: Hex): Promise<void> {
    await this.send(new UpdateCommand(this.increment(ingestKey.proformaCount(importer, utcDay(this.now()))) as never));
  }

  async proformaUploadsToday(importer: Hex): Promise<number> {
    return this.count(ingestKey.proformaCount(importer, utcDay(this.now())));
  }

  async proformaReading<T>(importer: Hex, fileHash: Hex): Promise<T | undefined> {
    return (await this.get(ingestKey.proformaRead(importer, fileHash)))?.reading as T | undefined;
  }

  async saveProformaReading(importer: Hex, fileHash: Hex, reading: unknown): Promise<void> {
    await this.send(
      new PutCommand({
        TableName: this.table,
        Item: { ...ingestKey.proformaRead(importer, fileHash), reading, readAt: this.now().getTime() },
      }),
    );
  }

  // Beyond IngestRepo: what the Lambdas need from the same table ------------------------

  // The order as the orders API registered it. A malformed entry is treated as unknown: an
  // upload is never authorized against an entry ingest cannot read.
  async orderEntry(orderId: Hex): Promise<TradeOrderEntry | undefined> {
    const item = await this.get(ingestKey.orderEntry(orderId));
    if (!item) return undefined;
    const { orderId: id, payoutAddress, carrier, uploaders, knownDestinations } = item;
    const parsed = TradeOrderEntrySchema.safeParse({ orderId: id, payoutAddress, carrier, uploaders, knownDestinations });
    if (!parsed.success) {
      console.error(JSON.stringify({ event: "ingest_order_entry_invalid", orderId: lower(orderId) }));
      return undefined;
    }
    return parsed.data as TradeOrderEntry;
  }

  async aliasTable(): Promise<unknown> {
    return (await this.get(ingestKey.aliases()))?.aliases;
  }

  // Transfers to LLM vendors, kept per day so the digest can report them
  async recordTransfers(entries: readonly Record<string, unknown>[]): Promise<void> {
    const iso = this.now().toISOString();
    for (const [i, entry] of entries.entries()) {
      await this.send(new PutCommand({ TableName: this.table, Item: { ...ingestKey.transfer(iso, i), at: iso, entry } }));
    }
  }

  // At most `maxDays` days are read, so a lost cursor cannot turn into a scan of the table
  async transfersSince(since: Date, until: Date, maxDays = 31): Promise<Record<string, unknown>[]> {
    const from = Math.max(since.getTime(), until.getTime() - maxDays * DAY_MS);
    const out: Record<string, unknown>[] = [];
    for (let day = Date.parse(`${utcDay(new Date(from))}T00:00:00Z`); day <= until.getTime(); day += DAY_MS) {
      const items = await this.queryAll({
        KeyConditionExpression: "pk = :pk AND sk >= :from",
        ExpressionAttributeValues: { ":pk": `transfers#${utcDay(new Date(day))}`, ":from": new Date(from).toISOString() },
      });
      const end = until.toISOString();
      out.push(...items.filter((i) => String(i.at) < end).map((i) => i.entry as Record<string, unknown>));
    }
    return out;
  }

  async digestCursor(): Promise<DigestCursor> {
    const item = await this.get(ingestKey.digestCursor());
    return { ...(item?.changes ? { changes: String(item.changes) } : {}), ...(item?.transfers ? { transfers: String(item.transfers) } : {}) };
  }

  async saveDigestCursor(cursor: DigestCursor): Promise<void> {
    await this.send(new PutCommand({ TableName: this.table, Item: { ...ingestKey.digestCursor(), ...cursor } }));
  }
}
