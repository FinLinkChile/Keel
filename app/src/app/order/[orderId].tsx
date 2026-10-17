import type { Hex, RequiredDocType } from '@keel/schemas';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { config } from '@/config';
import { proposals, useData, type Order, type OrderDocument, type Party } from '@/data';
import { tokenToCents } from '@/data/amounts';
import { pickPdf } from '@/files/pickPdf';
import type { PickedFile } from '@/files/pickPdf.types';
import { uploadPreview } from '@/files/uploadPreview';
import { ExporterReview } from '@/orders/ExporterReview';
import { ImporterReview } from '@/orders/ImporterReview';
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
  const proposed = useData(async () => !!(await proposals.get(orderId)), [orderId]);
  if (proposed === undefined) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  if (role === 'importer') return proposed ? <ImporterReview orderId={orderId} /> : <Placeholder title="Order" back />;
  return proposed ? <ExporterReview orderId={orderId} /> : <ExporterOrder orderId={orderId} />;
}

const DOC_NAMES: Record<RequiredDocType, string> = {
  BILL_OF_LADING: 'Bill of lading',
  AIR_WAYBILL: 'Air waybill',
  COMMERCIAL_INVOICE: 'Commercial invoice',
};

const DAY = 24 * 3600;

function ExporterOrder({ orderId }: { orderId: Hex }) {
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
  if (view === null) return <Placeholder title="Order not found" back />;
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
          accessibilityLabel="Back"
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
          For {buyer.name}, {buyer.place}
        </Text>
      </View>

      <View style={{ backgroundColor: colors.surface, borderRadius: radius.card }}>
        <View style={{ paddingTop: 20, paddingHorizontal: 20, paddingBottom: 16, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="check" size={14} strokeWidth={3} color="money" />
            <Text size={15} color="textMuted">
              Received
            </Text>
          </View>
          <Amount minor={advance} currency={order.terms.currency} size={36} tracking={-1.4} currencyColor="textMuted" />
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
            Locked for you
          </Text>
          <Amount minor={balance} size={14} weight={500} />
        </View>
        <Text size={13} leading={1.45} color="textMuted" style={{ paddingHorizontal: 20, paddingBottom: 18 }}>
          Paid to you once the shipment is proven. No proof by {deadline} and it goes back to {buyer.short}.
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
                Your turn
              </Text>
            </View>
          ) : (
            <View />
          )}
          <Text mono size={13}>
            {daysLeft === 1 ? '1 day left' : `${daysLeft} days left`}
          </Text>
        </View>
        <Text size={18} weight={800}>
          Ship by {deadline} and send the documents
        </Text>
        <Text size={14} leading={1.45} color="textMuted">
          {carrier.name} confirms the shipment; you can&apos;t sign that yourself.
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

      <View style={{ gap: 8 }}>
        <Text size={20} weight={800} accessibilityRole="header">
          Steps
        </Text>
        <Steps size="compact" steps={steps(order, total, balance, deadline)} />
      </View>

      <PayoutNote payout={order.po.payoutAddress} me={me} />
    </ScrollView>
  );
}

function steps(order: Order, total: bigint, balance: bigint, deadline: string): Step[] {
  const when = (t?: number) => (
    <Text size={13} color="textFaint">
      {t ? formatDay(t) : ''}
    </Text>
  );
  const shipped = order.stage === 'shipped' || order.stage === 'settled';
  return [
    { key: 'signed', title: 'Signed by both', state: order.signedAt ? 'done' : 'todo', trailing: when(order.signedAt) },
    {
      key: 'locked',
      title: `Buyer locked ${formatMinor(total / 100n, 0)}`,
      state: order.advancePaidAt ? 'done' : 'todo',
      trailing: when(order.advancePaidAt),
    },
    { key: 'advance', title: 'Advance received', state: order.advancePaidAt ? 'done' : 'todo', trailing: when(order.advancePaidAt) },
    {
      key: 'shipment',
      title: 'Shipment and documents',
      state: shipped ? 'done' : order.stage === 'advance_paid' ? 'current' : 'todo',
      trailing: shipped ? when(order.shippedAt) : (
        <Text size={13} color="textFaint">
          by {deadline}
        </Text>
      ),
    },
    {
      key: 'balance',
      title: 'Balance paid to you',
      state: order.stage === 'settled' ? 'done' : 'todo',
      trailing: <Amount minor={balance} size={14} weight={400} color={order.stage === 'settled' ? 'text' : 'textFaint'} />,
    },
  ];
}

