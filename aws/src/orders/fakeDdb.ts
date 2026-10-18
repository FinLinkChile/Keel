// For tests: an in-memory DynamoDB DocumentClient, injected with setDdb. It implements the subset
// of DynamoDB the orders API uses, with DynamoDB's semantics where they matter for correctness:
// condition expressions decide every guarded write (ConditionalCheckFailedException), a
// transaction applies all its writes or none (TransactionCanceledException), a SET on a nested
// path whose parent is missing fails, and every read returns a copy.
//
// Expressions: comparisons = and <>, AND, OR, NOT, parentheses, attribute_exists,
// attribute_not_exists, contains; SET with if_not_exists and list_append; REMOVE.
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

type Item = Record<string, unknown>;
type Names = Record<string, string> | undefined;
type Values = Record<string, unknown> | undefined;

export interface FakeTable {
  key: string[];
  // Index name -> partition attribute
  indexes?: Record<string, string>;
}

class DdbError extends Error {
  constructor(readonly name: string) {
    super(name);
  }
}

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

// ---------------------------------------------------------------- expressions

type Token = { t: "id" | "op" | "(" | ")" | ","; v: string };

function tokenize(s: string): Token[] {
  const out: Token[] = [];
  const re = /\s*(<>|=|\(|\)|,|[#:]?[A-Za-z_][A-Za-z0-9_]*(?:\.[#]?[A-Za-z_][A-Za-z0-9_]*)*)/y;
  let m: RegExpExecArray | null;
  let i = 0;
  while (i < s.length) {
    re.lastIndex = i;
    m = re.exec(s);
    if (!m) {
      if (/^\s*$/.test(s.slice(i))) break;
      throw new Error(`fake ddb: cannot parse "${s.slice(i)}"`);
    }
    const v = m[1]!;
    out.push(v === "(" || v === ")" || v === "," ? { t: v, v } : v === "=" || v === "<>" ? { t: "op", v } : { t: "id", v });
    i = re.lastIndex;
  }
  return out;
}

const pathOf = (raw: string, names: Names) => raw.split(".").map((p) => (p.startsWith("#") ? (names?.[p] ?? p) : p));

function getPath(item: Item, path: string[]): unknown {
  let cur: unknown = item;
  for (const p of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Item)[p];
  }
  return cur;
}

function setPath(item: Item, path: string[], value: unknown) {
  let cur: Item = item;
  for (const p of path.slice(0, -1)) {
    const next = cur[p];
    if (!next || typeof next !== "object") throw new DdbError("ValidationException");
    cur = next as Item;
  }
  cur[path[path.length - 1]!] = value;
}

function removePath(item: Item, path: string[]) {
  const parent = path.length > 1 ? getPath(item, path.slice(0, -1)) : item;
  if (parent && typeof parent === "object") delete (parent as Item)[path[path.length - 1]!];
}

const equal = (a: unknown, b: unknown) => a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b);

function condition(expr: string | undefined, item: Item | undefined, names: Names, values: Values): boolean {
  if (!expr) return true;
  const tokens = tokenize(expr);
  let i = 0;
  const peek = () => tokens[i];
  const take = () => tokens[i++]!;
  const operand = (): unknown => {
    const tok = take();
    if (tok.v.startsWith(":")) return values?.[tok.v];
    return item ? getPath(item, pathOf(tok.v, names)) : undefined;
  };
  const primary = (): boolean => {
    const tok = peek()!;
    if (tok.t === "(") {
      take();
      const v = or();
      take();
      return v;
    }
    if (tok.v === "NOT") {
      take();
      return !primary();
    }
    if (tok.v === "attribute_exists" || tok.v === "attribute_not_exists" || tok.v === "contains") {
      take();
      take(); // (
      const pathTok = take();
      const path = pathOf(pathTok.v, names);
      let result: boolean;
      if (tok.v === "contains") {
        take(); // ,
        const needle = operand();
        const hay = item ? getPath(item, path) : undefined;
        result = Array.isArray(hay) ? hay.some((h) => equal(h, needle)) : typeof hay === "string" && typeof needle === "string" && hay.includes(needle);
      } else {
        const exists = item !== undefined && getPath(item, path) !== undefined;
        result = tok.v === "attribute_exists" ? exists : !exists;
      }
      take(); // )
      return result;
    }
    const left = operand();
    const op = take().v;
    const right = operand();
    return op === "=" ? equal(left, right) : left !== undefined && !equal(left, right);
  };
  const and = (): boolean => {
    let v = primary();
    while (peek()?.v === "AND") {
      take();
      const r = primary();
      v = v && r;
    }
    return v;
  };
  const or = (): boolean => {
    let v = and();
    while (peek()?.v === "OR") {
      take();
      const r = and();
      v = v || r;
    }
    return v;
  };
  return or();
}

function applyUpdate(item: Item, expr: string, names: Names, values: Values) {
  const tokens = tokenize(expr);
  let i = 0;
  const take = () => tokens[i++]!;
  const peek = () => tokens[i];
  const value = (): unknown => {
    const tok = take();
    if (tok.v.startsWith(":")) return clone(values?.[tok.v]);
    if (tok.v === "if_not_exists" || tok.v === "list_append") {
      take(); // (
      const a = tok.v === "if_not_exists" ? { path: pathOf(take().v, names) } : { v: value() };
      take(); // ,
      const b = value();
      take(); // )
      if ("path" in a) {
        const existing = getPath(item, a.path!);
        return existing === undefined ? b : clone(existing);
      }
      return [...((a.v as unknown[]) ?? []), ...((b as unknown[]) ?? [])];
    }
    return clone(getPath(item, pathOf(tok.v, names)));
  };
  let mode: "SET" | "REMOVE" | undefined;
  while (i < tokens.length) {
    const tok = peek()!;
    if (tok.v === "SET" || tok.v === "REMOVE") {
      mode = tok.v;
      take();
      continue;
    }
    if (tok.t === ",") {
      take();
      continue;
    }
    const path = pathOf(take().v, names);
    if (mode === "REMOVE") removePath(item, path);
    else {
      take(); // =
      setPath(item, path, value());
    }
  }
}

