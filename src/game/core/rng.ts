// Seeded deterministic RNG (mulberry32-ish, ported verbatim from the legacy game)
// so every client builds an identical city from the same seed and call order.
// Math.random() stays reserved for local-only ambient randomness (traffic, peds).

export const WORLD_SEED = 1337;

export function createRng(seed: number = WORLD_SEED) {
  let s = seed;
  const rnd = (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rr = (a: number, b: number): number => a + (b - a) * rnd();
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
  return { rnd, rr, pick };
}

export type Rng = ReturnType<typeof createRng>;
