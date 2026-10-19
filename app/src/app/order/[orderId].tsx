import type { Hex, RequiredDocType } from '@keel/schemas';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { config } from '@/config';
import { api, proposals, useData, type Order, type OrderDocument, type Party } from '@/data';
import { uploadViaApi } from '@/ingest/apiUpload';
import { ClosingActions } from '@/orders/ClosingActions';
import { tokenToCents } from '@/data/amounts';
import { pickPdf } from '@/files/pickPdf';
import type { PickedFile } from '@/files/pickPdf.types';
import { uploadPreview } from '@/files/uploadPreview';
import { t, useT } from '@/i18n';
import { ExporterReview } from '@/orders/ExporterReview';
import { ImporterOrder } from '@/orders/ImporterOrder';
import { OrderComplete, ShipmentDocuments } from '@/orders/ShipmentDocuments';
import { uploadDocument, type UploadResult } from '@/ingest/client';
import { uploadStatus } from '@/ingest/uploadStatus';
import { useSession } from '@/session';
import { Address } from '@/ui/Address';
import { Amount } from '@/ui/Amount';
import { Avatar } from '@/ui/Avatar';
import { BottomSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { formatDay, formatLocalDay, formatMinor } from '@/ui/format';
import { Icon } from '@/ui/Icon';
import { Placeholder } from '@/ui/Placeholder';
import { StatusWord } from '@/ui/StatusWord';
import { Steps, type Step } from '@/ui/Steps';
import { Text } from '@/ui/Text';
import { colors, gutter, radius } from '@/ui/theme';

// One order. The exporter sees 10 Exporter, where it uploads the transport document and the
// invoice (step 4 of the flow). The importer's view (05 Order) comes later.
export default function OrderScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: Hex }>();
  const { role } = useSession();
  // An order proposed on this phone is reviewed and signed before it is an order in progress
  // With the Keel API a fully signed proposal is an order in progress: it opens as one
  const proposed = useData(async () => {
    const p = await proposals.get(orderId);
    return !!p && !(api && p.status === 'signed');
  }, [orderId]);
  if (proposed === undefined) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  // The importer sees the same timeline for every order; the review is a step inside it
  if (role === 'importer') return <ImporterOrder orderId={orderId} />;
  return proposed ? <ExporterReview orderId={orderId} /> : <ExporterOrder orderId={orderId} />;
}

const DOC_NAMES: Record<RequiredDocType, string> = {
  BILL_OF_LADING: 'Bill of lading',
  AIR_WAYBILL: 'Air waybill',
  COMMERCIAL_INVOICE: 'Commercial invoice',
};

const DAY = 24 * 3600;