type Upload = { phase: 'signing' | 'uploading'; fileName: string } | { phase: 'done'; fileName: string; at: number; result: UploadResult };

// One required document: its state, or the Upload action. Shows only the outcome of the
// upload; nothing ingest read in the file is ever shown here.
function DocumentRow({ order, docType, existing, last }: { order: Order; docType: RequiredDocType; existing?: OrderDocument; last: boolean }) {
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
    const result = await uploadDocument({
      ingestUrl: config.ingestUrl,
      chainId: config.chainId,
      signer: {
        address: () => signer.address(),
        signTypedData: async (...args) => {
          const signature = await signer.signTypedData(...args);
          setUpload({ phase: 'uploading', fileName: file.name });
          return signature;
        },
      },
      orderId: order.po.orderId,
      docType,
      file: file.bytes,
    }).catch((): UploadResult => ({ kind: 'failed', reason: 'server' }));
    setUpload({ phase: 'done', fileName: file.name, at: Date.now() / 1000, result });
  }

  const outcome = upload?.phase === 'done' ? uploadStatus(upload.result) : undefined;
  const word =
    outcome?.word ?? (existing && !upload ? (existing.status === 'accepted' ? 'Accepted' : 'Under review') : undefined);
  const busy = upload?.phase === 'signing' || upload?.phase === 'uploading';

  let detail: string;
  if (busy) detail = `${upload.fileName}, ${upload.phase === 'signing' ? 'signing' : 'uploading'}`;
  else if (upload?.phase === 'done') detail = outcome?.problem ?? `${upload.fileName}, ${formatLocalDay(upload.at)}`;
  else if (existing) detail = `${existing.fileName}, ${formatLocalDay(existing.uploadedAt)}`;
  else detail = 'Not uploaded yet';

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
          {DOC_NAMES[docType]}
        </Text>
        <Text size={13} color={outcome?.problem ? 'textMuted' : 'textFaint'}>
          {detail}
        </Text>
      </View>
      {word ? (
        <StatusWord>{word}</StatusWord>
      ) : (
        <Button
          label={busy ? 'Uploading' : upload?.phase === 'done' ? 'Try again' : 'Upload'}
          variant="small"
          disabled={busy || !signer}
          onPress={pick}
        />
      )}
      <BottomSheet visible={!!pending} title="Upload this file?" onClose={() => setPending(undefined)}>
        {pending ? <UploadConfirm preview={uploadPreview(docType, order.label, pending)} onConfirm={() => confirm(pending)} onAnother={chooseAnother} /> : null}
      </BottomSheet>
    </View>
  );
}

// What the exporter is about to sign: the document, the order and the file as the phone has it.
function UploadConfirm({ preview, onConfirm, onAnother }: { preview: ReturnType<typeof uploadPreview>; onConfirm: () => void; onAnother: () => void }) {
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
        You sign these exact bytes for this order. Keel only tells you the outcome.
      </Text>
      <View style={{ gap: 10 }}>
        <Button label="Confirm and upload" onPress={onConfirm} />
        <Button label="Choose another file" variant="secondary" onPress={onAnother} />
      </View>
    </View>
  );
}

function PayoutNote({ payout, me }: { payout: Hex; me: Party }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10 }} accessibilityLabel={`Paid to ${me.short}'s signed account`}>
      <View style={{ marginTop: 2 }}>
        <Icon name="lock" size={16} color="textMuted" />
      </View>
      <Text size={14} leading={1.45} color="textMuted" style={{ flex: 1 }}>
        Paid to your signed account <Address address={payout} inline size={14} color="text" />. A new bank account in a
        document is ignored.
      </Text>
    </View>
  );
}
