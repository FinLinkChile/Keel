import type { Hex } from '@keel/schemas';
import { keccak256, stringToBytes } from 'viem';

import type { AnalysisInput } from '../data/analysisInput';
import type { Signer } from '../wallet/signer';

import { uploadDomain } from './upload';

// The agent's analysis of the purchases: POST {ingestUrl}/trade/insights (ingest/src/trade/
// insights.ts). The app signs the exact metrics it sends; the model sees only those numbers and
// ids. The answer is checked again here before anything reaches the screen.

export const INSIGHTS_TYPES = {
  InsightsRequest: [
    { name: 'inputHash', type: 'bytes32' },
    { name: 'issuedAt', type: 'uint64' },
  ],
} as const;

export const FINDING_KINDS = ['trend', 'dependency', 'cash', 'price', 'rhythm', 'negotiation', 'risk'] as const;
export const SEVERITIES = ['info', 'attention', 'important'] as const;

export type Finding = {
  kind: (typeof FINDING_KINDS)[number];
  severity: (typeof SEVERITIES)[number];
  metric_ids: string[];
  title: string;
  recommendation: string;
};

export type InsightsResult =
  | { kind: 'ok'; findings: Finding[]; at: number }
  | { kind: 'rejected'; reason: 'not_an_importer' | 'rate_limited' | 'stale_signature' | 'bad_signature' | 'invalid_request' | 'too_large' }
  | { kind: 'failed'; reason: 'not_configured' | 'network' | 'server' | 'model' };

const REJECTIONS = ['not_an_importer', 'rate_limited', 'stale_signature', 'bad_signature', 'invalid_request', 'too_large'] as const;
const FORBIDDEN = /0x[0-9a-f]{4,}|https?:|www\.|@|\d{11,}/i;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function isFinding(v: unknown, ids: Set<string>): v is Finding {
  if (!isObj(v) || Object.keys(v).length !== 5) return false;
  const { kind, severity, metric_ids, title, recommendation } = v;
  return (
    (FINDING_KINDS as readonly unknown[]).includes(kind) &&
    (SEVERITIES as readonly unknown[]).includes(severity) &&
    Array.isArray(metric_ids) &&
    metric_ids.length > 0 &&
    metric_ids.every((id) => typeof id === 'string' && ids.has(id)) &&
    typeof title === 'string' &&
    title.length > 0 &&
    title.length <= 90 &&
    typeof recommendation === 'string' &&
    recommendation.length > 0 &&
    recommendation.length <= 320 &&
    !FORBIDDEN.test(`${title} ${recommendation}`)
  );
}

export function readInsightsResponse(status: number, body: unknown, input: AnalysisInput, at: number): InsightsResult {
  if (!isObj(body)) return { kind: 'failed', reason: 'server' };
  if (status === 200 && body.status === 'ok') {
    const ids = new Set(input.metrics.map((m) => m.id));
    if (!Array.isArray(body.findings) || body.findings.length > 5 || !body.findings.every((f) => isFinding(f, ids))) {
      return { kind: 'failed', reason: 'server' };
    }
    return { kind: 'ok', findings: body.findings, at };
  }
  if (status === 200 && body.status === 'failed') return { kind: 'failed', reason: 'model' };
  const reason = (body.reason ?? body.error) as (typeof REJECTIONS)[number];
  if (status >= 400 && status < 500 && REJECTIONS.includes(reason)) return { kind: 'rejected', reason };
  return { kind: 'failed', reason: 'server' };
}

type Request = {
  ingestUrl: string | undefined;
  chainId: number | undefined;
  signer: Signer;
  input: AnalysisInput;
  now?: () => number;
  fetchFn?: typeof fetch;
};

export async function requestInsights({ ingestUrl, chainId, signer, input, now = Date.now, fetchFn = fetch }: Request): Promise<InsightsResult> {
  if (!ingestUrl || !chainId) return { kind: 'failed', reason: 'not_configured' };
  const text = JSON.stringify(input);
  const issuedAt = Math.floor(now() / 1000);
  const signature = await signer.signTypedData(uploadDomain(chainId), INSIGHTS_TYPES, 'InsightsRequest', {
    inputHash: keccak256(stringToBytes(text)) as Hex,
    issuedAt: BigInt(issuedAt),
  });
  let res: Response;
  try {
    res = await fetchFn(`${ingestUrl.replace(/\/+$/, '')}/trade/insights`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ issuedAt, signature, input: text }),
    });
  } catch {
    return { kind: 'failed', reason: 'network' };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  return readInsightsResponse(res.status, body, input, issuedAt);
}
