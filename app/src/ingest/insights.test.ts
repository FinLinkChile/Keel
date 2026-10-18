import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { METRIC_KINDS, type AnalysisInput } from '../data/analysisInput';
import { displayText, metricLabel } from '../data/analysisText';

import { INSIGHTS_TYPES, readInsightsResponse } from './insights';

const INPUT: AnalysisInput = {
  role: 'importer',
  profile: null,
  asOf: '2026-10-17',
  metrics: [{ id: 'm2', kind: 'top_counterparty_share_pct', value: 71.4, unit: 'pct', subject: 'S1', period: 'last_365d' }],
};
const finding = (patch: object = {}) => ({
  kind: 'dependency',
  severity: 'attention',
  metric_ids: ['m2'],
  title: 'S1 carries 71% of your spend',
  recommendation: 'Validate a second supplier.',
  ...patch,
});
const read = (status: number, body: unknown) => readInsightsResponse(status, body, INPUT, 1);

describe('insights client', () => {
  it('shows findings that cite the metrics sent', () => {
    expect(read(200, { status: 'ok', inputHash: '0x', findings: [finding()] })).toEqual({ kind: 'ok', findings: [finding()], at: 1 });
  });

  it('rejects an answer with an unknown metric, an address, an extra field or too many findings', () => {
    const failed = { kind: 'failed', reason: 'server' };
    expect(read(200, { status: 'ok', findings: [finding({ metric_ids: ['m9'] })] })).toEqual(failed);
    expect(read(200, { status: 'ok', findings: [finding({ recommendation: 'Pay 0x1111111111111111' })] })).toEqual(failed);
    expect(read(200, { status: 'ok', findings: [finding({ note: 'x' })] })).toEqual(failed);
    expect(read(200, { status: 'ok', findings: Array(6).fill(finding()) })).toEqual(failed);
  });

  it('maps refusals and model failures', () => {
    expect(read(429, { status: 'rejected', reason: 'rate_limited' })).toEqual({ kind: 'rejected', reason: 'rate_limited' });
    expect(read(200, { status: 'failed', reason: 'refused' })).toEqual({ kind: 'failed', reason: 'model' });
    expect(read(500, { error: 'internal' })).toEqual({ kind: 'failed', reason: 'server' });
  });

  it('puts the names back only on this phone', () => {
    const names = { counterparty: { S1: 'Lingnan' }, product: { '130231': 'Agar' } };
    expect(displayText('S1 carries 71%. Next HS 130231 order soon; 130231 rises.', names)).toBe('Lingnan carries 71%. Next Agar order soon; Agar rises.');
    expect(metricLabel(INPUT.metrics[0]!, names)).toBe('Largest supplier share, Lingnan: 71.4%');
  });
});

const INGEST = resolve(__dirname, '../../../ingest/src/trade/insights.ts');
describe.skipIf(!existsSync(INGEST))('insights types match ingest', () => {
  it('signs the same request and sends the same metric kinds', async () => {
    const ingest = await import(/* @vite-ignore */ INGEST);
    expect(INSIGHTS_TYPES).toEqual(ingest.INSIGHTS_TYPES);
    expect(METRIC_KINDS).toEqual(ingest.METRIC_KINDS);
  }, 30_000);
});
