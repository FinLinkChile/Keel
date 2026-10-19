import { View } from 'react-native';

import { api } from '@/data';
import { useApiFailure } from '@/data/apiHealth';
import { apiProblemFor } from '@/data/apiProblem';
import { useT } from '@/i18n';
import { Text } from '@/ui/Text';
import { colors, radius } from '@/ui/theme';

// Shown while a read of the Keel API is failing. The screens then fall back to what this phone
// has, which may be empty or out of date: without this notice "nothing needs you" could hide a
// signature that is waiting. Only with the API configured; the reason is the error code's
// sentence (apiProblem.ts), never the server's reply.
export function ApiNotice() {
  const t = useT();
  const failure = useApiFailure();
  if (!api || !failure) return null;
  return (
    <View
      accessibilityRole="alert"
      style={{ backgroundColor: colors.dangerMuted, borderRadius: radius.card, paddingVertical: 14, paddingHorizontal: 16, gap: 4 }}
    >
      <Text size={15} weight={700} color="danger">
        {t('Keel did not answer')}
      </Text>
      <Text size={14} leading={1.45} color="textSoft">
        {apiProblemFor(failure.code)}
      </Text>
      <Text size={13} leading={1.45} color="textMuted">
        {t('What you see comes from this phone and may be out of date.')}
      </Text>
    </View>
  );
}
