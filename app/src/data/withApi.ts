import type { Hex } from '@keel/schemas';

import { t } from '../i18n/translate';
import type { Signer, Signers } from '../wallet/signer';

import { tokenToCents } from './amounts';
import { isApiError, type ApiClient, type Need, type OrderView } from './api';
import { decodeOrder } from './proposals';
import type { KeelData, NeedsYou, Order, OrderStage, Role } from './types';

// The data source when the Keel API is configured (EXPO_PUBLIC_API_URL): the orders, what needs
// you and the locked amounts come from the API, read with the wallets of this phone. Parties and
// the trade setup still come from the base (the API has no names for them yet). `base` already
// includes the API proposals (withProposals over httpProposalStore).

const STAGE: Record<string, OrderStage> = {
  NONE: 'signed',
  OPEN: 'signed',
  ADVANCE_PAID: 'advance_paid',
  SHIPPED: 'shipped',
  // No stage of its own on the screens: the balance is frozen after a shipment
  DISPUTED: 'shipped',
  SETTLED: 'settled',
  REFUNDED: 'refunded',
  // Split by the arbiter: the order is closed
  RESOLVED: 'settled',
  CANCELLED: 'cancelled',
};

export function orderFromView(v: OrderView, carrier: string, goods?: string): Order {
  const { po, terms } = decodeOrder({ po: v.order, terms: v.terms });
  const label = v.label ?? terms.orderNumber;
  const stage = STAGE[v.state] ?? 'signed';
  return {
    label,
    goods: goods || t('Order {label}', { label }),
    goodsShort: goods || label,
    quantity: '',
    carrier,
    stage,
    // The exporter ships and uploads; nobody else has a turn the API knows of
    ...(stage === 'advance_paid' && { waitingOn: 'exporter' as const }),
    // The order exists on the API once both signed
    signedAt: v.createdAt,
    transportDoc: 'BILL_OF_LADING',
    documents: [],
    po,
    terms,
    escrowState: v.state,
    ...(v.shipment && { shipment: v.shipment }),
  };
}

export function needFromApi(n: Need): NeedsYou {
  switch (n.action) {
    case 'sign_as_exporter':
    case 'sign_as_importer':
      return { kind: 'sign_order', orderId: n.orderId };
    case 'approve_balance':
      return { kind: 'approve_balance', orderId: n.orderId };
    case 'sign_cancel':
      return { kind: 'sign_cancel', orderId: n.orderId, ...(n.cancelNonce !== undefined && { cancelNonce: n.cancelNonce }) };
    case 'upload_documents':
      return { kind: 'upload_documents', orderId: n.orderId };
  }
}

const ROLES: readonly Role[] = ['importer', 'exporter'];

// A read that fails (network, server) shows the fallback and says so in the logs, instead of a
// screen that never finishes loading
async function orElse<T>(what: string, read: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (e) {
    console.warn(`keel api: ${what} failed`, isApiError(e) ? e.code : e);
    return fallback();
  }
}

export function withApi(base: KeelData, api: ApiClient, signers: () => Signers): KeelData {
  const available = (): Signer[] => ROLES.map((r) => signers()[r]).filter((s): s is Signer => !!s);
  const carrierId = async (po: { carrier: Hex }) => (await base.partyByAddress(po.carrier))?.id ?? '';

  // Every order this phone's wallets are a party of, by lowercase orderId
  async function views(): Promise<Map<string, OrderView>> {
    const byId = new Map<string, OrderView>();
    for (const s of available()) for (const v of await api.listOrders(s)) byId.set(v.orderId.toLowerCase(), v);
    return byId;
  }

  async function view(orderId: Hex): Promise<OrderView | undefined> {
    for (const s of available()) {
      try {
        return await api.getOrder(s, orderId);
      } catch (e) {
        if (!isApiError(e, 'not_found')) throw e;
      }
    }
    return undefined;
  }

  const toOrder = async (v: OrderView, goods?: string) => orderFromView(v, await carrierId(decodeOrder({ po: v.order, terms: v.terms }).po), goods);

  return {
    ...base,
    // Proposals still being signed, then the orders of the API in their escrow state. A fully
    // signed proposal is shown as its order, with the goods typed in the proposal.
    orders: () =>
      orElse('orders', async () => {
        const [listed, byId] = await Promise.all([base.orders(), views()]);
        const out: Order[] = [];
        for (const o of listed) {
          const v = byId.get(o.po.orderId.toLowerCase());
          if (v) {
            out.push(await toOrder(v, o.goods));
            byId.delete(o.po.orderId.toLowerCase());
          } else out.push(o);
        }
        for (const v of byId.values()) out.push(await toOrder(v));
        return out;
      }, base.orders),
    order: (orderId) =>
      orElse('order', async () => {
        const proposed = await base.order(orderId);
        if (proposed && proposed.stage !== 'signed') return proposed;
        const v = await view(orderId);
        return v ? toOrder(v, proposed?.goods) : proposed;
      }, () => base.order(orderId)),
    needsYou: async (role) => {
      const s = signers()[role];
      if (!s) return [];
      return orElse(
        'needs-you',
        async () => {
          const seen = new Set<string>();
          const out: NeedsYou[] = [];
          for (const n of await api.needsYou(s)) {
            if (n.as !== role) continue;
            const need = needFromApi(n);
            const key = `${need.kind}:${n.orderId.toLowerCase()}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(need);
          }
          return out;
        },
        async () => [],
      );
    },
    // Available money and the agent's allowance are not in the API: they stay the base's
    wallet: async (role) => {
      const w = await base.wallet(role);
      const s = signers()[role];
      if (!s) return w;
      return orElse(
        'wallet',
        async () => {
          let locked = 0n;
          if (role === 'importer') for (const safe of await api.wallet(s)) locked += BigInt(safe.locked);
          else for (const v of await api.listOrders(s)) if (v.you.includes('exporter')) locked += BigInt(v.locked);
          return { ...w, lockedMinor: tokenToCents(locked) };
        },
        async () => w,
      );
    },
  };
}
