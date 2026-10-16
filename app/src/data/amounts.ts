// The order's token is USDC (6 decimals): PurchaseOrder.totalAmount is in token units. Invoice
// and proforma amounts (OrderTerms.invoiceAmountMinor) are in cents of the currency (2 decimals).
export const TOKEN_UNITS_PER_CENT = 10_000n;

export const centsToToken = (cents: bigint): bigint => cents * TOKEN_UNITS_PER_CENT;

// For display: the screens show amounts in cents with formatMinor and Amount
export const tokenToCents = (units: bigint): bigint => units / TOKEN_UNITS_PER_CENT;
