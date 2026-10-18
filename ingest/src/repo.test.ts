import { IngestStore } from "./store";
import { describeIngestRepo } from "./testing/repoContract";

describeIngestRepo("IngestStore (node:sqlite)", (now) => new IngestStore(":memory:", now));
