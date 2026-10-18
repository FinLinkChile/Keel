// The fake must refuse what DynamoDB refuses, or the repo tests prove nothing
import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vitest";
import { FakeDynamo } from "./fakeDynamo";

const T = "t";
const db = () => new FakeDynamo({ [T]: { pk: "pk", sk: "sk" } });

describe("FakeDynamo", () => {
  it("fails a conditional put on an existing item, and leaves it unchanged", async () => {
    const d = db();
    await d.send(new PutCommand({ TableName: T, Item: { pk: "a", sk: "1", v: 1 }, ConditionExpression: "attribute_not_exists(pk)" }));
    await expect(
      d.send(new PutCommand({ TableName: T, Item: { pk: "a", sk: "1", v: 2 }, ConditionExpression: "attribute_not_exists(pk)" })),
    ).rejects.toMatchObject({ name: "ConditionalCheckFailedException" });
    expect(d.get(T, { pk: "a", sk: "1" })).toEqual({ pk: "a", sk: "1", v: 1 });
  });

  it("cancels a whole transaction with one reason per item", async () => {
    const d = db();
    await d.send(new PutCommand({ TableName: T, Item: { pk: "a", sk: "1" } }));
    const err = await d
      .send(
        new TransactWriteCommand({
          TransactItems: [
            { Put: { TableName: T, Item: { pk: "b", sk: "1" }, ConditionExpression: "attribute_not_exists(pk)" } },
            { Put: { TableName: T, Item: { pk: "a", sk: "1" }, ConditionExpression: "attribute_not_exists(pk)" } },
          ],
        }),
      )
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ name: "TransactionCanceledException", CancellationReasons: [{ Code: "None" }, { Code: "ConditionalCheckFailed" }] });
    expect(d.get(T, { pk: "b", sk: "1" })).toBeUndefined();
  });

  it("refuses two operations on one item in a transaction, and unused expression values", async () => {
    const d = db();
    const put = { Put: { TableName: T, Item: { pk: "a", sk: "1" } } };
    await expect(d.send(new TransactWriteCommand({ TransactItems: [put, put] }))).rejects.toMatchObject({ name: "ValidationException" });
    await expect(
      d.send(new PutCommand({ TableName: T, Item: { pk: "a", sk: "1" }, ExpressionAttributeValues: { ":x": 1 } })),
    ).rejects.toMatchObject({ name: "ValidationException" });
  });

  it("evaluates counters with a ceiling, and nested updates only under existing maps", async () => {
    const d = db();
    const inc = () =>
      d.send(
        new UpdateCommand({
          TableName: T,
          Key: { pk: "c", sk: "1" },
          UpdateExpression: "ADD #n :one",
          ConditionExpression: "attribute_not_exists(#n) OR #n < :max",
          ExpressionAttributeNames: { "#n": "n" },
          ExpressionAttributeValues: { ":one": 1, ":max": 2 },
        }),
      );
    await inc();
    await inc();
    await expect(inc()).rejects.toMatchObject({ name: "ConditionalCheckFailedException" });
    expect(d.get(T, { pk: "c", sk: "1" })).toMatchObject({ n: 2 });
    await expect(
      d.send(
        new UpdateCommand({ TableName: T, Key: { pk: "c", sk: "1" }, UpdateExpression: "SET m.x = :v", ExpressionAttributeValues: { ":v": 1 } }),
      ),
    ).rejects.toMatchObject({ name: "ValidationException" });
  });

  it("queries one partition in sort key order, and needs the partition key", async () => {
    const d = db();
    for (const sk of ["b", "a", "c"]) await d.send(new PutCommand({ TableName: T, Item: { pk: "p", sk } }));
    await d.send(new PutCommand({ TableName: T, Item: { pk: "q", sk: "a" } }));
    const r = (await d.send(
      new QueryCommand({ TableName: T, KeyConditionExpression: "pk = :p AND sk >= :s", ExpressionAttributeValues: { ":p": "p", ":s": "b" } }),
    )) as { Items: { sk: string }[] };
    expect(r.Items.map((i) => i.sk)).toEqual(["b", "c"]);
    await expect(
      d.send(new QueryCommand({ TableName: T, KeyConditionExpression: "sk = :s", ExpressionAttributeValues: { ":s": "a" } })),
    ).rejects.toMatchObject({ name: "ValidationException" });
    expect(await d.send(new GetCommand({ TableName: T, Key: { pk: "z", sk: "z" } }))).toEqual({});
  });
});
