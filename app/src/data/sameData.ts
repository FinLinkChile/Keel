// Whether two loaded values hold the same data. useData reads again now and then; when the answer is
// the same as before, the screen keeps the object it has, so nothing is drawn again and the effects
// that watch that object do not run again.
//
// Plain data is compared by content (bigints, arrays, Maps, Sets, Dates and objects). Anything else,
// such as a function, counts as the same only if it is the same one: when in doubt the screen reads
// the new value, which is always safe.
export function sameData(a: unknown, b: unknown, depth = 0): boolean {
  if (Object.is(a, b)) return true;
  if (depth > 12 || typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameData(x, b[i], depth + 1));
  }
  if (a instanceof Map || b instanceof Map) {
    return (
      a instanceof Map &&
      b instanceof Map &&
      a.size === b.size &&
      [...a].every(([k, v]) => b.has(k) && sameData(v, b.get(k), depth + 1))
    );
  }
  if (a instanceof Set || b instanceof Set) {
    return a instanceof Set && b instanceof Set && a.size === b.size && [...a].every((x) => b.has(x));
  }
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return (
    ka.length === kb.length &&
    ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameData((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], depth + 1))
  );
}