function ExporterOrder({ orderId }: { orderId: Hex }) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const view = useData(async (d) => {
    const order = await d.order(orderId);
    if (!order) return null;
    const [me, buyer, carrier] = await Promise.all([
      d.partyByAddress(order.po.exporter),
      d.partyByAddress(order.po.importer),
      d.party(order.carrier),
    ]);
    return me && buyer && carrier ? { order, me, buyer, carrier } : null;
  }, [orderId]);

  if (view === undefined) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  if (view === null) return <Placeholder title={t('Order not found')} back />;
  const { order, me, buyer, carrier } = view;

  // Computed in token units, shown in cents
  const units = order.po.totalAmount;
  const advanceUnits = (units * BigInt(order.po.advanceBps)) / 10_000n;
  const total = tokenToCents(units);
  const advance = tokenToCents(advanceUnits);
  const balance = tokenToCents(units - advanceUnits);
  const now = Date.now() / 1000;
  const daysLeft = Math.max(0, Math.ceil((Number(order.po.shipmentDeadline) - now) / DAY));
  const deadline = formatDay(order.po.shipmentDeadline);
  const yourTurn = order.stage === 'advance_paid';
  const settled = order.stage === 'settled';
  const shipped = order.stage === 'shipped' || settled;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{
        paddingTop: Math.max(52, insets.top + 8),
        paddingBottom: insets.bottom + 32,
        paddingHorizontal: gutter,
        gap: 24,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: -8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Back')}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="back" size={22} />
        </Pressable>
        <Text mono size={15} color="textMuted" style={{ flex: 1, textAlign: 'center' }}>
          {order.label}
        </Text>
        <View style={{ width: 44, alignItems: 'flex-end', paddingRight: 4 }}>
          <Avatar name={me.name} tint={me.tint} size={36} />
        </View>
      </View>

      <View style={{ gap: 2, marginTop: -8 }}>
        <Text size={28} weight={800} accessibilityRole="header">
          {order.goods}
        </Text>
        <Text size={15} color="textMuted">
          {t('For {name}, {place}', { name: buyer.name, place: buyer.place })}
        </Text>
      </View>

      <OrderComplete order={order} role="exporter" />

      <View style={{ backgroundColor: colors.surface, borderRadius: radius.card }}>
        <View style={{ paddingTop: 20, paddingHorizontal: 20, paddingBottom: 16, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="check" size={14} strokeWidth={3} color="money" />
            <Text size={15} color="textMuted">
              {t('Received')}
            </Text>
          </View>
          <Amount minor={settled ? total : advance} currency={order.terms.currency} size={36} tracking={-1.4} currencyColor="textMuted" />
        </View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingVertical: 14,
            paddingHorizontal: 20,
            borderTopWidth: 1,
            borderTopColor: colors.dividerOnSurface,
          }}
        >
          <Icon name="lock" size={16} color="textMuted" />
          <Text size={15} color="textMuted" style={{ flex: 1 }}>
            {t('Locked for you')}
          </Text>
          <Amount minor={settled ? 0n : balance} size={14} weight={500} />
        </View>
        <Text size={13} leading={1.45} color="textMuted" style={{ paddingHorizontal: 20, paddingBottom: 18 }}>
          {settled
            ? t('Paid in full to your signed account.')
            : t('Paid to you once the shipment is proven. No proof by {date} and it goes back to {name}.', { date: deadline, name: buyer.short })}
        </Text>
      </View>

      <View style={{ backgroundColor: colors.surface, borderRadius: radius.sheet, padding: 20, gap: 12 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          {yourTurn ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                backgroundColor: colors.surfaceRaised,
                paddingVertical: 6,
                paddingHorizontal: 12,
                borderRadius: radius.pill,
              }}
            >
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.yourTurn }} />
              <Text size={13} weight={700}>
                {t('Your turn')}
              </Text>
            </View>
          ) : (
            <View />
          )}
          {shipped ? null : (
            <Text mono size={13}>
              {daysLeft === 1 ? t('1 day left') : t('{n} days left', { n: daysLeft })}
            </Text>
          )}
        </View>
        <Text size={18} weight={800}>
          {shipped ? t('Shipment proven and documents sent') : t('Ship by {date} and send the documents', { date: deadline })}
        </Text>
        <Text size={14} leading={1.45} color="textMuted">
          {t('{name} confirms the shipment; you can\'t sign that yourself.', { name: carrier.name })}
        </Text>
        <View style={{ marginTop: 4 }}>
          {[order.transportDoc, 'COMMERCIAL_INVOICE' as const].map((docType, i) => (
            <DocumentRow
              key={docType}
              order={order}
              docType={docType}
              existing={order.documents.find((d) => d.docType === docType)}
              last={i === 1}
            />
          ))}
        </View>
      </View>

      <ShipmentDocuments order={order} />

      <View style={{ gap: 8 }}>
        <Text size={20} weight={800} accessibilityRole="header">
          {t('Steps')}
        </Text>
        <Steps size="compact" steps={steps(order, total, balance, deadline)} />
      </View>

      <ClosingActions orderId={order.po.orderId} role="exporter" />

      <PayoutNote payout={order.po.payoutAddress} me={me} />
    </ScrollView>
  );
}

