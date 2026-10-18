// In-memory stand-ins for DynamoDB (DocumentClient), S3 and SQS, for unit tests without AWS.
// The DynamoDB fake understands exactly the expressions the handlers use: `a = :v`, `a < :v`,
// attribute_exists / attribute_not_exists, joined by AND or OR (not both), names with `#` and
// nested paths (`#chain.#state`), `SET #a = :v` updates, and a Query on one key equality.
import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { BatchGetCommand, DeleteCommand, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

type Item = Record<string, any>;
type Names = Record<string, string> | undefined;
type Values = Record<string, unknown> | undefined;

// Key attribute of each table, by the table name tests give in the environment
export const TEST_ENV = {
  KEEL_CHAIN_ID: "1",
  ORDERS_TABLE: "orders",
  PARTIES_TABLE: "parties",
  AGENT_STATE_TABLE: "agent_state",
  EVIDENCE_BUCKET: "evidence",
  AGENT_QUEUE_URL: "https://sqs.test/agent.fifo",
  NOTICES_QUEUE_URL: "https://sqs.test/notices",
};
const KEYS: Record<string, string> = { orders: "orderId", parties: "address", agent_state: "id" };

const conditionFailed = () => Object.assign(new Error("The conditional request failed"), { name: "ConditionalCheckFailedException" });
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

function resolvePath(item: Item | undefined, path: string, names: Names): unknown {
  let value: any = item;
  for (const part of path.trim().split(".")) {
    const name = part.startsWith("#") ? names?.[part] : part;
    if (name === undefined) throw new Error(`unknown name ${part}`);
    value = value?.[name];
  }
  return value;
}

function evaluate(item: Item | undefined, expression: string | undefined, names: Names, values: Values): boolean {
  if (!expression) return true;
  if (expression.includes(" OR ")) return expression.split(" OR ").some((e) => evaluate(item, e, names, values));
  if (expression.includes(" AND ")) return expression.split(" AND ").every((e) => evaluate(item, e, names, values));
  const e = expression.trim();
  const fn = /^(attribute_exists|attribute_not_exists)\((.+)\)$/.exec(e);
  if (fn) {
    const present = resolvePath(item, fn[2]!, names) !== undefined;
    return fn[1] === "attribute_exists" ? present : !present;
  }
  const cmp = /^(.+?)\s*(=|<)\s*(:\w+)$/.exec(e);
  if (!cmp) throw new Error(`unsupported expression ${e}`);
  const left = resolvePath(item, cmp[1]!, names) as any;
  const right = values?.[cmp[3]!] as any;
  if (left === undefined) return false;
  return cmp[2] === "=" ? JSON.stringify(left) === JSON.stringify(right) : left < right;
}

export class FakeDynamo {
  readonly tables = new Map<string, Map<string, Item>>();
  readonly commands: string[] = [];

  table(name: string): Map<string, Item> {
    let t = this.tables.get(name);
    if (!t) this.tables.set(name, (t = new Map()));
    return t;
  }

  put(name: string, item: Item) {
    this.table(name).set(String(item[KEYS[name]!]), clone(item));
  }

  get(name: string, key: string): Item | undefined {
    return clone(this.table(name).get(key));
  }

  private keyOf(name: string, key: Item) {
    return String(key[KEYS[name]!]);
  }

  async send(command: unknown): Promise<any> {
    this.commands.push((command as object).constructor.name);
    if (command instanceof PutCommand) {
      const { TableName, Item: item, ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues } = command.input;
      const key = this.keyOf(TableName!, item!);
      if (!evaluate(this.table(TableName!).get(key), ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues)) throw conditionFailed();
      this.table(TableName!).set(key, clone(item!));
      return {};
    }
    if (command instanceof GetCommand) {
      return { Item: clone(this.table(command.input.TableName!).get(this.keyOf(command.input.TableName!, command.input.Key!))) };
    }
    if (command instanceof DeleteCommand) {
      const { TableName, Key, ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues } = command.input;
      const key = this.keyOf(TableName!, Key!);
      if (!evaluate(this.table(TableName!).get(key), ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues)) throw conditionFailed();
      this.table(TableName!).delete(key);
      return {};
    }
    if (command instanceof UpdateCommand) {
      const { TableName, Key, UpdateExpression, ConditionExpression, ExpressionAttributeNames: names, ExpressionAttributeValues: values } = command.input;
      const key = this.keyOf(TableName!, Key!);
      const current = this.table(TableName!).get(key);
      if (!evaluate(current, ConditionExpression, names, values)) throw conditionFailed();
      const next: Item = clone(current) ?? { ...Key };
      const set = /^SET (.+)$/.exec(UpdateExpression ?? "");
      if (!set) throw new Error(`unsupported update ${UpdateExpression}`);
      for (const assignment of set[1]!.split(",")) {
        const [path, value] = assignment.split("=").map((s) => s.trim());
        next[path!.startsWith("#") ? names![path!]! : path!] = clone(values![value!]);
      }
      this.table(TableName!).set(key, next);
      return {};
    }
    if (command instanceof QueryCommand) {
      const { TableName, KeyConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues } = command.input;
      const items = [...this.table(TableName!).values()].filter((i) => evaluate(i, KeyConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues));
      return { Items: clone(items) };
    }
    if (command instanceof ScanCommand) {
      return { Items: clone([...this.table(command.input.TableName!).values()]) };
    }
    if (command instanceof BatchGetCommand) {
      const Responses: Record<string, Item[]> = {};
      for (const [name, { Keys }] of Object.entries(command.input.RequestItems!)) {
        Responses[name] = Keys!.map((k) => this.table(name).get(this.keyOf(name, k))).filter((i): i is Item => i !== undefined).map(clone);
      }
      return { Responses };
    }
    throw new Error(`FakeDynamo: unsupported command ${(command as object).constructor.name}`);
  }
}

export class FakeS3 {
  readonly objects = new Map<string, string>();
  readonly log: string[] = [];
  async send(command: unknown): Promise<any> {
    if (command instanceof PutObjectCommand) {
      this.log.push(`put ${command.input.Key}`);
      this.objects.set(`${command.input.Bucket}/${command.input.Key}`, String(command.input.Body));
      return {};
    }
    if (command instanceof HeadObjectCommand) {
      if (this.objects.has(`${command.input.Bucket}/${command.input.Key}`)) return {};
      throw Object.assign(new Error("Not Found"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
    }
    throw new Error("FakeS3: unsupported command");
  }
}

export class FakeSqs {
  readonly sent: Record<string, any>[] = [];
  async send(command: unknown): Promise<any> {
    if (command instanceof SendMessageCommand) {
      this.sent.push(command.input);
      return { MessageId: String(this.sent.length) };
    }
    throw new Error("FakeSqs: unsupported command");
  }
}
