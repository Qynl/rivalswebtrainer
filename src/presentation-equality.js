// Bounded structural sharing for small HUD records only. Large/deeper values are
// deliberately treated as changed, never recursively traversed or mutated.
export function presentationEqual(a, b, depth = 2) {
  if (Object.is(a, b)) return true;
  if (depth <= 0 || !a || !b || typeof a !== "object" || typeof b !== "object")
    return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && a.length !== b.length) return false;
  if (
    !Array.isArray(a) &&
    (Object.getPrototypeOf(a) !== Object.prototype ||
      Object.getPrototypeOf(b) !== Object.prototype)
  )
    return false;
  const keys = Object.keys(a);
  if (keys.length > 32 || keys.length !== Object.keys(b).length) return false;
  return keys.every(
    (key) =>
      Object.hasOwn(b, key) && presentationEqual(a[key], b[key], depth - 1),
  );
}
