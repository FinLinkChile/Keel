// An in-memory DynamoDB DocumentClient for tests: Put, Get, Update, Delete, Query and
// TransactWrite, with the expression language the handlers use, evaluated rather than assumed.
// It keeps DynamoDB's rules that the code relies on, so a test cannot pass on a write that the
// real service would refuse:
//   - a failed ConditionExpression throws ConditionalCheckFailedException;
//   - a transaction is all or nothing, throws TransactionCanceledException with one
//     CancellationReasons entry per item, and may not touch the same item twice;
//   - names and values in ExpressionAttributeNames/Values must all be used;
//   - key attributes must be present and non-empty; items are at most 400 KB;
//   - Query needs the partition key with "=" and returns items ordered by sort key.
// Not modelled: secondary indexes, BETWEEN, size(), sets, throttling.
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

type Item = Record<string, unknown>;
type Names = Record<string, string> | undefined;
type Values = Record<string, unknown> | undefined;

export interface TableKey {
  pk: string;
  sk?: string;
}

const fail = (name: string, message: string, extra: object = {}) => Object.assign(new Error(message), { name, ...extra });
const validation = (message: string) => fail("ValidationException", message);

// ---------------------------------------------------------------- expressions

type Token = { t: "name" | "value" | "ident" | "num" | "op" | "punct"; v: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  const re = /\s*(?:(#[\w]+)|(:[\w]+)|([A-Za-z_][\w]*)|(\d+)|(<>|<=|>=|=|<|>|\+|-)|([(),.\[\]]))/y;
  let i = 0;
  while (i < src.length) {
    if (/^\s*$/.test(src.slice(i))) break;
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw validation(`cannot parse expression near "${src.slice(i, i + 20)}"`);
    i = re.lastIndex;
    if (m[1]) out.push({ t: "name", v: m[1] });
    else if (m[2]) out.push({ t: "value", v: m[2] });
    else if (m[3]) out.push({ t: "ident", v: m[3] });
    else if (m[4]) out.push({ t: "num", v: m[4] });
    else if (m[5]) out.push({ t: "op", v: m[5] });
    else out.push({ t: "punct", v: m[6]! });
  }
  return out;
}

type PathPart = string | number;
type Operand = { kind: "path"; path: PathPart[] } | { kind: "value"; name: string };
type Cond =
  | { kind: "and" | "or"; a: Cond; b: Cond }
  | { kind: "not"; a: Cond }
  | { kind: "cmp"; op: string; a: Operand; b: Operand }
  | { kind: "fn"; fn: string; args: Operand[] };

class Parser {
  private i = 0;
  readonly usedNames = new Set<string>();
  readonly usedValues = new Set<string>();

  constructor(
    private readonly tokens: Token[],
    private readonly names: Names,
  ) {}

  private peek(): Token | undefined {
    return this.tokens[this.i];
  }

  private next(): Token {
    const t = this.tokens[this.i++];
    if (!t) throw validation("unexpected end of expression");
    return t;
  }

  private expect(v: string): void {
    const t = this.next();
    if (t.v !== v) throw validation(`expected "${v}", found "${t.v}"`);
  }

  private keyword(word: string): boolean {
    const t = this.peek();
    if (t?.t === "ident" && t.v.toUpperCase() === word) {
      this.i++;
      return true;
    }
    return false;
  }

  done(): boolean {
    return this.i >= this.tokens.length;
  }

  path(): PathPart[] {
    const parts: PathPart[] = [this.segment()];
    for (;;) {
      const t = this.peek();
      if (t?.v === ".") {
        this.i++;
        parts.push(this.segment());
      } else if (t?.v === "[") {
        this.i++;
        parts.push(Number(this.next().v));
        this.expect("]");
      } else return parts;
    }
  }

  private segment(): string {
    const t = this.next();
    if (t.t === "name") {
      const real = this.names?.[t.v];
      if (real === undefined) throw validation(`undefined attribute name ${t.v}`);
      this.usedNames.add(t.v);
      return real;
    }
    if (t.t === "ident") return t.v;
    throw validation(`expected an attribute path, found "${t.v}"`);
  }

  operand(): Operand {
    const t = this.peek();
    if (t?.t === "value") {
      this.i++;
      this.usedValues.add(t.v);
      return { kind: "value", name: t.v };
    }
    return { kind: "path", path: this.path() };
  }

  condition(): Cond {
    let a = this.and();
    while (this.keyword("OR")) a = { kind: "or", a, b: this.and() };
    return a;
  }

  private and(): Cond {
    let a = this.not();
    while (this.keyword("AND")) a = { kind: "and", a, b: this.not() };
    return a;
  }

  private not(): Cond {
    if (this.keyword("NOT")) return { kind: "not", a: this.not() };
    return this.primary();
  }

  private primary(): Cond {
    const t = this.peek();
    if (t?.v === "(") {
      this.i++;
      const c = this.condition();
      this.expect(")");
      return c;
    }
    const fn = t?.t === "ident" ? t.v : "";
    if (["attribute_exists", "attribute_not_exists", "begins_with", "contains"].includes(fn) && this.tokens[this.i + 1]?.v === "(") {
      this.i += 2;
      const args = [this.operand()];
      while (this.peek()?.v === ",") {
        this.i++;
        args.push(this.operand());
      }
      this.expect(")");
      return { kind: "fn", fn, args };
    }
    const a = this.operand();
    const op = this.next();
    if (op.t !== "op" || op.v === "+" || op.v === "-") throw validation(`expected a comparator, found "${op.v}"`);
    return { kind: "cmp", op: op.v, a, b: this.operand() };
  }
}

function getPath(item: Item, path: PathPart[]): unknown {
  let cur: unknown = item;
  for (const p of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[p];
  }
  return cur;
}

function setPath(item: Item, path: PathPart[], value: unknown): void {
  let cur: Record<string | number, unknown> = item;
  for (const p of path.slice(0, -1)) {
    const nextValue = cur[p];
    // DynamoDB refuses to create intermediate maps
    if (nextValue === null || typeof nextValue !== "object") throw validation("the document path provided in the update expression is invalid for update");
    cur = nextValue as Record<string | number, unknown>;
  }
  cur[path.at(-1)!] = value;
}

function removePath(item: Item, path: PathPart[]): void {
  const parent = getPath(item, path.slice(0, -1));
  if (parent && typeof parent === "object") {
    if (Array.isArray(parent) && typeof path.at(-1) === "number") parent.splice(path.at(-1) as number, 1);
    else delete (parent as Record<string | number, unknown>)[path.at(-1)!];
  }
}

function value(op: Operand, item: Item, values: Values): unknown {
  return op.kind === "value" ? values?.[op.name] : getPath(item, op.path);
}

function sameType(a: unknown, b: unknown): boolean {
  return (typeof a === "number" && typeof b === "number") || (typeof a === "string" && typeof b === "string");
}

function evaluate(c: Cond, item: Item, values: Values): boolean {
  switch (c.kind) {
    case "and":
      return evaluate(c.a, item, values) && evaluate(c.b, item, values);
    case "or":
      return evaluate(c.a, item, values) || evaluate(c.b, item, values);
    case "not":
      return !evaluate(c.a, item, values);
    case "fn": {
      const [first, second] = c.args;
      if (c.fn === "attribute_exists") return getPath(item, (first as { path: PathPart[] }).path) !== undefined;
      if (c.fn === "attribute_not_exists") return getPath(item, (first as { path: PathPart[] }).path) === undefined;
      const a = value(first!, item, values);
      const b = value(second!, item, values);
      if (c.fn === "begins_with") return typeof a === "string" && typeof b === "string" && a.startsWith(b);
      if (Array.isArray(a)) return a.some((x) => JSON.stringify(x) === JSON.stringify(b));
      return typeof a === "string" && typeof b === "string" && a.includes(b);
    }
    case "cmp": {
      const a = value(c.a, item, values);
      const b = value(c.b, item, values);
      if (c.op === "=") return a !== undefined && JSON.stringify(a) === JSON.stringify(b);
      if (c.op === "<>") return a !== undefined && JSON.stringify(a) !== JSON.stringify(b);
      if (!sameType(a, b)) return false;
      const x = a as number | string;
      const y = b as number | string;
      return c.op === "<" ? x < y : c.op === "<=" ? x <= y : c.op === ">" ? x > y : x >= y;
    }
  }
}

function checkUsage(parsers: Parser[], names: Names, values: Values): void {
  for (const n of Object.keys(names ?? {})) {
    if (!parsers.some((p) => p.usedNames.has(n))) throw validation(`unused attribute name ${n}`);
  }
  for (const v of Object.keys(values ?? {})) {
    if (!parsers.some((p) => p.usedValues.has(v))) throw validation(`unused attribute value ${v}`);
  }
}

function parseCondition(expr: string | undefined, names: Names): { parser: Parser; cond?: Cond } {
  const parser = new Parser(expr ? tokenize(expr) : [], names);
  if (!expr) return { parser };
  const cond = parser.condition();
  if (!parser.done()) throw validation("trailing tokens in condition");
  return { parser, cond };
}

type UpdateAction =
  | { kind: "set"; path: PathPart[]; value: (item: Item) => unknown }
  | { kind: "add"; path: PathPart[]; value: Operand }
  | { kind: "remove"; path: PathPart[] };

function parseUpdate(expr: string, names: Names, values: Values): { parser: Parser; actions: UpdateAction[] } {
  const tokens = tokenize(expr);
  const parser = new Parser(tokens, names);
  const actions: UpdateAction[] = [];
  const p = parser as unknown as { i: number; tokens: Token[] };
  const peekIdent = () => {
    const t = p.tokens[p.i];
    return t?.t === "ident" ? t.v.toUpperCase() : undefined;
  };
  const setValue = (): ((item: Item) => unknown) => {
    const t = p.tokens[p.i];
    if (t?.t === "ident" && (t.v === "if_not_exists" || t.v === "list_append") && p.tokens[p.i + 1]?.v === "(") {
      p.i += 2;
      const a = parser.operand();
      if (p.tokens[p.i++]?.v !== ",") throw validation("expected ,");
      const b = parser.operand();
      if (p.tokens[p.i++]?.v !== ")") throw validation("expected )");
      if (t.v === "if_not_exists") return (item) => value(a, item, values) ?? value(b, item, values);
      return (item) => {
        const x = value(a, item, values);
        const y = value(b, item, values);
        if (!Array.isArray(x) || !Array.isArray(y)) throw validation("list_append needs two lists");
        return [...x, ...y];
      };
    }
    const a = parser.operand();
    const op = p.tokens[p.i];
    if (op?.v === "+" || op?.v === "-") {
      p.i++;
      const b = parser.operand();
      return (item) => {
        const x = value(a, item, values);
        const y = value(b, item, values);
        if (typeof x !== "number" || typeof y !== "number") throw validation("arithmetic needs two numbers");
        return op.v === "+" ? x + y : x - y;
      };
    }
    return (item) => value(a, item, values);
  };
  while (p.i < p.tokens.length) {
    const clause = peekIdent();
    if (clause !== "SET" && clause !== "ADD" && clause !== "REMOVE") throw validation(`unknown update clause near ${clause}`);
    p.i++;
    do {
      if (p.tokens[p.i]?.v === ",") p.i++;
      const path = parser.path();
      if (clause === "SET") {
        if (p.tokens[p.i++]?.v !== "=") throw validation("expected = in SET");
        actions.push({ kind: "set", path, value: setValue() });
      } else if (clause === "ADD") {
        actions.push({ kind: "add", path, value: parser.operand() });
      } else {
        actions.push({ kind: "remove", path });
      }
    } while (p.tokens[p.i]?.v === ",");
  }
  return { parser, actions };
}

function applyUpdate(item: Item, actions: UpdateAction[], values: Values): Item {
  // Values are computed from the item as it was before this update, like DynamoDB does
  const before = structuredClone(item);
  const next = structuredClone(item);
  for (const a of actions) {
    if (a.kind === "set") setPath(next, a.path, a.value(before));
    else if (a.kind === "remove") removePath(next, a.path);
    else {
      const add = value(a.value, before, values);
      const cur = getPath(before, a.path);
      if (typeof add !== "number" || (cur !== undefined && typeof cur !== "number")) throw validation("ADD needs numbers");
      setPath(next, a.path, (cur ?? 0) + add);
    }
  }
  return next;
}

// ---------------------------------------------------------------- the client

function clean<T>(v: T): T {
  // The document client of aws/src/db.ts removes undefined values
  return JSON.parse(JSON.stringify(v)) as T;
}

export class FakeDynamo {
  private readonly data = new Map<string, Map<string, Item>>();
  // Every command received, for tests that check what was written
  readonly log: { command: string; input: unknown }[] = [];

  constructor(private readonly tables: Record<string, TableKey>) {}

  private table(name: string): { key: TableKey; items: Map<string, Item> } {
    const key = this.tables[name];
    if (!key) throw fail("ResourceNotFoundException", `table ${name} not found`);
    let items = this.data.get(name);
    if (!items) this.data.set(name, (items = new Map()));
    return { key, items };
  }

  // `k` is a Key (exactly the key attributes) or, for a Put, a whole item
  private id(key: TableKey, k: Item, isKey = true): string {
    const pk = k[key.pk];
    const sk = key.sk ? k[key.sk] : "";
    if (pk === undefined || pk === "" || (key.sk && (sk === undefined || sk === ""))) throw validation("missing or empty key attribute");
    if (isKey && Object.keys(k).some((a) => a !== key.pk && a !== key.sk)) throw validation("the provided key element does not match the schema");
    return JSON.stringify([pk, sk]);
  }

  // All items of a table, for assertions
  items(name: string): Item[] {
    return [...this.table(name).items.values()].map((i) => structuredClone(i));
  }

  get(name: string, key: Item): Item | undefined {
    const t = this.table(name);
    const item = t.items.get(this.id(t.key, key));
    return item && structuredClone(item);
  }

  async send(command: unknown): Promise<unknown> {
    // One step at a time, like the service: every command applies atomically
    await Promise.resolve();
    const name = (command as { constructor: { name: string } }).constructor.name;
    const input = structuredClone((command as { input: unknown }).input) as Item;
    this.log.push({ command: name, input });
    if (command instanceof PutCommand) return this.put(input);
    if (command instanceof GetCommand) return this.getCmd(input);
    if (command instanceof UpdateCommand) return this.update(input);
    if (command instanceof DeleteCommand) return this.delete(input);
    if (command instanceof QueryCommand) return this.query(input);
    if (command instanceof TransactWriteCommand) return this.transact(input);
    throw new Error(`FakeDynamo does not implement ${name}`);
  }

  // Each write is prepared (validated and its condition evaluated) before anything changes
  private preparePut(input: Item): { table: string; id: string; check: () => boolean; apply: () => void } {
    const t = this.table(input.TableName as string);
    const item = clean(input.Item as Item);
    const id = this.id(t.key, item, false);
    if (JSON.stringify(item).length > 400 * 1024) throw validation("item size has exceeded the maximum allowed size");
    const { parser, cond } = parseCondition(input.ConditionExpression as string | undefined, input.ExpressionAttributeNames as Names);
    checkUsage([parser], input.ExpressionAttributeNames as Names, input.ExpressionAttributeValues as Values);
    return {
      table: input.TableName as string,
      id,
      check: () => !cond || evaluate(cond, t.items.get(id) ?? {}, input.ExpressionAttributeValues as Values),
      apply: () => void t.items.set(id, item),
    };
  }

  private prepareUpdate(input: Item): { table: string; id: string; check: () => boolean; apply: () => Item; before: () => Item | undefined } {
    const t = this.table(input.TableName as string);
    const key = input.Key as Item;
    const id = this.id(t.key, key);
    const names = input.ExpressionAttributeNames as Names;
    const values = input.ExpressionAttributeValues as Values;
    const { parser: up, actions } = parseUpdate(input.UpdateExpression as string, names, values);
    const { parser: cp, cond } = parseCondition(input.ConditionExpression as string | undefined, names);
    checkUsage([up, cp], names, values);
    for (const a of actions) {
      if (a.path[0] === t.key.pk || a.path[0] === t.key.sk) throw validation("cannot update a key attribute");
    }
    return {
      table: input.TableName as string,
      id,
      before: () => t.items.get(id),
      check: () => !cond || evaluate(cond, t.items.get(id) ?? {}, values),
      apply: () => {
        const next = clean(applyUpdate(t.items.get(id) ?? clean(key), actions, values));
        if (JSON.stringify(next).length > 400 * 1024) throw validation("item size has exceeded the maximum allowed size");
        t.items.set(id, next);
        return next;
      },
    };
  }

  private prepareDelete(input: Item): { table: string; id: string; check: () => boolean; apply: () => void } {
    const t = this.table(input.TableName as string);
    const id = this.id(t.key, input.Key as Item);
    const { parser, cond } = parseCondition(input.ConditionExpression as string | undefined, input.ExpressionAttributeNames as Names);
    checkUsage([parser], input.ExpressionAttributeNames as Names, input.ExpressionAttributeValues as Values);
    return {
      table: input.TableName as string,
      id,
      check: () => !cond || evaluate(cond, t.items.get(id) ?? {}, input.ExpressionAttributeValues as Values),
      apply: () => void t.items.delete(id),
    };
  }

  private prepareCheck(input: Item): { table: string; id: string; check: () => boolean; apply: () => void } {
    const t = this.table(input.TableName as string);
    const id = this.id(t.key, input.Key as Item);
    const { parser, cond } = parseCondition(input.ConditionExpression as string, input.ExpressionAttributeNames as Names);
    if (!cond) throw validation("ConditionCheck needs a condition");
    checkUsage([parser], input.ExpressionAttributeNames as Names, input.ExpressionAttributeValues as Values);
    return { table: input.TableName as string, id, check: () => evaluate(cond, t.items.get(id) ?? {}, input.ExpressionAttributeValues as Values), apply: () => {} };
  }

  private conditionFailed(): never {
    throw fail("ConditionalCheckFailedException", "The conditional request failed");
  }

  private put(input: Item) {
    const op = this.preparePut(input);
    if (!op.check()) this.conditionFailed();
    op.apply();
    return {};
  }

  private getCmd(input: Item) {
    if (input.ProjectionExpression) throw new Error("FakeDynamo does not implement ProjectionExpression");
    const item = this.get(input.TableName as string, input.Key as Item);
    return item ? { Item: item } : {};
  }

  private update(input: Item) {
    const op = this.prepareUpdate(input);
    if (!op.check()) this.conditionFailed();
    const before = op.before();
    const after = op.apply();
    const rv = input.ReturnValues as string | undefined;
    if (rv === "ALL_NEW") return { Attributes: structuredClone(after) };
    if (rv === "UPDATED_NEW") {
      const changed = Object.fromEntries(Object.entries(after).filter(([k, v]) => JSON.stringify(before?.[k]) !== JSON.stringify(v)));
      return { Attributes: changed };
    }
    if (rv && rv !== "NONE") throw new Error(`FakeDynamo does not implement ReturnValues ${rv}`);
    return {};
  }

  private delete(input: Item) {
    const op = this.prepareDelete(input);
    if (!op.check()) this.conditionFailed();
    op.apply();
    return {};
  }

  private query(input: Item) {
    if (input.IndexName) throw new Error("FakeDynamo does not implement secondary indexes");
    const t = this.table(input.TableName as string);
    const names = input.ExpressionAttributeNames as Names;
    const values = input.ExpressionAttributeValues as Values;
    const { parser: kp, cond: keyCond } = parseCondition(input.KeyConditionExpression as string, names);
    const { parser: fp, cond: filter } = parseCondition(input.FilterExpression as string | undefined, names);
    checkUsage([kp, fp], names, values);
    if (!keyCond || !hasPartitionEquality(keyCond, t.key.pk)) throw validation("Query condition missed key schema element");
    let items = [...t.items.values()].filter((i) => evaluate(keyCond, i, values));
    const sk = t.key.sk;
    if (sk) items.sort((a, b) => (String(a[sk]) < String(b[sk]) ? -1 : String(a[sk]) > String(b[sk]) ? 1 : 0));
    if (input.ScanIndexForward === false) items.reverse();
    const start = input.ExclusiveStartKey as Item | undefined;
    if (start) {
      const at = items.findIndex((i) => i[t.key.pk] === start[t.key.pk] && (!sk || i[sk] === start[sk]));
      items = items.slice(at + 1);
    }
    const limit = input.Limit as number | undefined;
    const page = limit ? items.slice(0, limit) : items;
    const last = limit && items.length > limit ? page.at(-1) : undefined;
    const out = filter ? page.filter((i) => evaluate(filter, i, values)) : page;
    return {
      Items: out.map((i) => structuredClone(i)),
      Count: out.length,
      ...(last ? { LastEvaluatedKey: pickKey(t.key, last) } : {}),
    };
  }

  private transact(input: Item) {
    const items = input.TransactItems as Item[];
    if (!Array.isArray(items) || items.length === 0 || items.length > 100) throw validation("TransactItems must have 1 to 100 items");
    const ops = items.map((ti) => {
      if (ti.Put) return this.preparePut(ti.Put as Item);
      if (ti.Update) return this.prepareUpdate(ti.Update as Item);
      if (ti.Delete) return this.prepareDelete(ti.Delete as Item);
      if (ti.ConditionCheck) return this.prepareCheck(ti.ConditionCheck as Item);
      throw validation("unknown transaction item");
    });
    const seen = new Set(ops.map((o) => `${o.table}|${o.id}`));
    if (seen.size !== ops.length) throw validation("Transaction request cannot include multiple operations on one item");
    const results = ops.map((o) => o.check());
    if (results.some((ok) => !ok)) {
      throw fail("TransactionCanceledException", "Transaction cancelled", {
        CancellationReasons: results.map((ok) => (ok ? { Code: "None" } : { Code: "ConditionalCheckFailed", Message: "The conditional request failed" })),
      });
    }
    // Applied on a copy first, so a validation error in one item changes nothing
    const snapshot = new Map([...this.data].map(([k, v]) => [k, new Map([...v].map(([id, item]) => [id, structuredClone(item)]))]));
    try {
      for (const o of ops) o.apply();
    } catch (e) {
      this.data.clear();
      for (const [k, v] of snapshot) this.data.set(k, v);
      throw e;
    }
    return {};
  }
}

function pickKey(key: TableKey, item: Item): Item {
  return key.sk ? { [key.pk]: item[key.pk], [key.sk]: item[key.sk] } : { [key.pk]: item[key.pk] };
}

function hasPartitionEquality(c: Cond, pk: string): boolean {
  if (c.kind === "and") return hasPartitionEquality(c.a, pk) || hasPartitionEquality(c.b, pk);
  return c.kind === "cmp" && c.op === "=" && c.a.kind === "path" && c.a.path.length === 1 && c.a.path[0] === pk;
}
