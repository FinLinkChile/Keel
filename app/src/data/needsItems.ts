import type { Hex } from '@keel/schemas';
import type { Href } from 'expo-router';

import type { KeelData, NeedsYou, Order, Party, Role } from './types';
import { t } from '../i18n/translate';

// What needs this person, resolved from ids to names, for Home and the notifications. Pure: the
// data and the check for an order proposed on this phone are passed in.

export type NeedsItem =
  // `proposed`: the order was proposed on this phone, so its signature screen is here
  | { key: string; kind: 'sign_order'; order: Order; counterparty: Party; proposed: boolean }
  | { key: string; kind: 'upload_documents' | 'approve_balance' | 'sign_cancel'; order: Order; counterparty: Party }
  | { key: string; kind: 'register_order'; order: Order; counterparty: Party; reason?: string }
  | { key: string; kind: 'verify_supplier'; supplier: Party };

export async function loadNeedsItems(d: KeelData, role: Role, isProposed: (orderId: Hex) => Promise<boolean>): Promise<NeedsItem[]> {
  const needs = await d.needsYou(role);
  const items = await Promise.all(needs.map((n) => resolve(d, role, n, isProposed)));
  return items.filter((i): i is NeedsItem => !!i);
}

async function resolve(d: KeelData, role: Role, n: NeedsYou, isProposed: (orderId: Hex) => Promise<boolean>): Promise<NeedsItem | undefined> {
  if (n.kind === 'verify_supplier') {
    const supplier = await d.party(n.party);
    return supplier && { key: `${n.kind}:${n.party}`, kind: n.kind, supplier };
  }
  const order = await d.order(n.orderId);
  if (!order) return undefined;
  const counterparty = await d.partyByAddress(role === 'importer' ? order.po.exporter : order.po.importer);
  if (!counterparty) return undefined;
  const key = `${n.kind}:${n.orderId}`;
  if (n.kind === 'sign_order') return { key, kind: n.kind, order, counterparty, proposed: await isProposed(n.orderId) };
  if (n.kind === 'register_order') return { key, kind: n.kind, order, counterparty, reason: n.reason };
  return { key, kind: n.kind, order, counterparty };
}

// Where a notification takes you: straight to the signature when it is on this phone
export function needsItemHref(item: NeedsItem, role: Role): Href {
  if (item.kind === 'verify_supplier') return '/suppliers';
  // The reason of the refusal is in the notification itself
  if (item.kind === 'register_order') return '/notifications';
  const orderId = item.order.po.orderId;
  // The importer signs on its review screen; the exporter's order screen is its review while
  // the order waits for its signature
  if (item.kind === 'sign_order' && item.proposed && role === 'importer') return { pathname: '/review/[orderId]', params: { orderId } };
  return { pathname: '/order/[orderId]', params: { orderId } };
}

// Why ingest refused a signed order, for the person: what it means and who fixes it
const REGISTER_REASONS: Record<string, string> = {
  unknown_importer: 'Keel does not know your company yet. Ask Keel to register it; the app tries again',
  bad_importer_signature: 'Keel could not check your signature for your company. Ask Keel to register your wallet',
  bad_exporter_signature: 'The supplier\'s signature does not match the order. Do not ship against it',
  terms_mismatch: 'The terms do not match the signed order. Send a new order',
  bad_order_id: 'The order id does not match its parties. Send a new order',
  conflict: 'Keel already has a different order with this id. Send a new order',
  invalid_request: 'Keel could not read this order. Update the app',
};

export function needsItemText(item: NeedsItem, role: Role): { title: string; detail: string } {
  if (item.kind === 'verify_supplier') {
    return { title: t('Verify {name}\'s account', { name: item.supplier.short }), detail: t('New supplier, test transfer') };
  }
  const { order, counterparty } = item;
  if (item.kind === 'upload_documents' && role === 'importer') {
    return {
      title: t('{label} is funded', { label: order.label }),
      detail: t('{name} ships next. You approve the balance when the shipment is proven', { name: counterparty.short }),
    };
  }
  if (item.kind === 'upload_documents') {
    return { title: t('Upload documents for {label}', { label: order.label }), detail: t('Ship, then upload the transport document and the invoice') };
  }
  if (item.kind === 'approve_balance') {
    return { title: t('Release the balance of {label}', { label: order.label }), detail: t('{name} shipped. You can approve the balance now', { name: counterparty.short }) };
  }
  if (item.kind === 'register_order') {
    return { title: t('{label} is not registered yet', { label: order.label }), detail: t(REGISTER_REASONS[item.reason ?? ''] ?? 'Keel could not register it. It tries again when you open the app') };
  }
  if (item.kind === 'sign_cancel') {
    return { title: t('Cancel {label}?', { label: order.label }), detail: t('{name} signed a cancellation. It takes both signatures', { name: counterparty.short }) };
  }
  return role === 'importer'
    ? { title: t('Sign {label}', { label: order.label }), detail: t('{name} signed. Yours is the last signature', { name: counterparty.short }) }
    : { title: t('Review and sign {label}', { label: order.label }), detail: t('{name} sent this order. You sign first', { name: counterparty.short }) };
}
