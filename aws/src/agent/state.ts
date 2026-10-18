// What the monitor and the indexer remember between invocations, in agent_state (../tables.ts):
// the next block each one reads, and whether the monitor already paused the gate.
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { type Env, table } from "../config";
import { ddb } from "../db";
import { type AgentStateItem, stateId } from "../tables";

export type CursorName = "monitor" | "indexer";

export async function readCursor(name: CursorName, env: Env = process.env): Promise<bigint | undefined> {
  const { Item } = await ddb().send(new GetCommand({ TableName: table("agentState", env), Key: { id: stateId.cursor(name) } }));
  const block = (Item as AgentStateItem | undefined)?.block;
  return block !== undefined && /^[0-9]+$/.test(block) ? BigInt(block) : undefined;
}

export async function writeCursor(name: CursorName, block: bigint, env: Env = process.env): Promise<void> {
  const item: AgentStateItem = { id: stateId.cursor(name), block: block.toString() };
  await ddb().send(new PutCommand({ TableName: table("agentState", env), Item: item }));
}

export async function readPausedHere(env: Env = process.env): Promise<boolean> {
  const { Item } = await ddb().send(new GetCommand({ TableName: table("agentState", env), Key: { id: stateId.pause() } }));
  return (Item as AgentStateItem | undefined)?.pausedHere === true;
}

export async function writePausedHere(pausedHere: boolean, env: Env = process.env): Promise<void> {
  const item: AgentStateItem = { id: stateId.pause(), pausedHere };
  await ddb().send(new PutCommand({ TableName: table("agentState", env), Item: item }));
}
