// Reads notices from a JSON file (demo and tests): one notice or an array of them.
// Each one still goes through NotifyService validation: the file is not trusted more than HTTP.
import { readFile } from "node:fs/promises";

export async function readNotices(file: string): Promise<unknown[]> {
  const json: unknown = JSON.parse(await readFile(file, "utf8"));
  return Array.isArray(json) ? json : [json];
}
