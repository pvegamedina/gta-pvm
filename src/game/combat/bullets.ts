// Pure flight math for the visible bullet streaks (combat/effects.ts). Purely
// cosmetic: hits stay hitscan + server-authoritative; this only decides where
// the streak is drawn `elapsed` seconds after the shot and when it lands.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Seconds a bullet at `speed` (m/s) takes from `origin` to `end`. */
export function bulletFlightTime(origin: Vec3, end: Vec3, speed: number): number {
  const d = Math.hypot(end.x - origin.x, end.y - origin.y, end.z - origin.z);
  return d / speed;
}

export interface BulletStreak {
  /** Leading point of the streak. */
  head: Vec3;
  /** Trailing point (never behind the muzzle). */
  tail: Vec3;
  /** The bullet reached `end` (spawn the impact now). */
  arrived: boolean;
}

function setLerp(out: Vec3, a: Vec3, b: Vec3, t: number): void {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
}

/** Allocates a reusable streak result (pass it as `out` every frame to avoid garbage). */
export function createBulletStreak(): BulletStreak {
  return { head: { x: 0, y: 0, z: 0 }, tail: { x: 0, y: 0, z: 0 }, arrived: false };
}

/**
 * Streak segment for a bullet fired from `origin` towards `end` at `speed`,
 * `elapsed` seconds after the shot: the head travels along the line and stops
 * at `end`; the tail trails `length` metres behind, clamped to the origin.
 * Writes into (and returns) `out`.
 */
export function bulletStreak(origin: Vec3, end: Vec3, speed: number, elapsed: number, length: number, out = createBulletStreak()): BulletStreak {
  const d = Math.hypot(end.x - origin.x, end.y - origin.y, end.z - origin.z);
  if (d < 1e-6) {
    setLerp(out.head, end, end, 0);
    setLerp(out.tail, end, end, 0);
    out.arrived = true;
    return out;
  }
  const travelled = Math.max(0, speed * elapsed);
  out.arrived = travelled >= d;
  setLerp(out.head, origin, end, out.arrived ? 1 : travelled / d);
  setLerp(out.tail, origin, end, Math.max(0, (Math.min(travelled, d) - length) / d));
  return out;
}
