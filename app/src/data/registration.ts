import type { Hex } from '@keel/schemas';

import type { Signer, Signers } from '../wallet/signer';

import { isApiError, type ApiClient } from './api';
import { reportApiFailure, reportApiSuccess } from './apiHealth';
import type { Role } from './types';

// Whether the Keel server knows the wallets of this phone. The importer's wallet acts for the
// company's Safe only if the operator registered it as one of the Safe's representatives
// (POST /importers, docs/arquitectura/aws-api-y-datos.md); until then every buyer route answers
// not_importer. GET /wallet lists the Safes a signer represents, so the check signs one read and
// sends nothing else. The supplier's wallet needs no registration: it acts for itself, as the
// exporter written in each order.

export type RegistrationStatus =
  // The importer wallet is a representative of the company's Safe
  | 'registered'
  // The server answered and does not list the Safe for this wallet
  | 'not_registered'
  // The supplier wallet: nothing to register
  | 'not_needed'
  // No Safe configured in the app (EXPO_PUBLIC_IMPORTER_SAFE): nothing to compare with
  | 'no_safe'
  // The server could not be asked; `code` says why
  | 'unknown';

export interface WalletRegistration {
  role: Role;
  address: Hex;
  status: RegistrationStatus;
  code?: string;
}

export async function checkRegistration(api: ApiClient, role: Role, signer: Signer, safe: Hex | undefined): Promise<WalletRegistration> {
  const address = await signer.address();
  if (role === 'exporter') return { role, address, status: 'not_needed' };
  if (!safe) return { role, address, status: 'no_safe' };
  try {
    const wallets = await api.wallet(signer);
    reportApiSuccess('registration');
    const registered = wallets.some((w) => w.safe.toLowerCase() === safe.toLowerCase());
    return { role, address, status: registered ? 'registered' : 'not_registered' };
  } catch (e) {
    // A Safe the wallet does not represent can also come back as a refusal
    if (isApiError(e, 'not_representative') || isApiError(e, 'not_importer')) return { role, address, status: 'not_registered' };
    reportApiFailure('registration', e);
    return { role, address, status: 'unknown', code: isApiError(e) ? e.code : 'network' };
  }
}

// Every wallet on this phone, importer first
export async function checkRegistrations(api: ApiClient, signers: Signers, safe: Hex | undefined): Promise<WalletRegistration[]> {
  const out: WalletRegistration[] = [];
  for (const role of ['importer', 'exporter'] as const) {
    const signer = signers[role];
    if (signer) out.push(await checkRegistration(api, role, signer, safe));
  }
  return out;
}
