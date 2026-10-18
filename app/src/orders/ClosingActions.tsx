import type { Hex } from '@keel/schemas';
import { useState } from 'react';
import { View } from 'react-native';

import { config } from '@/config';
import { api, refreshData, useData, type Role } from '@/data';
import { isApiError, type OrderView } from '@/data/api';
import { apiProblem } from '@/data/apiProblem';
import { approveBalance, balanceApprovalDetails, canApproveBalance, canCancel, canDispute, signCancellation } from '@/data/closing';
import { SIGNING_NOT_SET_UP, signingSetup } from '@/data/signOrder';
import { useSession } from '@/session';
import { BottomSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { Text } from '@/ui/Text';
import { colors, radius } from '@/ui/theme';

// What a party can sign to close an open order, when the Keel API is configured: the importer
// approves the balance of a shipped order; either side signs a mutual cancellation. The API
// stores the signature and the agent submits it; the escrow checks it again. A dispute is a
// transaction of a party (raiseDispute), which this app does not send: it explains how instead.
function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Text size={13} color="textMuted">
        {label}
      </Text>
      <Text size={13} {...(mono ? { mono: true as const } : { weight: 700 as const })} selectable>
        {value}
      </Text>
    </View>
  );
}

export function ClosingActions({ orderId, role }: { orderId: Hex; role: Role }) {
  const { signer, address } = useSession();
  const [busy, setBusy] = useState<'approve' | 'cancel'>();
  const [problem, setProblem] = useState<string>();
  const [disputeHelp, setDisputeHelp] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);

  const view = useData(async () => {
    if (!api || !signer) return null;
    try {
      return await api.getOrder(signer, orderId);
    } catch (e) {
      if (isApiError(e, 'not_found')) return null;
      return { error: apiProblem(e) ?? 'Something went wrong on our side, try again' };
    }
  }, [orderId, address]);

  if (!api || !view) return null;
  if ('error' in view) {
    return (
      <Text size={14} color="textMuted">
        {view.error}
      </Text>
    );
  }
  const order: OrderView = view;
  if (!order.you.includes(role)) return null;
  const setup = signingSetup(config);

  async function run(kind: 'approve' | 'cancel', act: () => Promise<unknown>) {
    setBusy(kind);
    setProblem(undefined);
    try {
      await act();
      refreshData();
    } catch (e) {
      setProblem(apiProblem(e) ?? 'The wallet could not sign. Try again.');
    }
    setBusy(undefined);
  }

  const cancel = order.closing?.cancel;
  const mine = role === 'importer' ? cancel?.sigImporter : cancel?.sigExporter;
  const theirs = role === 'importer' ? cancel?.sigExporter : cancel?.sigImporter;
  const other = role === 'importer' ? 'The supplier' : 'The buyer';
  const showApprove = role === 'importer' && canApproveBalance(order);
  const showCancel = canCancel(order.state);
  const showDispute = canDispute(order.state);
  const approved = !!order.closing?.balanceApproval;
  const details = balanceApprovalDetails(order);

  if (!showApprove && !showCancel && !showDispute && order.state !== 'DISPUTED' && !approved) return null;

  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.sheet, padding: 20, gap: 12 }}>
      <Text size={18} weight={800} accessibilityRole="header">
        Close the order
      </Text>

      {order.state === 'DISPUTED' ? (
        <Text size={14} leading={1.45} color="textMuted">
          In dispute. The balance stays in escrow until the arbiter splits it between you and the supplier&apos;s signed account, or
          both of you sign a cancellation.
        </Text>
      ) : null}

      {approved && order.state === 'SHIPPED' ? (
        <Text size={14} leading={1.45} color="textMuted">
          Balance approved. The agent releases it to the signed account on its next pass.
        </Text>
      ) : null}

      {showApprove ? (
        <View style={{ gap: 8 }}>
          <Text size={14} leading={1.45} color="textMuted">
            The carrier attested the shipment. Approving pays the balance to the supplier&apos;s signed account now, without waiting
            for the document check or the dispute window.
          </Text>
          <Button
            label={busy === 'approve' ? 'Signing' : 'Approve balance'}
            disabled={!!busy || !signer || !setup}
            onPress={() => setConfirmApprove(true)}
          />
        </View>
      ) : null}

      {showCancel ? (
        <View style={{ gap: 8 }}>
          <Text size={14} leading={1.45} color="textMuted">
            {mine && !theirs
              ? `You signed the cancellation. ${other} has to sign it too.`
              : theirs && !mine
                ? `${other} signed a cancellation. With your signature, what is left in escrow goes back to the buyer.`
                : 'A cancellation needs both signatures. What is left in escrow goes back to the buyer.'}
          </Text>
          {!mine ? (
            <Button
              label={busy === 'cancel' ? 'Signing' : 'Sign cancellation'}
              variant="secondary"
              disabled={!!busy || !signer || !setup}
              onPress={() => setConfirmCancel(true)}
            />
          ) : null}
        </View>
      ) : null}

      {showDispute ? (
        <Button label="Raise dispute" variant="secondary" onPress={() => setDisputeHelp(true)} />
      ) : null}

      {!setup ? (
        <Text size={13} color="textMuted">
          {SIGNING_NOT_SET_UP}
        </Text>
      ) : null}
      {problem ? (
        <Text size={13} style={{ color: colors.danger }}>
          {problem}
        </Text>
      ) : null}

      <BottomSheet visible={confirmApprove && !!details} title="Approve the balance?" onClose={() => setConfirmApprove(false)}>
        <View style={{ gap: 14, paddingTop: 6 }}>
          <Text size={14} leading={1.45} color="textMuted">
            Your signature pays the balance to the supplier&apos;s signed account now, without waiting for the document check or the
            dispute window. It names this shipment attestation:
          </Text>
          {details ? (
            <View style={{ gap: 6 }}>
              <DetailRow label="Balance" value={`${details.balance} USDC`} />
              <DetailRow label="On board" value={details.onBoardDate} />
              <DetailRow label="Port of loading" value={details.portOfLoading} />
              <DetailRow label="B/L number hash" value={details.blNumberHash} mono />
            </View>
          ) : null}
          <Button
            label="Approve balance"
            onPress={() => {
              setConfirmApprove(false);
              void run('approve', () => approveBalance(api!, signer!, setup!, order));
            }}
          />
          <Button label="Not now" variant="secondary" onPress={() => setConfirmApprove(false)} />
        </View>
      </BottomSheet>

      <BottomSheet visible={confirmCancel} title="Sign the cancellation?" onClose={() => setConfirmCancel(false)}>
        <View style={{ gap: 14, paddingTop: 6 }}>
          <Text size={14} leading={1.45} color="textMuted">
            Your signature is valid only in the order&apos;s current state. Once both of you sign, the agent cancels the order and
            what is left in escrow goes back to the buyer.
          </Text>
          <Button
            label="Sign cancellation"
            onPress={() => {
              setConfirmCancel(false);
              void run('cancel', () => signCancellation(api!, signer!, setup!, order, role));
            }}
          />
          <Button label="Keep the order" variant="secondary" onPress={() => setConfirmCancel(false)} />
        </View>
      </BottomSheet>

      <BottomSheet visible={disputeHelp} title="Raise a dispute" onClose={() => setDisputeHelp(false)}>
        <View style={{ gap: 12, paddingTop: 6 }}>
          <Text size={14} leading={1.45} color="textMuted">
            A dispute freezes the balance until the arbiter decides how to split it between the buyer and the supplier&apos;s signed
            account. It is a transaction on the escrow, raiseDispute(orderId), sent by the buyer&apos;s Safe or the supplier&apos;s
            wallet. This app does not send transactions yet: send it from that wallet with this order id.
          </Text>
          <Text mono size={12} selectable>
            {order.orderId}
          </Text>
          <Button label="Close" variant="secondary" onPress={() => setDisputeHelp(false)} />
        </View>
      </BottomSheet>
    </View>
  );
}
