// Sends the notices of one JSON file and exits.
//   npm run notify -w bot -- examples/act2-document-fraud.json
import { readNotices } from "./adapters/inbound/file-source";
import { compose, logJson } from "./main";

const file = process.argv[2];
if (!file) {
  console.error("usage: npm run notify -w bot -- <notices.json>");
  process.exit(2);
}

const { service } = await compose();
for (const notice of await readNotices(file)) await service.notify(notice);
logJson({ event: "done", file, ...service.stats() });
