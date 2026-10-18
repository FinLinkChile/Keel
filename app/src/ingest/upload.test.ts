/// <reference types="node" />
// Runs in Node (vitest), not in the app

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { UPLOAD_TYPES, uploadDomain } from './upload';

// The app keeps its own copy of the upload types (not in schemas/). Once ingest's trade upload
// is in the tree (area3/trade-ingest, PR #47), this compares both; until then it is skipped.
const INGEST = resolve(__dirname, '../../../ingest/src/trade/upload.ts');

describe.skipIf(!existsSync(INGEST))('upload types match ingest', () => {
  it('has the same domain and DocumentUpload fields', async () => {
    const ingest = await import(/* @vite-ignore */ INGEST);
    expect(UPLOAD_TYPES).toEqual(ingest.UPLOAD_TYPES);
    expect(uploadDomain(31337)).toEqual(ingest.uploadDomain(31337));
    // Importing ingest is slow on a cold cache
  }, 30_000);
});
