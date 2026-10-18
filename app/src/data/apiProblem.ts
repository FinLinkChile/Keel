import { isApiError } from './api';

// What a screen says when the Keel API refuses a request. Only the error code is read; the
// server never echoes input, and nothing else of the reply is shown.
const WORDS: Record<string, string> = {
  network: "Couldn't reach Keel, check the connection",
  missing_signature: "Check the phone's date and time, then try again",
  stale_signature: "Check the phone's date and time, then try again",
  bad_signature: "Check the phone's date and time, then try again",
  signer_mismatch: "Check the phone's date and time, then try again",
  no_wallet: 'This phone has no wallet for that side of the order',
  not_found: 'Keel does not know this order, or this wallet is not a party to it',
  not_importer: "This wallet can't act for the buyer",
  not_exporter: "This wallet can't act for the supplier",
  not_a_party: "This wallet can't act for either side of this order",
  not_representative: 'This wallet is not registered for the buyer',
  wrong_status: 'This order changed in the meantime. Go back and open it again',
  proposal_exists: 'This order was already sent',
  invalid_order: 'Keel refused this order: it would not open in the escrow',
  invalid_state: 'The order is no longer in a state where this applies',
  stale_cancel_nonce: 'The order moved on. Open it again and sign again',
  no_shipment: 'There is no attested shipment yet',
  attestation_mismatch: 'The shipment changed. Open the order again',
  bad_importer_signature: 'The signature was not accepted. Check that this wallet owns the Safe',
  bad_exporter_signature: 'The signature was not accepted for this order',
  rpc_unavailable: 'Keel could not check the signature right now, try again',
  conflict: 'Someone else signed at the same time, try again',
  bad_request: 'Keel could not read the request',
};

export function apiProblem(e: unknown): string | undefined {
  if (!isApiError(e)) return undefined;
  return WORDS[e.code] ?? 'Something went wrong on our side, try again';
}
