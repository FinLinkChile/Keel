// Formatting shared by the components. Pure functions, so they can be unit tested.

// 4800000n with 2 decimals -> "48,000.00"
export function formatMinor(minor: bigint, decimals = 2): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const base = 10n ** BigInt(decimals);
  const whole = (abs / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = decimals > 0 ? '.' + (abs % base).toString().padStart(decimals, '0') : '';
  return (negative ? '-' : '') + whole + fraction;
}

// "0x7A3f91C2...55D8" -> ["0x7A3f", "91C2", ..., "55D8"]: the 0x stays with the first group.
export function addressGroups(address: string): string[] {
  const body = address.replace(/^0x/i, '');
  const groups = body.match(/.{1,4}/g) ?? [];
  if (groups.length > 0) groups[0] = '0x' + groups[0];
  return groups;
}

// full: where the payee is decided. short: next to a name. inline: inside a sentence, where
// two groups would wrap the line ("0x3E9d … 8812").
export type AddressForm = 'full' | 'short' | 'inline';

export function formatAddress(address: string, form: AddressForm = 'short'): string {
  const groups = addressGroups(address);
  if (form === 'full' || groups.length <= 3) return groups.join(' ');
  const last = groups[groups.length - 1];
  return form === 'inline' ? `${groups[0]} … ${last}` : `${groups[0]} ${groups[1]} … ${last}`;
}

// "Lingnan Hydrocolloids" -> "LH", "Pacífico Foods SpA" -> "PF"
export function initials(name: string): string {
  const words = name.split(/\s+/).filter((w) => /^\p{Lu}/u.test(w) && !/^(SpA|Ltd|Inc|SA|LLC|Co)\.?$/.test(w));
  return words
    .slice(0, 2)
    .map((w) => w[0])
    .join('');
}

// "765432103" -> "76.543.210-3": a Chilean RUT is stored without dots or dash
export function formatRut(rut: string): string {
  const clean = rut.replace(/[.\-\s]/g, '').toUpperCase();
  if (clean.length < 2) return rut;
  const body = clean.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${body}-${clean.slice(-1)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Unix seconds -> "Nov 20". Contract dates are UTC days, so the day never shifts with the phone.
export function formatDay(unixSeconds: number | bigint): string {
  const d = new Date(Number(unixSeconds) * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// Unix seconds -> "Oct 14, 09:12" in the phone's time zone: for a signature, which is a moment.
export function formatLocalDayTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Unix seconds -> "Oct 15" in the phone's time zone: for things people did, like an upload.
export function formatLocalDay(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

// 4_900_000n (49,000.00) -> "49k": compact figure for limits and gauges
export function formatCompact(minor: bigint, decimals = 2): string {
  const whole = Number(minor / 10n ** BigInt(decimals));
  if (whole >= 1_000_000) return `${+(whole / 1_000_000).toFixed(1)}M`;
  if (whole >= 1_000) return `${+(whole / 1_000).toFixed(1)}k`;
  return String(whole);
}
