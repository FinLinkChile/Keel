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

// Full form only where the payee is decided; elsewhere the short form next to a name.
export function formatAddress(address: string, full = false): string {
  const groups = addressGroups(address);
  if (full || groups.length <= 3) return groups.join(' ');
  return `${groups[0]} ${groups[1]} … ${groups[groups.length - 1]}`;
}

// "Lingnan Hydrocolloids" -> "LH", "Pacífico Foods SpA" -> "PF"
export function initials(name: string): string {
  const words = name.split(/\s+/).filter((w) => /^\p{Lu}/u.test(w) && !/^(SpA|Ltd|Inc|SA|LLC|Co)\.?$/.test(w));
  return words
    .slice(0, 2)
    .map((w) => w[0])
    .join('');
}