function steps(order: Order, total: bigint, balance: bigint, deadline: string): Step[] {
  const when = (at?: number) => (
    <Text size={13} color="textFaint">
      {at ? formatDay(at) : ''}
    </Text>
  );
  const shipped = order.stage === 'shipped' || order.stage === 'settled';
  // Orders read from the Keel API carry no deposit date: the stage says the deposit happened
  const funded = order.advancePaidAt !== undefined || (['advance_paid', 'shipped', 'settled', 'refunded'] as Order['stage'][]).includes(order.stage);
  return [
    { key: 'signed', title: t('Signed by both'), state: order.signedAt ? 'done' : 'todo', trailing: when(order.signedAt) },
    {
      key: 'locked',
      title: t('Buyer locked {amount}', { amount: formatMinor(total / 100n, 0) }),
      state: funded ? 'done' : 'todo',
      trailing: when(order.advancePaidAt),
    },
    { key: 'advance', title: t('Advance received'), state: funded ? 'done' : 'todo', trailing: when(order.advancePaidAt) },
    {
      key: 'shipment',
      title: t('Shipment and documents'),
      state: shipped ? 'done' : order.stage === 'advance_paid' ? 'current' : 'todo',
      trailing: shipped ? when(order.shippedAt) : (
        <Text size={13} color="textFaint">
          {t('by {date}', { date: deadline })}
        </Text>
      ),
    },
    {
      key: 'balance',
      title: t('Balance paid to you'),
      state: order.stage === 'settled' ? 'done' : 'todo',
      trailing: <Amount minor={balance} size={14} weight={400} color={order.stage === 'settled' ? 'text' : 'textFaint'} />,
    },
  ];
}

type Upload = { phase: 'signing' | 'uploading'; fileName: string } | { phase: 'done'; fileName: string; at: number; result: UploadResult };

