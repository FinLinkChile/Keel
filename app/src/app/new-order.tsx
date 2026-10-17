import type { Hex, Incoterm } from '@keel/schemas';
import { Redirect, router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { config } from '@/config';
import { proposals, useData, type SupplierRecord } from '@/data';
import { buildOrder, REQUIRED_DOCS, type BuiltOrder, type FormField } from '@/data/newOrder';
import { newProposal } from '@/data/proposals';
import { agentNotes, type AgentNote } from '@/data/agentNotes';
import {
  advanceBpsOf,
  advanceFrom,
  advanceSplit,
  FIELD_WORDS,
  knownLine,
  missingOnProforma,
  nextOrderNumber,
  NOT_ON_PROFORMA,
  parseAmount,
  parseDay,
  PROBLEM_WORDS,
  proformaNotice,
  screenFormFrom,
  shipByLine,
  termsReadLine,
  toOrderForm,
  type AdvanceChoice,
  type ScreenForm,
} from '@/data/newOrderForm';
import { pickProforma, type ProformaSource } from '@/files/pickProforma';
import { readProforma, type ProformaReading, type ProformaResult } from '@/ingest/proforma';
import { useSession } from '@/session';
import { AgentNotes } from '@/ui/AgentNotes';
import { Avatar } from '@/ui/Avatar';
import { BottomSheet, SheetOption } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { Field, type FieldNotice } from '@/ui/Field';
import { formatMinor } from '@/ui/format';
import { Icon } from '@/ui/Icon';
import { Segmented } from '@/ui/Segmented';
import { Text } from '@/ui/Text';
import { colors, fonts, gutter, radius } from '@/ui/theme';

// 03 New order (step 0 of the flow). The importer picks the supplier, adds the exporter's
// proforma, the agent reads it and prefills the terms, the importer checks each one, and the
// order is built to be sent. Only the importer opens orders.
export default function NewOrder() {
  const { role } = useSession();
  if (role !== 'importer') return <Redirect href="/home" />;
  return <NewOrderScreen />;
}

const INCOTERMS: Incoterm[] = ['EXW', 'FOB', 'CIF', 'CFR'];
const ADVANCES: { value: AdvanceChoice; label: string }[] = [
  { value: '0', label: '0%' },
  { value: '30', label: '30%' },
  { value: '50', label: '50%' },
  { value: 'other', label: 'Other' },
];
const CURRENCIES = ['USD', 'EUR', 'CNY', 'HKD'] as const;
const DOC_WORDS = { BILL_OF_LADING: 'B/L', AIR_WAYBILL: 'AWB', COMMERCIAL_INVOICE: 'invoice' } as const;

// The proforma in use: only its name and hash are kept, never the file
type Proforma = { name: string; fileHash: Hex; reading?: ProformaReading };

type Blocked = { fields: FormField[]; problems: Extract<BuiltOrder, { kind: 'blocked' }>['problems'] };

function NewOrderScreen() {
  const insets = useSafeAreaInsets();
  const { signer } = useSession();
  const data = useData(async (d) => {
    const [account, suppliers, setup, orders] = await Promise.all([d.account('importer'), d.verifiedSuppliers(), d.tradeRegistry(), d.orders()]);
    const importer = await d.party(account.party);
    if (!importer) return null;
    // Orders already placed with each supplier, for "Known, 4 orders"
    const known = Object.fromEntries(
      suppliers.map((s) => [s.party.id, orders.filter((o) => o.po.exporter.toLowerCase() === s.party.address.toLowerCase()).length]),
    );
    return { importer, suppliers, setup, known, orders, nextNumber: nextOrderNumber(orders.map((o) => o.label)) };
  }, []);

  const [phase, setPhase] = useState<'empty' | 'reading' | 'form'>('empty');
  const [step, setStep] = useState<'signing' | 'reading'>('signing');
  const [notice, setNotice] = useState<string>();
  const [proforma, setProforma] = useState<Proforma>();
  const [stored, setForm] = useState<ScreenForm>();
  const [blocked, setBlocked] = useState<Blocked>();

  // The supplier can be chosen before anything else, so the form exists from the start
  const form = stored ?? (data ? screenFormFrom(undefined, data.nextNumber) : undefined);
  const patch = (changes: Partial<ScreenForm>) => form && setForm({ ...form, ...changes });
  const supplier = data?.suppliers.find((s) => s.party.id === form?.supplierId);
  const reading = proforma?.reading;
  const notes =
    data && form
      ? agentNotes({
          supplier: supplier && { name: supplier.party.name, address: supplier.party.address },
          totalCents: parseAmount(form.amountText),
          advanceBps: advanceBpsOf(form),
          shipmentDeadline: parseDay(form.dayText),
          incoterm: form.incoterm,
          lines: reading?.proforma.lines,
          orders: data.orders,
          warnings: reading && { accountChange: reading.mentionsAccountChange, hiddenText: reading.hiddenTextDetected },
          now: Date.now() / 1000,
        })
      : [];

  async function start(source: ProformaSource) {
    if (!signer || !data || !form) return;
    setNotice(undefined);
    const file = await pickProforma(source);
    if (file === null) return;
    if (file === 'denied') return setNotice(proformaNotice('denied').text);
    setStep('signing');
    setPhase('reading');
    const result = await readProforma({
      ingestUrl: config.ingestUrl,
      chainId: config.chainId,
      signer: {
        address: () => signer.address(),
        signTypedData: async (...args) => {
          const signature = await signer.signTypedData(...args);
          setStep('reading');
          return signature;
        },
      },
      file: file.bytes,
    }).catch((): ProformaResult => ({ kind: 'failed', reason: 'server' }));

    // A new reading starts the form again; only the supplier chosen so far is kept
    const fresh = (reading?: ProformaReading) => ({ ...screenFormFrom(reading, data.nextNumber), supplierId: form.supplierId });
    if (result.kind === 'read') {
      setProforma({ name: file.name, fileHash: result.fileHash, reading: result });
      setForm(fresh(result));
      setBlocked(undefined);
      setPhase('form');
    } else if (result.kind === 'unreadable') {
      // The importer fills the form by hand, over the same signed file
      setProforma({ name: file.name, fileHash: result.fileHash });
      setForm(fresh());
      setBlocked(undefined);
      setPhase('form');
    } else {
      setNotice(proformaNotice(result).text);
      // A proforma that was already read stays in use
      setPhase(stored ? 'form' : 'empty');
    }
  }

  // No proforma: the terms can be typed, but the order has no document hash until one is added
  function fillByHand() {
    setNotice(undefined);
    setPhase('form');
  }

  async function send() {
    if (!data || !form) return;
    const { setup } = data;
    const built = buildOrder(
      toOrderForm(form, {
        importer: data.importer.address,
        supplier: supplier && { exporter: supplier.party.address, payoutAddress: supplier.payoutAddress },
        documentHash: proforma?.fileHash ?? null,
      }),
      {
        token: setup.token,
        carrier: setup.carrier.address,
        arbiter: setup.arbiter.address,
        documentVerifier: setup.documentVerifier.address,
      },
      { now: Date.now() / 1000 },
    );
    if (built.kind === 'blocked') return setBlocked({ fields: built.fields, problems: built.problems });
    setBlocked(undefined);
    // Kept on this phone until the supplier signs. Nothing leaves the device.
    const asked = proforma?.reading?.proforma;
    const quote = asked && {
      amountCents: asked.amount_minor,
      advanceBps: asked.advance_bps,
      issueDate: asked.issue_date,
      latestShipmentDate: asked.latest_shipment_date,
      lines: asked.lines,
    };
    const proposal = newProposal(built, form.goods, Date.now() / 1000, quote);
    await proposals.save(proposal);
    router.replace({ pathname: '/new-order-sent', params: { orderId: proposal.orderId } });
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={{
        paddingTop: Math.max(52, insets.top + 8),
        paddingBottom: insets.bottom + 32,
        paddingHorizontal: gutter,
        gap: 22,
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
        <Text size={20} weight={700} accessibilityRole="header" style={{ flex: 1, textAlign: 'center' }}>
          New order
        </Text>
        <View style={{ width: 44 }} />
      </View>

      {data && form ? (
        <SupplierRow
          suppliers={data.suppliers}
          known={data.known}
          selected={supplier}
          notice={blocked?.fields.includes('supplier') ? { tone: 'error', text: FIELD_WORDS.supplier } : undefined}
          onSelect={(supplierId) => patch({ supplierId })}
        />
      ) : null}

      {phase === 'empty' ? (
        <>
          <UploadBlock notice={notice} disabled={!signer || !data} onPick={start} />
          <View style={{ alignItems: 'center', gap: 14 }}>
            <Pressable accessibilityRole="button" onPress={stored ? () => setPhase('form') : fillByHand} hitSlop={8}>
              <Text size={15} weight={700} style={{ textDecorationLine: 'underline' }}>
                {stored ? 'Back to the order' : 'No proforma? Fill in by hand'}
              </Text>
            </Pressable>
          </View>
        </>
      ) : phase === 'reading' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
          <ActivityIndicator color={colors.accent} />
          <Text size={15} color="textMuted">
            {step === 'signing' ? 'Signing the upload' : 'The agent is reading the proforma'}
          </Text>
        </View>
      ) : form && data ? (
        <OrderForm
          proforma={proforma}
          notice={notice}
          form={form}
          patch={patch}
          carrier={data.setup.carrier.short}
          supplierName={supplier?.party.short}
          blocked={blocked}
          notes={notes}
          onReplace={() => {
            setNotice(undefined);
            setPhase('empty');
          }}
          onSend={send}
        />
      ) : null}
    </ScrollView>
  );
}

// 03a: nothing uploaded yet
function UploadBlock({ notice, disabled, onPick }: { notice?: string; disabled: boolean; onPick: (s: ProformaSource) => void }) {
  return (
    <View
      style={{
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: colors.locked,
        borderRadius: radius.sheet,
        paddingVertical: 28,
        paddingHorizontal: 22,
        alignItems: 'center',
        gap: 14,
      }}
    >
      <View
        accessibilityElementsHidden
        style={{
          width: 64,
          height: 80,
          borderRadius: 6,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.surfaceRaised,
          paddingTop: 14,
          paddingHorizontal: 12,
          gap: 6,
          alignItems: 'stretch',
        }}
      >
        <View style={{ height: 3, backgroundColor: colors.line }} />
        <View style={{ height: 3, backgroundColor: colors.line }} />
        <View style={{ height: 3, width: '60%', backgroundColor: colors.line }} />
        <View
          style={{
            alignSelf: 'center',
            marginTop: 'auto',
            marginBottom: 10,
            width: 26,
            height: 26,
            borderRadius: 13,
            backgroundColor: colors.accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="upload" size={14} strokeWidth={3} color="onAccent" />
        </View>
      </View>
      <Text size={24} weight={800} accessibilityRole="header" style={{ marginTop: 4 }}>
        Upload the proforma
      </Text>
      <Text size={15} leading={1.5} color="textMuted" style={{ textAlign: 'center', maxWidth: 280 }}>
        The agent reads the goods, amount, dates and terms. You check them before anyone signs.
      </Text>
      {notice ? (
        <Text size={14} leading={1.45} style={{ color: colors.danger, textAlign: 'center' }}>
          {notice}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: 8 }}>
        <PillButton label="Choose file" icon="orders" filled disabled={disabled} onPress={() => onPick('file')} />
        <PillButton label="Scan" icon="camera" disabled={disabled} onPress={() => onPick('camera')} />
      </View>
      <Text size={13} color="textFaint">
        PDF up to 10 MB, photo up to 5 MB
      </Text>
    </View>
  );
}

function PillButton({ label, icon, filled = false, disabled, onPress }: { label: string; icon: 'orders' | 'camera'; filled?: boolean; disabled: boolean; onPress: () => void }) {
  const ink = disabled ? 'textFaint' : filled ? 'onAccent' : 'text';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        height: 52,
        borderRadius: 26,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: disabled ? colors.surfaceRaised : filled ? colors.accent : 'transparent',
        borderWidth: filled ? 0 : 1,
        borderColor: colors.line,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Icon name={icon} size={18} color={ink} />
      <Text size={15} weight={700} color={ink}>
        {label}
      </Text>
    </Pressable>
  );
}

type FormProps = {
  proforma?: Proforma;
  notice?: string;
  form: ScreenForm;
  patch: (changes: Partial<ScreenForm>) => void;
  carrier: string;
  supplierName?: string;
  blocked?: Blocked;
  notes: AgentNote[];
  onReplace: () => void;
  onSend: () => void;
};

// 03: the order from the proforma
function OrderForm({ proforma, notice, form, patch, carrier, supplierName, blocked, notes, onReplace, onSend }: FormProps) {
  const reading = proforma?.reading;
  const [editing, setEditing] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const marks = reading ? missingOnProforma(reading.missing) : [];
  const blank: Record<FormField, boolean> = {
    supplier: !form.supplierId,
    orderNumber: form.orderNumber.trim() === '',
    currency: !form.currency,
    amount: form.amountText.trim() === '',
    incoterm: !form.incoterm,
    hsCodes: form.hsText.trim() === '',
    shipmentDeadline: form.dayText.trim() === '',
    advance: !form.advance,
    documentHash: !proforma,
  };
  const failed = (field: FormField) => !!blocked?.fields.includes(field);
  // A blocked field says why; one the proforma did not print says so until it is filled in
  const noticeOf = (field: FormField): FieldNotice | undefined => {
    if (failed(field)) return { tone: 'error', text: FIELD_WORDS[field] };
    if (marks.includes(field) && blank[field]) return { tone: 'missing', text: NOT_ON_PROFORMA };
    return undefined;
  };
  // A term opens for editing when the importer asked, when it is empty or when it blocked the order
  const open = (field: FormField) => editing || blank[field] || failed(field);

  const total = parseAmount(form.amountText);
  const bps = advanceBpsOf(form);
  const split = total !== null && total > 0 && bps !== null ? advanceSplit(total, bps) : undefined;
  let advanceLine: string | null = null;
  if (split) {
    advanceLine =
      bps === 0
        ? `Nothing on signing. ${formatMinor(split.onShipment)} when shipment is proven.`
        : `${formatMinor(split.onSigning)} on signing, ${formatMinor(split.onShipment)} when shipment is proven.`;
  } else if (form.advance === 'other') {
    advanceLine = 'Type the percentage you agreed.';
  }

  const currencyHidden = form.currency === 'USD';
  const moreForced = open('orderNumber') || open('hsCodes') || !currencyHidden;
  const moreShown = showMore || moreForced;
  const moreCount = 4 + (currencyHidden ? 0 : 1);

  return (
    <>
      <View style={{ gap: 10 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
            backgroundColor: colors.surface,
            borderRadius: radius.row,
            paddingVertical: 14,
            paddingHorizontal: 16,
          }}
        >
          <DocumentMark ok={!!reading} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text size={15} weight={700} numberOfLines={1}>
              {proforma ? proforma.name : 'No proforma yet'}
            </Text>
            <Text size={13} color="textMuted">
              {reading ? termsReadLine(reading) : proforma ? 'Uploaded. The agent could not read it.' : 'Add it before you send'}
            </Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={proforma ? 'Replace the proforma' : 'Add the proforma'} hitSlop={8} onPress={onReplace} style={{ flexShrink: 0 }}>
            <Text size={14} weight={700} numberOfLines={1} style={{ textDecorationLine: 'underline' }}>
              {proforma ? 'Replace' : 'Add'}
            </Text>
          </Pressable>
        </View>
        {failed('documentHash') ? (
          <Text size={13} style={{ color: colors.danger }}>
            {FIELD_WORDS.documentHash}
          </Text>
        ) : null}
        {notice ? (
          <Text size={14} leading={1.45} style={{ color: colors.danger }}>
            {notice}
          </Text>
        ) : null}
        {proforma && !reading ? <Warning>The agent could not read this file. Fill in the terms by hand.</Warning> : null}
      </View>

      <AgentNotes
        notes={notes}
        onApply={(note) => note.suggestion && patch(advanceFrom(note.suggestion.value))}
        footer="The agent compares this order with your company's orders. It suggests; you decide and sign."
      />

      <View style={{ gap: 10 }}>
        <TextInput
          accessibilityLabel="Goods"
          value={form.goods}
          onChangeText={(goods) => patch({ goods })}
          placeholder="What is being bought"
          placeholderTextColor={colors.textFaint}
          selectionColor={colors.accent}
          multiline
          style={{ padding: 0, color: colors.text, fontFamily: fonts.sans[800], fontSize: 28, lineHeight: 32 }}
        />
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <TextInput
            accessibilityLabel={form.currency ? `Total, ${form.currency}` : 'Total'}
            value={form.amountText}
            onChangeText={(amountText) => patch({ amountText })}
            placeholder="0.00"
            placeholderTextColor={colors.textFaint}
            selectionColor={colors.accent}
            keyboardType="decimal-pad"
            style={{ flexShrink: 1, minWidth: 120, padding: 0, color: colors.text, fontFamily: fonts.mono[600], fontSize: 40, letterSpacing: -1.5 }}
          />
          {form.currency ? (
            <Text size={16} weight={700} color="textMuted">
              {form.currency}
            </Text>
          ) : null}
        </View>
        <NoticeLine notice={noticeOf('amount')} />
      </View>

      <View style={{ gap: 12 }}>
        <Text size={18} weight={800}>
          Advance when both sign
        </Text>
        <Segmented
          options={ADVANCES}
          value={form.advance ?? ('' as AdvanceChoice)}
          onChange={(advance) => patch({ advance })}
          accessibilityLabel="Advance"
          role="radiogroup"
        />
        {form.advance === 'other' ? (
          <Field
            label="Advance, %"
            mono
            keyboardType="decimal-pad"
            value={form.advanceOther}
            onChangeText={(advanceOther) => patch({ advanceOther })}
            placeholder="40"
          />
        ) : null}
        {advanceLine ? (
          <Text size={14} leading={1.45} style={{ color: bps === 0 ? colors.yourTurn : colors.textMuted }}>
            {advanceLine}
          </Text>
        ) : null}
        <NoticeLine notice={noticeOf('advance')} />
      </View>

      <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, paddingTop: 6, paddingHorizontal: 20, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, paddingTop: 12, paddingBottom: 10 }}>
          <Text size={16} weight={800} style={{ flex: 1, flexShrink: 1 }}>
            Terms from the proforma
          </Text>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setEditing(!editing)} style={{ flexShrink: 0 }}>
            <Text size={14} weight={700} numberOfLines={1} style={{ textDecorationLine: 'underline' }}>
              {editing ? 'Done' : 'Correct a term'}
            </Text>
          </Pressable>
        </View>

        {open('shipmentDeadline') || open('incoterm') ? (
          <TermEdit>
            <Field
              label="On board by"
              raised
              value={form.dayText}
              onChangeText={(dayText) => patch({ dayText })}
              placeholder="Nov 20, 2026"
              notice={noticeOf('shipmentDeadline')}
            />
            <View style={{ gap: 6 }}>
              <Text size={14} weight={600}>
                Incoterm
              </Text>
              <Segmented
                on="surface"
                options={INCOTERMS.map((i) => ({ value: i, label: i }))}
                value={form.incoterm ?? ('' as Incoterm)}
                onChange={(incoterm) => patch({ incoterm })}
                accessibilityLabel="Incoterm"
                role="radiogroup"
              />
              <NoticeLine notice={noticeOf('incoterm')} />
            </View>
          </TermEdit>
        ) : (
          <Term label="Ship by" value={shipByLine(form)} />
        )}
        <Term label="Proof from" value={`${carrier} (test key)`} />

        {moreShown ? (
          <>
            {open('orderNumber') ? (
              <TermEdit>
                <Field
                  label="Order number"
                  raised
                  mono
                  autoCapitalize="characters"
                  value={form.orderNumber}
                  onChangeText={(orderNumber) => patch({ orderNumber })}
                  notice={noticeOf('orderNumber')}
                />
              </TermEdit>
            ) : (
              <Term label="Order number" value={form.orderNumber} mono />
            )}
            {open('hsCodes') ? (
              <TermEdit>
                <Field
                  label="HS codes"
                  raised
                  mono
                  value={form.hsText}
                  onChangeText={(hsText) => patch({ hsText })}
                  placeholder="130231, 350300"
                  notice={noticeOf('hsCodes')}
                />
              </TermEdit>
            ) : (
              <Term label="HS code" value={form.hsText} mono />
            )}
            <Term label="Disputes settled by" value="Arbiter (test key)" />
            <Term label="Documents for the balance" value={REQUIRED_DOCS.map((d) => DOC_WORDS[d]).join(', ')} />
            {!currencyHidden ? (
              <TermEdit>
                <Text size={14} weight={600}>
                  Currency
                </Text>
                <Segmented
                  on="surface"
                  options={CURRENCIES.map((c) => ({ value: c, label: c }))}
                  value={form.currency ?? ('' as 'USD')}
                  onChange={(currency) => patch({ currency })}
                  accessibilityLabel="Currency"
                  role="radiogroup"
                />
                <NoticeLine notice={form.currency ? { tone: 'error', text: PROBLEM_WORDS.currency_is_not_the_token } : noticeOf('currency')} />
              </TermEdit>
            ) : null}
          </>
        ) : null}

        {!moreForced ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showMore }}
            onPress={() => setShowMore(!showMore)}
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingVertical: 13,
              borderTopWidth: 1,
              borderTopColor: colors.dividerOnSurface,
            }}
          >
            <Text size={15} weight={700}>
              {showMore ? 'Show less' : `Show ${moreCount} more terms`}
            </Text>
            <View style={{ transform: [{ rotate: showMore ? '180deg' : '0deg' }] }}>
              <Icon name="chevronDown" size={14} strokeWidth={2.4} color="textFaint" />
            </View>
          </Pressable>
        ) : null}
      </View>

      <View style={{ gap: 12 }}>
        {blocked && blocked.problems.length > 0 ? (
          <View style={{ gap: 4 }}>
            {blocked.problems.map((p) => (
              <Text key={p} size={14} leading={1.4} style={{ color: colors.danger }}>
                {PROBLEM_WORDS[p]}
              </Text>
            ))}
          </View>
        ) : null}
        {blocked && blocked.fields.length > 0 ? (
          <Text size={14} style={{ color: colors.danger }}>
            Check the marked fields.
          </Text>
        ) : null}
        <Button label={supplierName ? `Send to ${supplierName}` : 'Send to the supplier'} onPress={onSend} />
        <Text size={13} leading={1.5} color="textFaint" style={{ textAlign: 'center' }}>
          {supplierName ?? 'The supplier'} checks and signs first. You sign last, and that is when the agent deposits.
        </Text>
      </View>
    </>
  );
}

