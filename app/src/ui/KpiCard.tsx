import { View } from 'react-native';

import { Text } from './Text';
import { colors, radius } from './theme';

// One number of the agent panel, with what it is and where it comes from
export function KpiCard({ label, value, context, tone = 'text' }: { label: string; value: string; context?: string; tone?: 'text' | 'money' | 'danger' }) {
  return (
    <View style={{ flex: 1, minWidth: 150, backgroundColor: colors.surface, borderRadius: radius.row, padding: 16, gap: 4 }}>
      <Text size={13} color="textMuted">
        {label}
      </Text>
      <Text size={22} weight={800} style={tone === 'text' ? undefined : { color: tone === 'money' ? colors.money : colors.danger }}>
        {value}
      </Text>
      {context ? (
        <Text size={12} color="textFaint">
          {context}
        </Text>
      ) : null}
    </View>
  );
}
