// Order book loaded from BOT_ORDERS_FILE. Ingest names an order by its bytes32 orderId and the
// parties by wallet address; a notice needs the label people use, the parties' accounts and
// the shipment deadline. This file mirrors the signed orders: it never comes from a document.
// Startup fails if the file does not validate, if a label is not a valid orderLabel, if an
// account is not in the recipient directory or if an order names the same account twice.
//
// No address map: ingest's outcomes already say which side uploaded (`party`), and an address
// is never shown in a message.
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { OrderLabel, Parties, Timestamp, type Parties as PartiesT } from "../../domain/notice";
import { ConfigError } from "./env";

const OrderId = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

const OrdersFile = z.strictObject({
  orders: z.record(
    OrderId,
    z.strictObject({
      label: OrderLabel,
      importer: z.string(),
      exporter: z.string(),
      arbiter: z.string().optional(),
      shipmentDeadline: Timestamp,
    }),
  ),
});

export interface OrderEntry {
  // The bytes32 orderId, lowercase. Used as orderRef, so the app link opens the same order.
  orderRef: string;
  label: string;
  parties: PartiesT;
  shipmentDeadline: number;
}

export class OrderBook {
  constructor(private readonly byId: ReadonlyMap<string, OrderEntry>) {}

  get(orderId: string): OrderEntry | undefined {
    return this.byId.get(orderId.toLowerCase());
  }

  get size(): number {
    return this.byId.size;
  }
}

export function parseOrders(json: unknown, accountExists: (accountId: string) => boolean): OrderBook {
  const parsed = OrdersFile.safeParse(json);
  if (!parsed.success) {
    const paths = parsed.error.issues.map((i) => i.path.join(".") || "(root)");
    throw new ConfigError(`BOT_ORDERS_FILE does not validate at: ${[...new Set(paths)].join(", ")}`);
  }
  const byId = new Map<string, OrderEntry>();
  const labels = new Set<string>();
  for (const [id, o] of Object.entries(parsed.data.orders)) {
    const orderRef = id.toLowerCase();
    if (byId.has(orderRef)) throw new ConfigError(`order ${o.label}: the same orderId appears twice`);
    if (labels.has(o.label)) throw new ConfigError(`order ${o.label}: the label appears twice`);
    const parties = Parties.safeParse({ importer: o.importer, exporter: o.exporter, arbiter: o.arbiter });
    if (!parties.success) throw new ConfigError(`order ${o.label}: parties must be valid, different account ids`);
    for (const account of [o.importer, o.exporter, ...(o.arbiter ? [o.arbiter] : [])]) {
      if (!accountExists(account)) throw new ConfigError(`order ${o.label}: account ${account} is not in BOT_RECIPIENTS_FILE`);
    }
    labels.add(o.label);
    byId.set(orderRef, { orderRef, label: o.label, parties: parties.data, shipmentDeadline: o.shipmentDeadline });
  }
  return new OrderBook(byId);
}

export async function loadOrders(file: string, accountExists: (accountId: string) => boolean): Promise<OrderBook> {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    throw new ConfigError(`cannot read BOT_ORDERS_FILE: ${err instanceof Error ? err.name : "error"}`);
  }
  return parseOrders(json, accountExists);
}
