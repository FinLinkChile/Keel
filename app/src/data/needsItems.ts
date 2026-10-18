import type { Hex } from '@keel/schemas';
import type { Href } from 'expo-router';

import type { KeelData, NeedsYou, Order, Party, Role } from './types';

// What needs this person, resolved from ids to names, for Home and the notifications. Pure: the
// data and the check for an order proposed on this phone are passed in.

export type NeedsItem =
  // `proposed`: the order was proposed on this phone, so its signature screen is here
  | { key: string; kind: 'sign_order'; order: Order; counterparty: Party; proposed: boolean }
  | { key: string; kind: 'upload_documents'; order: Order; counterparty: Party }
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
    return { title: `Verify ${item.supplier.short}'s account`, detail: 'New supplier, test transfer' };
  }
  const { order, counterparty } = item;
  if (item.kind === 'upload_documents') {
    return { title: `Upload documents for ${order.label}`, detail: 'Ship, then upload the transport document and the invoice' };
  }
  return role === 'importer'
    ? { title: `Sign ${order.label}`, detail: `${counterparty.short} signed. Yours is the last signature` }
    : { title: `Review and sign ${order.label}`, detail: `${counterparty.short} sent this order. You sign first` };
}
