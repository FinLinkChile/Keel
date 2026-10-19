import { View } from 'react-native';

import type { Order } from '@/data';
import { tokenToCents } from '@/data/amounts';
import { useT } from '@/i18n';
import { formatDay, formatMinor } from '@/ui/format';
import { Icon } from '@/ui/Icon';
import { Text } from '@/ui/Text';
import { colors, radius } from '@/ui/theme';

// What the shipment and its documents say, for both sides of an order read from the Keel API: the
// fields the extractor read from the bill of lading and the invoice, and the carrier's proof.
// Nothing here is a decision: the escrow and the document check decide.
export function ShipmentDocuments({ order }: { order: Order }) {
  const t = useT();
  const bl = order.documentDetails?.transport;
  const invoice = order.documentDetails?.invoice;
  const proof = order.shipment?.attestation as { onBoardDate?: string } | undefined;
  if (!bl && !invoice && !proof) return null;

  const rows: { label: string; value: string }[] = [];
  if (bl) {
    if (bl.document_number) rows.push({ label: t(bl.doc_type === 'AIR_WAYBILL' ? 'Air waybill number' : 'Bill of lading number'), value: bl.document_number });
    if (bl.port_of_loading) rows.push({ label: t('Port of loading'), value: bl.port_of_loading });
    if (bl.port_of_discharge) rows.push({ label: t('Port of discharge'), value: bl.port_of_discharge });
    if (bl.on_board_date) rows.push({ label: t('On board (document)'), value: formatDay(Number(bl.on_board_date)) });
  }
  if (proof?.onBoardDate) rows.push({ label: t('On board (carrier proof)'), value: formatDay(Number(proof.onBoardDate)) });
  if (invoice) {
    if (invoice.invoice_number) rows.push({ label: t('Invoice number'), value: invoice.invoice_number });
    if (invoice.order_number) rows.push({ label: t('Order number on the invoice'), value: invoice.order_number });
    if (invoice.amount_minor) rows.push({ label: t('Invoice amount'), value: `${formatMinor(BigInt(invoice.amount_minor))} ${invoice.currency ?? ''}`.trim() });
    if (invoice.incoterm) rows.push({ label: t('Incoterm'), value: invoice.incoterm });
  }

  // The invoice's order number and amount next to the signed order's: a difference is shown, not judged
  const orderAmount = tokenToCents(order.po.totalAmount);
  const differs =
    (!!invoice?.order_number && invoice.order_number !== order.terms.orderNumber) ||
    (!!invoice?.amount_minor && BigInt(invoice.amount_minor) !== orderAmount);

  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, padding: 20, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="check" size={14} strokeWidth={3} color={proof ? 'money' : 'textMuted'} />
        <Text size={18} weight={800} accessibilityRole="header">
          {proof ? t('Shipment proven') : t('Documents received')}
        </Text>
      </View>
      {rows.map((r) => (
        <View key={r.label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
          <Text size={14} color="textMuted" style={{ flexShrink: 1 }}>
            {r.label}
          </Text>
          <Text mono size={14}>
            {r.value}
          </Text>
        </View>
      ))}
      {differs ? (
        <Text size={13} leading={1.45} style={{ color: colors.yourTurn }}>
          {t('The invoice does not match the signed order ({number}, {amount}). Check it before approving the balance.', {
            number: order.terms.orderNumber,
            amount: formatMinor(orderAmount),
          })}
        </Text>
      ) : null}
    </View>
  );
}

// The order is closed and paid in full: said once, at the top, so nobody wonders what is left
export function OrderComplete({ order, role }: { order: Order; role: 'importer' | 'exporter' }) {
  const t = useT();
  if (order.stage !== 'settled') return null;
  const total = `${formatMinor(tokenToCents(order.po.totalAmount))} ${order.terms.currency}`;
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, padding: 20, gap: 6, borderWidth: 1, borderColor: colors.money }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="check" size={16} strokeWidth={3} color="money" />
        <Text size={18} weight={800} accessibilityRole="header">
          {t('Order complete')}
        </Text>
      </View>
      <Text size={14} leading={1.45} color="textMuted">
        {role === 'importer'
          ? t('{total} paid to the supplier: the advance and the balance. Nothing is left in the escrow.', { total })
          : t('You received {total}: the advance and the balance. Nothing is left in the escrow.', { total })}
      </Text>
    </View>
  );
}
