import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { config } from '@/config';
import { useData } from '@/data';
import { analysisInput, type AnalysisInput } from '@/data/analysisInput';
import { displayText, metricLabel, type Names } from '@/data/analysisText';
import { useT } from '@/i18n';
import { requestInsights, type InsightsResult } from '@/ingest/insights';
import { useSession } from '@/session';
import { Button } from '@/ui/Button';
import { formatLocalDayTime } from '@/ui/format';
import { Text } from '@/ui/Text';
import { colors, radius } from '@/ui/theme';

const PROBLEM: Record<string, string> = {
  not_configured: 'The analysis needs ingest, which is not set up in this build.',
  network: 'Could not reach Keel. Check the connection and try again.',
  server: 'Keel answered something unexpected. Try again later.',
  model: 'The agent could not write the analysis this time. Try again.',
  not_an_importer: 'This wallet is not registered as an importer yet.',
  rate_limited: 'You reached the analyses for today. Try again tomorrow.',
  stale_signature: 'The phone clock seems off. Check the time and try again.',
  bad_signature: 'The wallet could not sign the request.',
  invalid_request: 'The data could not be sent as it is.',
  too_large: 'There is too much data to send at once.',
};

// The last analysis of each role, kept while the app is open
const last = new Map<string, { result: InsightsResult; input: AnalysisInput }>();

// "What the agent sees": the analyst model reads the numbers computed on this phone and writes
// findings with advice. It sees no documents and no names, and it cannot move money.
export function AgentAnalysis() {
  const t = useT();
  // Read while rendering, so it follows the theme
  const DOT = { important: colors.danger, attention: colors.yourTurn, info: colors.accent } as const;
  const { role, signer, onboarding } = useSession();
  const [busy, setBusy] = useState(false);
  const [, setShownAt] = useState(0);
  // Looked up by role on every render, so changing role never shows the other role's analysis
  const shown = last.get(role);
  const data = useData(async (d) => {
    const orders = await d.orders();
    const { input, counterparties } = analysisInput({ orders, role, profile: onboarding?.profile ?? null, now: Date.now() / 1000 });
    const names: Names = { counterparty: {}, product: {} };
    for (const [id, address] of Object.entries(counterparties)) names.counterparty[id] = (await d.partyByAddress(address))?.short ?? id;
    for (const o of orders) {
      const hs = o.terms.hsCodes[0];
      if (hs && !names.product[hs]) names.product[hs] = o.goodsShort || o.goods;
    }
    return { input, names, orders: orders.length };
  }, [role, onboarding?.profile?.industry, onboarding?.profile?.salesBracket]);

  async function analyze() {
    if (!data || !signer) return;
    setBusy(true);
    const result = await requestInsights({ ingestUrl: config.ingestUrl, chainId: config.chainId, signer, input: data.input }).catch(
      (): InsightsResult => ({ kind: 'failed', reason: 'server' }),
    );
    const entry = { result, input: data.input };
    last.set(role, entry);
    setShownAt(Date.now());
    setBusy(false);
  }

  const result = shown?.result;
  const byId = new Map((shown?.input.metrics ?? []).map((m) => [m.id, m]));

  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, padding: 18, gap: 14 }}>
      <View style={{ gap: 4 }}>
        <Text size={20} weight={800} accessibilityRole="header">
          {t('What the agent sees')}
        </Text>
        <Text size={14} leading={1.45} color="textMuted">
          {result?.kind === 'ok'
            ? t('Analysis of {when}.', { when: formatLocalDayTime(result.at) })
            : t('The agent reads your purchases, how they change and what is coming, and suggests what to do.')}
        </Text>
      </View>

      {result?.kind === 'ok' ? (
        result.findings.length === 0 ? (
          <Text size={14} color="textMuted">
            {t('Nothing worth acting on right now.')}
          </Text>
        ) : (
          result.findings.map((f, i) => (
            <View key={i} style={{ gap: 6, paddingTop: i ? 12 : 0, borderTopWidth: i ? 1 : 0, borderTopColor: colors.dividerOnSurface }}>
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 7, backgroundColor: DOT[f.severity] }} />
                <Text size={16} weight={700} leading={1.35} style={{ flex: 1 }}>
                  {displayText(f.title, data?.names ?? { counterparty: {}, product: {} })}
                </Text>
              </View>
              <Text size={14} leading={1.45} color="textSoft" style={{ paddingLeft: 18 }}>
                {displayText(f.recommendation, data?.names ?? { counterparty: {}, product: {} })}
              </Text>
              <Text size={12} leading={1.4} color="textFaint" style={{ paddingLeft: 18 }}>
                {t('Based on {what}', { what: f.metric_ids.map((id) => (byId.get(id) && data ? metricLabel(byId.get(id)!, data.names) : id)).join('; ') })}
              </Text>
            </View>
          ))
        )
      ) : result ? (
        <Text size={14} leading={1.45} style={{ color: colors.danger }}>
          {t(PROBLEM[result.reason]!)}
        </Text>
      ) : null}

      {busy ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <ActivityIndicator color={colors.accent} />
          <Text size={14} color="textMuted">
            {t('The agent is analyzing your purchases')}
          </Text>
        </View>
      ) : (
        <Button
          label={result?.kind === 'ok' ? t('Analyze again') : t('Analyze my purchases')}
          variant={result?.kind === 'ok' ? 'secondary' : 'go'}
          onPress={analyze}
          disabled={!data || !signer || data.orders === 0}
        />
      )}
      {data && data.orders === 0 ? (
        <Text size={13} color="textMuted">
          {t('The agent needs some orders to analyze. They appear as you send and sign them.')}
        </Text>
      ) : null}
      <Text size={12} leading={1.4} color="textFaint">
        {t('The agent gets only numbers computed on this phone, with suppliers as S1, S2. It sees no documents and no names, and it cannot sign or move money.')}
      </Text>
    </View>
  );
}
