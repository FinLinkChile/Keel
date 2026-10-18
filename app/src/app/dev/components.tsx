import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useData, type Order } from '@/data';
import { tokenToCents } from '@/data/amounts';
import { Address } from '@/ui/Address';
import { Amount } from '@/ui/Amount';
import { Avatar } from '@/ui/Avatar';
import { Button } from '@/ui/Button';
import { Sheet, SheetStack } from '@/ui/Sheet';
import { StatusWord } from '@/ui/StatusWord';
import { Steps } from '@/ui/Steps';
import { Text } from '@/ui/Text';
import { colors, gutter } from '@/ui/theme';

// Development gallery of the base components, to review them against the design.
export default function Components() {
  const orders = useData((d) => d.orders());
  const parties = useData((d) => Promise.all(['lingnan', 'kowloon', 'pearl-delta'].map((id) => d.party(id))));
  const exporterOf = (o: Order) => parties?.find((p) => p?.address === o.po.exporter);
  const pending = orders?.filter((o) => o.stage === 'awaiting_signature' || o.blockedBy) ?? [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: gutter, gap: 36, paddingBottom: 64 }}>
        <Text size={28} weight={800}>
          Components
        </Text>

        <Section title="Colors">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(Object.entries(colors) as [string, string | readonly string[]][])
              .flatMap(([name, v]) => (typeof v === 'string' ? [[name, v] as const] : v.map((c, i) => [`${name}${i}`, c] as const)))
              .map(([name, value]) => (
                <View key={name} style={{ width: 82, gap: 4 }}>
                  <View style={{ height: 36, borderRadius: 10, backgroundColor: value, borderWidth: 1, borderColor: colors.line }} />
                  <Text size={11} color="textMuted" numberOfLines={1}>
                    {name}
                  </Text>
                </View>
              ))}
          </View>
        </Section>

        <Section title="Amount">
          <Amount minor={13_240_000n} currency="USD" size={38} tracking={-1.5} currencyColor="moneyPanelText" />
          <Amount minor={4_800_000n} currency="USD" size={18} weight={500} color="textSoft" currencyColor="textFaint" />
          <Amount minor={2_400_000n} size={14} color="money" />
        </Section>

        <Section title="Address">
          <Address address="0x7A3f91C2b04E6d1A8c3F5e2D9b7A0c4E1f6B55D8" />
          <Address address="0x3E9dA4c7F1b2E8d06C5a9B3f7E1d4C8a2B6f8812" full size={15} color="text" />
        </Section>

        <Section title="Avatar">
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <Avatar name="Pacífico Foods SpA" />
            <Avatar name="Lingnan Hydrocolloids" tint={0} />
            <Avatar name="Kowloon Fine Chemicals" tint={1} />
            <Avatar name="Pearl Delta Ingredients" tint={2} size={36} />
            <View style={{ flexDirection: 'row' }}>
              <Avatar name="Lingnan Hydrocolloids" tint={0} size={36} ringColor="bg" />
              <View style={{ marginLeft: -10 }}>
                <Avatar name="You" you size={36} />
              </View>
            </View>
          </View>
        </Section>

        <Section title="StatusWord">
          <View style={{ flexDirection: 'row', gap: 20, flexWrap: 'wrap' }}>
            <StatusWord tone="yourTurn">Review</StatusWord>
            <StatusWord>Advance paid</StatusWord>
            <StatusWord>Under review</StatusWord>
            <StatusWord tone="stopped">Blocked</StatusWord>
          </View>
        </Section>

        <Section title="Button">
          <Button label="Continue" />
          <Button label="Open a dispute" variant="secondary" />
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <Button label="Upload" variant="small" />
            <Button label="Review" variant="go" />
            <Button label="Open" variant="ring" />
          </View>
          <Button label="Continue" disabled />
        </Section>

        <Section title="Steps, large (05 Order)">
          <Steps
            steps={[
              { key: 'signed', title: 'Signed by both', detail: 'Oct 2', state: 'done' },
              {
                key: 'locked',
                title: 'Locked in escrow',
                detail: 'Oct 2, by the agent. Known supplier, within your limit.',
                state: 'done',
                trailing: <Amount minor={4_800_000n} size={14} weight={400} color="textMuted" />,
              },
              {
                key: 'advance',
                title: 'Advance paid to Lingnan',
                detail: 'Oct 2, by the contract',
                state: 'done',
                trailing: <Amount minor={2_400_000n} size={14} color="money" />,
              },
              {
                key: 'shipment',
                title: 'Waiting for the shipment',
                detail:
                  'Harbor Line has to confirm the goods are on board by Nov 20. Lingnan uploads the bill of lading and invoice. Nothing for you to do.',
                state: 'current',
                trailing: (
                  <Text mono size={14}>
                    37 days left
                  </Text>
                ),
              },
              {
                key: 'balance',
                title: 'Balance paid to Lingnan',
                detail: 'after the shipment is proven',
                state: 'todo',
                trailing: <Amount minor={2_400_000n} size={14} weight={400} color="textFaint" />,
              },
            ]}
          />
        </Section>

        <Section title="Steps, compact (10 Exporter)">
          <Steps
            size="compact"
            steps={[
              { key: 'signed', title: 'Signed by both', state: 'done', trailing: <When>Oct 2</When> },
              { key: 'advance', title: 'Advance received', state: 'done', trailing: <When>Oct 2</When> },
              { key: 'shipment', title: 'Shipment and documents', state: 'current', trailing: <When>by Nov 20</When> },
              {
                key: 'balance',
                title: 'Balance paid to you',
                state: 'todo',
                trailing: <Amount minor={2_400_000n} size={14} weight={400} color="textFaint" />,
              },
            ]}
          />
        </Section>

        <Section title="Sheet and SheetStack">
          <SheetStack
            title="Needs you"
            items={pending}
            keyOf={(o) => o.label}
            render={(o) => (
              <Sheet>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ flexDirection: 'row' }}>
                    <Avatar name={exporterOf(o)?.name ?? ''} tint={exporterOf(o)?.tint} size={36} ringColor="surface" />
                    {o.waitingOn === 'importer' ? (
                      <View style={{ marginLeft: -10 }}>
                        <Avatar name="You" you size={36} />
                      </View>
                    ) : null}
                  </View>
                  <Text size={14} color="textMuted" leading={1.35} style={{ flex: 1 }}>
                    {o.blockedBy === 'supplier_check' ? (
                      'Waits for the supplier check.'
                    ) : (
                      <>
                        {exporterOf(o)?.name.split(' ')[0]} signed.{' '}
                        <Text size={14} weight={700}>
                          Your turn.
                        </Text>
                      </>
                    )}
                  </Text>
                  <Text mono size={12} color="textFaint">
                    {o.label}
                  </Text>
                </View>
                <View style={{ gap: 2 }}>
                  <Text size={20} weight={800}>
                    {o.goods}, {o.quantity}
                  </Text>
                  <Text size={14} color="textMuted">
                    {exporterOf(o)?.name}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Amount minor={tokenToCents(o.po.totalAmount)} currency={o.terms.currency} size={18} weight={500} color="textSoft" currencyColor="textFaint" />
                  <Button label="Review" variant="go" />
                </View>
              </Sheet>
            )}
          />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 14 }}>
      <Text mono size={13} color="textFaint">
        {title.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

function When({ children }: { children: string }) {
  return (
    <Text size={13} color="textFaint">
      {children}
    </Text>
  );
}
