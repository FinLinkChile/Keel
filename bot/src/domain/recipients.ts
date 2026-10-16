// Who receives a notice. Two separate dimensions:
// - the account (who it is): a company or a person, the two account types of T4.9;
// - the side (what part it plays in an order): only in Keel Trade, and it comes with the notice.
import { z } from "zod";

// Opaque registry id. Names live in the recipient directory, never in a notice.
export const AccountId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);
export type AccountId = z.infer<typeof AccountId>;

export const ACCOUNT_KINDS = ["company", "personal"] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export const ROLES = ["owner", "operator", "cosigner"] as const;
export type Role = (typeof ROLES)[number];

// A personal account has no operator.
export const ROLES_BY_KIND: Record<AccountKind, readonly Role[]> = {
  company: ["owner", "operator", "cosigner"],
  personal: ["owner", "cosigner"],
};

export const SIDES = ["importer", "exporter", "arbiter"] as const;
export type Side = (typeof SIDES)[number];

// side: the part the account plays in the order of the notice. Trade only;
// in Personal there is no order with two parties and side is absent.
export interface Recipient {
  accountId: AccountId;
  role: Role;
  side?: Side;
}