function Term({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 12,
        paddingVertical: 13,
        borderTopWidth: 1,
        borderTopColor: colors.dividerOnSurface,
      }}
    >
      <Text size={15} color="textMuted" style={{ flexShrink: 0 }}>
        {label}
      </Text>
      <Text mono={mono} size={mono ? 14 : 15} weight={mono ? undefined : 600} style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </Text>
    </View>
  );
}

// A term opened for editing, inside the card
function TermEdit({ children }: { children: ReactNode }) {
  return <View style={{ gap: 12, paddingVertical: 13, borderTopWidth: 1, borderTopColor: colors.dividerOnSurface }}>{children}</View>;
}

function NoticeLine({ notice }: { notice?: FieldNotice }) {
  if (!notice) return null;
  return (
    <Text size={13} style={{ color: notice.tone === 'error' ? colors.danger : colors.yourTurn }}>
      {notice.text}
    </Text>
  );
}

// A warning about the file. It never fills a field.
function Warning({ children }: { children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: colors.danger }} />
      <Text size={14} leading={1.4} color="textSoft" style={{ flex: 1 }}>
        {children}
      </Text>
    </View>
  );
}

// The supplier comes first. "Choose a supplier" until the importer picks one of the verified
// suppliers in a sheet, and nothing is preselected: the supplier decides who is paid.
function SupplierRow({
  suppliers,
  known,
  selected,
  notice,
  onSelect,
}: {
  suppliers: SupplierRecord[];
  known: Record<string, number>;
  selected?: SupplierRecord;
  notice?: FieldNotice;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 10 }}>
      <Text size={15} weight={700}>
        Supplier
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={selected ? `Supplier, ${selected.party.name}. Change` : 'Choose a supplier'}
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 12,
          paddingHorizontal: 16,
          borderRadius: radius.row,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: notice?.tone === 'error' ? colors.danger : colors.surface,
          opacity: pressed ? 0.8 : 1,
        })}
      >
        {selected ? (
          <>
            <Avatar name={selected.party.name} tint={selected.party.tint} size={36} />
            <View style={{ flex: 1 }}>
              <Text size={16} weight={700}>
                {selected.party.name}
              </Text>
              <Text size={13} color="textMuted">
                {knownLine(known[selected.party.id] ?? 0)}
              </Text>
            </View>
            <Text size={14} weight={700} numberOfLines={1} style={{ flexShrink: 0 }}>
              Change
            </Text>
          </>
        ) : (
          <>
            <Text size={16} weight={600} color="textMuted" style={{ flex: 1, paddingVertical: 8 }}>
              Choose a supplier
            </Text>
            <View style={{ transform: [{ rotate: '90deg' }] }}>
              <Icon name="chevron" size={18} color="textMuted" />
            </View>
          </>
        )}
      </Pressable>
      <NoticeLine notice={notice} />
      <BottomSheet visible={open} title="Choose a supplier" onClose={() => setOpen(false)}>
        {suppliers.map((s) => (
          <SheetOption
            key={s.party.id}
            label={s.party.name}
            hint={`${s.party.place}. ${knownLine(known[s.party.id] ?? 0)}`}
            leading={<Avatar name={s.party.name} tint={s.party.tint} size={36} />}
            onPress={() => {
              onSelect(s.party.id);
              setOpen(false);
            }}
          />
        ))}
      </BottomSheet>
    </View>
  );
}

// A small sheet of paper; ticked once the agent has read it
function DocumentMark({ ok }: { ok: boolean }) {
  return (
    <View accessibilityElementsHidden style={{ width: 32, height: 40 }}>
      <View
        style={{
          flex: 1,
          borderRadius: 4,
          backgroundColor: colors.text,
          paddingVertical: 7,
          paddingHorizontal: 6,
          gap: 4,
        }}
      >
        <View style={{ height: 2, backgroundColor: colors.control }} />
        <View style={{ height: 2, backgroundColor: colors.control }} />
        <View style={{ height: 2, width: '60%', backgroundColor: colors.control }} />
      </View>
      {ok ? (
        <View
          style={{
            position: 'absolute',
            right: -6,
            bottom: -6,
            width: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: colors.money,
            borderWidth: 2,
            borderColor: colors.surface,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="check" size={9} strokeWidth={4} color="onAccent" />
        </View>
      ) : null}
    </View>
  );
}
