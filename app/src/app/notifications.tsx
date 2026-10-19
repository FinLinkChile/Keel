import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { proposals, useData } from '@/data';
import { tokenToCents } from '@/data/amounts';
import { loadNeedsItems, needsItemHref, needsItemText } from '@/data/needsItems';
import { useT } from '@/i18n';
import { Frame } from '@/orders/parts';
import { useSession } from '@/session';
import { Avatar } from '@/ui/Avatar';
import { formatMinor } from '@/ui/format';
import { Icon } from '@/ui/Icon';
import { Text } from '@/ui/Text';
import { colors } from '@/ui/theme';

// Notifications, from the bell on Home: what needs this person, signatures first. Each one opens
// the screen where it is done.
export default function Notifications() {
  const t = useT();
  const { role } = useSession();
  const items = useData(async (d) => {
    const all = await loadNeedsItems(d, role, async (id) => !!(await proposals.get(id)));
    return [...all.filter((i) => i.kind === 'sign_order'), ...all.filter((i) => i.kind !== 'sign_order')];
  }, [role]);

  return (
    <Frame label={t('Notifications')}>
      <Text size={28} weight={800} accessibilityRole="header">
        {t('Needs you')}
      </Text>
      {items === undefined ? null : items.length === 0 ? (
        <Text size={15} color="textMuted">
          {t('Nothing right now. Orders that wait for your signature show up here.')}
        </Text>
      ) : (
        <View>
          {items.map((item, i) => {
            const { title, detail } = needsItemText(item, role);
            const who = item.kind === 'verify_supplier' ? item.supplier : item.counterparty;
            const amount = item.kind === 'verify_supplier' ? undefined : `${item.order.terms.currency} ${formatMinor(tokenToCents(item.order.po.totalAmount))}`;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityLabel={`${title}. ${detail}`}
                onPress={() => router.push(needsItemHref(item, role))}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 14,
                  paddingVertical: 14,
                  borderTopWidth: i > 0 ? 1 : 0,
                  borderTopColor: colors.divider,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <View>
                  <Avatar name={who.name} tint={who.tint} />
                  {item.kind === 'sign_order' ? (
                    <View style={{ position: 'absolute', top: 0, right: 0, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.yourTurn }} />
                  ) : null}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text size={16} weight={700}>
                    {title}
                  </Text>
                  <Text size={14} leading={1.35} color="textMuted">
                    {detail}
                  </Text>
                  {amount ? (
                    <Text mono size={13} color="textFaint">
                      {amount}
                    </Text>
                  ) : null}
                </View>
                <Icon name="chevron" size={16} color="textFaint" />
              </Pressable>
            );
          })}
        </View>
      )}
    </Frame>
  );
}
