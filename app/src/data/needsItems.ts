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
  return n.kind === 'sign_order'
    ? { key, kind: n.kind, order, counterparty, proposed: await isProposed(n.orderId) }
    : { key, kind: n.kind, order, counterparty };
}

// Where a notification takes you: straight to the signature when it is on this phone
export function needsItemHref(item: NeedsItem, role: Role): Href {
  if (item.kind === 'verify_supplier') return '/suppliers';
  const orderId = item.order.po.orderId;
  // The importer signs on its review screen; the exporter's order screen is its review while
  // the order waits for its signature
  if (item.kind === 'sign_order' && item.proposed && role === 'importer') return { pathname: '/review/[orderId]', params: { orderId } };
  return { pathname: '/order/[orderId]', params: { orderId } };
}

export function needsItemText(item: NeedsItem, role: Role): { title: string; detail: string } {
  if (item.kind === 'verify_supplier') {
    return { title: t('Verify {name}\'s account', { name: item.supplier.short }), detail: t('New supplier, test transfer') };
  }
  const { order, counterparty } = item;
  if (item.kind === 'upload_documents') {
    return { title: t('Upload documents for {label}', { label: order.label }), detail: t('Ship, then upload the transport document and the invoice') };
  }
  if (item.kind === 'approve_balance') {
    return { title: t('Release the balance of {label}', { label: order.label }), detail: t('{name} shipped. You can approve the balance now', { name: counterparty.short }) };
  }
  if (item.kind === 'sign_cancel') {
    return { title: t('Cancel {label}?', { label: order.label }), detail: t('{name} signed a cancellation. It takes both signatures', { name: counterparty.short }) };
  }
  return role === 'importer'
    ? { title: t('Sign {label}', { label: order.label }), detail: t('{name} signed. Yours is the last signature', { name: counterparty.short }) }
    : { title: t('Review and sign {label}', { label: order.label }), detail: t('{name} sent this order. You sign first', { name: counterparty.short }) };
}
