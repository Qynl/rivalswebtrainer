/** Identifiers that must be unique per seat, in a browser or in Node. */
export const uid = (): string => {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Crypto is missing only in ancient or exotic hosts; a seat token does not
  // need to be unguessable, only unique within this room.
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};