// ---------------------------------------------------------------- client

export class FakeDdb {
  readonly data = new Map<string, Map<string, Item>>();
  constructor(readonly tables: Record<string, FakeTable>) {
    for (const name of Object.keys(tables)) this.data.set(name, new Map());
  }

  private table(name: string) {
    const t = this.data.get(name);
    if (!t) throw new DdbError("ResourceNotFoundException");
    return t;
  }
  private keyOf(name: string, key: Item) {
    return this.tables[name]!.key.map((k) => String(key[k])).join("|");
  }

  put(name: string, item: Item) {
    this.table(name).set(this.keyOf(name, item), clone(item));
  }
  get(name: string, key: Item): Item | undefined {
    return clone(this.table(name).get(this.keyOf(name, key)));
  }
  all(name: string): Item[] {
    return [...this.table(name).values()].map(clone);
  }

  // Checks a write without applying it; returns the apply step
  private prepare(kind: string, input: Item): () => void {
    const name = input.TableName as string;
    const names = input.ExpressionAttributeNames as Names;
    const values = input.ExpressionAttributeValues as Values;
    const t = this.table(name);
    if (kind === "Put") {
      const item = input.Item as Item;
      const k = this.keyOf(name, item);
      if (!condition(input.ConditionExpression as string, t.get(k), names, values)) throw new DdbError("ConditionalCheckFailedException");
      return () => t.set(k, clone(item));
    }
    if (kind === "Update") {
      const key = input.Key as Item;
      const k = this.keyOf(name, key);
      const current = t.get(k);
      if (!condition(input.ConditionExpression as string, current, names, values)) throw new DdbError("ConditionalCheckFailedException");
      const next = clone(current) ?? clone(key);
      applyUpdate(next, input.UpdateExpression as string, names, values);
      return () => t.set(k, next);
    }
    if (kind === "Delete") {
      const k = this.keyOf(name, input.Key as Item);
      if (!condition(input.ConditionExpression as string, t.get(k), names, values)) throw new DdbError("ConditionalCheckFailedException");
      return () => t.delete(k);
    }
    throw new Error(`fake ddb: ${kind} not supported`);
  }

  async send(command: { constructor: { name: string }; input: unknown }): Promise<Item> {
    const input = command.input as Item;
    const kind = command.constructor.name.replace(/Command$/, "");
    switch (kind) {
      case "Put":
      case "Delete":
        this.prepare(kind, input)();
        return {};
      case "Update": {
        this.prepare(kind, input)();
        const item = this.get(input.TableName as string, input.Key as Item);
        return input.ReturnValues === "ALL_NEW" ? { Attributes: item } : {};
      }
      case "Get":
        return { Item: this.get(input.TableName as string, input.Key as Item) };
      case "BatchGet": {
        const Responses: Record<string, Item[]> = {};
        for (const [name, req] of Object.entries(input.RequestItems as Record<string, { Keys: Item[] }>)) {
          Responses[name] = req.Keys.map((k) => this.get(name, k)).filter((x): x is Item => !!x);
        }
        return { Responses, UnprocessedKeys: {} };
      }
      case "Query": {
        const name = input.TableName as string;
        const index = input.IndexName as string | undefined;
        const attr = index ? this.tables[name]!.indexes?.[index] : this.tables[name]!.key[0];
        if (!attr) throw new DdbError("ValidationException");
        const want = Object.values(input.ExpressionAttributeValues as Item)[0];
        // A GSI holds only items that have its key attribute
        return { Items: this.all(name).filter((it) => it[attr] !== undefined && equal(it[attr], want)) };
      }
      case "Scan": {
        const name = input.TableName as string;
        const items = this.all(name).filter((it) =>
          condition(input.FilterExpression as string, it, input.ExpressionAttributeNames as Names, input.ExpressionAttributeValues as Values),
        );
        return { Items: items };
      }
      case "TransactWrite": {
        const steps: (() => void)[] = [];
        for (const op of input.TransactItems as Item[]) {
          const [k, v] = Object.entries(op)[0]!;
          try {
            steps.push(this.prepare(k, v as Item));
          } catch (e) {
            if ((e as Error).name === "ConditionalCheckFailedException") throw new DdbError("TransactionCanceledException");
            throw e;
          }
        }
        for (const s of steps) s();
        return {};
      }
      default:
        throw new Error(`fake ddb: ${kind} not supported`);
    }
  }

  asClient(): DynamoDBDocumentClient {
    return this as unknown as DynamoDBDocumentClient;
  }
}

// The tables of infra/terraform/locals.tf, under the names the tests put in the environment
export const TEST_TABLES = {
  PROPOSALS_TABLE: "proposals",
  ORDERS_TABLE: "orders",
  PARTIES_TABLE: "parties",
  AGENT_STATE_TABLE: "agent_state",
  INGEST_TABLE: "ingest",
};

export function fakeKeelDdb(): FakeDdb {
  return new FakeDdb({
    proposals: { key: ["orderId"], indexes: { byImporter: "importer", byExporter: "exporter" } },
    orders: { key: ["orderId"], indexes: { bySafe: "safe" } },
    parties: { key: ["address"] },
    agent_state: { key: ["id"] },
    ingest: { key: ["pk", "sk"] },
  });
}