// One required document: its state, or the Upload action. Shows only the outcome of the
// upload; nothing ingest read in the file is ever shown here.
function DocumentRow({ order, docType, existing, last }: { order: Order; docType: RequiredDocType; existing?: OrderDocument; last: boolean }) {
  const t = useT();
  const { signer } = useSession();
  const [upload, setUpload] = useState<Upload>();
  // The file chosen and waiting for the exporter to confirm it
  const [pending, setPending] = useState<PickedFile>();

  // Nothing is signed or sent until the exporter confirms what the file is. An oversize file is
  // refused here, before the preview.
  async function pick() {
    if (!signer) return;
    const file = await pickPdf();
    if (!file) return;
    if (uploadPreview(docType, order.label, file).tooLarge) {
      setUpload({ phase: 'done', fileName: file.name, at: Date.now() / 1000, result: { kind: 'rejected', reason: 'too_large' } });
      return;
    }
    setPending(file);
  }

  async function chooseAnother() {
    setPending(undefined);
    // iOS cannot present the picker while the sheet is still sliding away
    if (Platform.OS === 'ios') await new Promise((resolve) => setTimeout(resolve, 400));
    await pick();
  }

  async function confirm(file: PickedFile) {
    if (!signer) return;
    setPending(undefined);
    setUpload({ phase: 'signing', fileName: file.name });
    const upload = {
      signer: {
        address: () => signer.address(),
        signTypedData: async (...args: Parameters<typeof signer.signTypedData>) => {
          const signature = await signer.signTypedData(...args);
          setUpload({ phase: 'uploading', fileName: file.name });
          return signature;
        },
      },
      orderId: order.po.orderId,
      docType,
      file: file.bytes,
    };
    // With the Keel API: a presigned upload, read later; without it, straight to ingest
    const result = await (api
      ? uploadViaApi({ api, chainId: config.chainId, ...upload })
      : uploadDocument({ ingestUrl: config.ingestUrl, chainId: config.chainId, ...upload })
    ).catch((): UploadResult => ({ kind: 'failed', reason: 'server' }));
    setUpload({ phase: 'done', fileName: file.name, at: Date.now() / 1000, result });  }

  const outcome = upload?.phase === 'done' ? uploadStatus(upload.result) : undefined;
  // What the server says about the document, once it has read it
  const served = existing ? (existing.status === 'accepted' ? 'Accepted' : 'Under review') : undefined;
  // "Uploaded" only says the file left the phone: when the server has read it, its answer wins
  const word = outcome?.word === 'Uploaded' ? (served ?? outcome.word) : (outcome?.word ?? (!upload ? served : undefined));
  const busy = upload?.phase === 'signing' || upload?.phase === 'uploading';

  let detail: string;
  if (busy) detail = `${upload.fileName}, ${upload.phase === 'signing' ? t('signing') : t('uploading')}`;
  else if (upload?.phase === 'done') detail = outcome?.problem ? t(outcome.problem) : `${upload.fileName}, ${formatLocalDay(upload.at)}`;
  else if (existing?.fileName && existing.uploadedAt !== undefined) detail = `${existing.fileName}, ${formatLocalDay(existing.uploadedAt)}`;
  else if (existing) detail = t('Received');
  else detail = t('Not uploaded yet');

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingTop: 12,
        paddingBottom: last ? 0 : 12,
        borderTopWidth: 1,
        borderTopColor: colors.dividerOnSurface,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text size={15} weight={700}>
          {t(DOC_NAMES[docType])}
        </Text>
        <Text size={13} color={outcome?.problem ? 'textMuted' : 'textFaint'}>
          {detail}
        </Text>
      </View>
      {word ? (
        <StatusWord>{t(word)}</StatusWord>
      ) : (
        <Button
          label={busy ? t('Uploading') : upload?.phase === 'done' ? t('Try again') : t('Upload')}
          variant="small"
          disabled={busy || !signer}
          onPress={pick}
        />
      )}
      <BottomSheet visible={!!pending} title={t('Upload this file?')} onClose={() => setPending(undefined)}>
        {pending ? <UploadConfirm preview={uploadPreview(docType, order.label, pending)} onConfirm={() => confirm(pending)} onAnother={chooseAnother} /> : null}
      </BottomSheet>
    </View>
  );
}

// What the exporter is about to sign: the document, the order and the file as the phone has it.
function UploadConfirm({ preview, onConfirm, onAnother }: { preview: ReturnType<typeof uploadPreview>; onConfirm: () => void; onAnother: () => void }) {
  const t = useT();
  return (
    <View style={{ gap: 14, paddingTop: 6 }}>
      <View style={{ gap: 2 }}>
        <Text size={17} weight={700}>
          {preview.title}
        </Text>
        <Text size={15} color="textSoft" numberOfLines={2}>
          {preview.fileName}
        </Text>
        <Text size={13} color="textMuted">
          {preview.details}
        </Text>
      </View>
      <Text size={14} leading={1.45} color="textMuted">
        {t('You sign these exact bytes for this order. Keel only tells you the outcome.')}
      </Text>
      <View style={{ gap: 10 }}>
        <Button label={t('Confirm and upload')} onPress={onConfirm} />
        <Button label={t('Choose another file')} variant="secondary" onPress={onAnother} />
      </View>
    </View>
  );
}

function PayoutNote({ payout, me }: { payout: Hex; me: Party }) {
  const t = useT();
  return (
    <View style={{ flexDirection: 'row', gap: 10 }} accessibilityLabel={t('Paid to {name}\'s signed account', { name: me.short })}>
      <View style={{ marginTop: 2 }}>
        <Icon name="lock" size={16} color="textMuted" />
      </View>
      <Text size={14} leading={1.45} color="textMuted" style={{ flex: 1 }}>
        {t('Paid to your signed account')} <Address address={payout} inline size={14} color="text" />. {t('A new bank account in a document is ignored.')}
      </Text>
    </View>
  );
}
