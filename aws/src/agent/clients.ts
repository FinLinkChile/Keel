// S3 and SQS clients of the agent, monitor, indexer and fan-out handlers, one per container.
// Tests inject fakes; the DynamoDB client is ../db.ts (setDdb), the notices queue ../notices.ts.
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";

export type Sender = { send(command: any): Promise<any> };

let s3: Sender | undefined;
let sqs: Sender | undefined;

export const s3Client = (): Sender => (s3 ??= new S3Client({}));
export const sqsClient = (): Sender => (sqs ??= new SQSClient({}));

export function setS3(c: Sender | undefined) {
  s3 = c;
}

// The agent queue of the fan-out. Notices go through ../notices.ts and its own client.
export function setAgentSqs(c: Sender | undefined) {
  sqs = c;
}

// One JSON line per event, the format CloudWatch Logs Insights queries. Bigints as strings.
export const logLine = (line: Record<string, unknown>) => console.log(JSON.stringify(line, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
