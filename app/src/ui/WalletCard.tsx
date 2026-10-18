import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import type { Wallet } from '@/data';

import { Amount } from './Amount';
import { formatCompact, formatMinor } from './format';
import { Icon } from './Icon';
import { Text } from './Text';
import { colors } from './theme';

type Props = {
  wallet: Wallet;
  // "Locked in orders" for the importer, "Locked for you" for the exporter (as in 10)
  lockedLabel: string;
  onLocked?: () => void;
  onAgent?: () => void;
};

// The navy money panel of 02 Home: what is available, what is locked in orders and how
// much of the monthly limit the agent has used.
export function WalletCard({ wallet, lockedLabel, onLocked, onAgent }: Props) {
  const { agent } = wallet;

  return (
    <View style={{ borderRadius: 28, overflow: 'hidden', backgroundColor: colors.moneyPanel }}>
      {/* 160deg gradient of the design */}
      <Svg style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} width="100%" height="100%">
        <Defs>
          <LinearGradient id="panel" x1="0.33" y1="0" x2="0.67" y2="1">
            <Stop offset="0" stopColor={colors.moneyPanelTop} />
            <Stop offset="1" stopColor={colors.moneyPanel} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#panel)" />
      </Svg>

      <View style={{ paddingTop: 20, paddingHorizontal: 20, paddingBottom: 18, gap: 2 }}>
        <Text size={15} color="moneyPanelText">
          Available
        </Text>
        <Amount
          minor={wallet.availableMinor}
          currency={wallet.currency}
          size={38}
          tracking={-1.5}
          currencyColor="moneyPanelText"
        />
      </View>

      <Row onPress={onLocked} last={!agent} label={`${lockedLabel}, ${formatMinor(wallet.lockedMinor)} ${wallet.currency}`}>
        <Icon name="lock" size={16} color="moneyPanelText" />
        <Text size={15} color="moneyPanelText" style={{ flex: 1 }}>
          {lockedLabel}
        </Text>
        <Amount minor={wallet.lockedMinor} size={14} weight={500} />
      </Row>

      {agent ? <AgentRow agent={agent} onPress={onAgent} /> : null}
    </View>
  );
}

function AgentRow({ agent, onPress }: { agent: NonNullable<Wallet['agent']>; onPress?: () => void }) {
  const used = agent.monthlyLimitMinor > 0n ? Number((agent.usedMinor * 1000n) / agent.monthlyLimitMinor) / 10 : 0;
  const limitLabel = `${formatCompact(agent.usedMinor)} of ${formatCompact(agent.monthlyLimitMinor)}`;
  return (
    <Row onPress={onPress} last label={`Agent ${agent.on ? 'on' : 'off'}, ${limitLabel} monthly limit used`}>
      <View style={{ width: 16, alignItems: 'center' }}>
        <View
          style={{
            width: 16,
            height: 16,
            borderRadius: 8,
            backgroundColor: agent.on ? colors.accentHalo : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: agent.on ? colors.accent : colors.control }} />
        </View>
      </View>
      <Text size={15} weight={700}>
        {agent.on ? 'Agent on' : 'Agent off'}
      </Text>
      <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.moneyPanelLine, overflow: 'hidden' }}>
        <View style={{ width: `${Math.min(used, 100)}%`, height: 6, borderRadius: 3, backgroundColor: colors.accent }} />
      </View>
      <Text mono size={13} color="moneyPanelText">
        {limitLabel}
      </Text>
    </Row>
  );
}

function Row({ children, onPress, last = false, label }: { children: ReactNode; onPress?: () => void; last?: boolean; label: string }) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={label}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingTop: 14,
        paddingBottom: last ? 16 : 14,
        paddingHorizontal: 20,
        borderTopWidth: 1,
        borderTopColor: colors.moneyPanelLine,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {children}
      {onPress ? <Icon name="chevron" size={14} strokeWidth={2.4} color="moneyPanelIcon" /> : null}
    </Pressable>
  );
}
