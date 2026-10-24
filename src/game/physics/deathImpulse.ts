// Pure helpers deciding how a body is thrown when it dies: the impulse of the
// killing shot, the launch velocity of a vehicle ram, which body part a hit
// lands on, and which recent network shot most likely killed a victim.
// Visual only — these never feed back into gameplay/damage.

import type { WeaponId } from "@shared/protocol";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Killing-shot impulse per weapon (N·s on a ~75 kg ragdoll). Game-exaggerated
 * on purpose: real bullets barely push a body, but a visible shove reads well. */
export const SHOT_IMPULSE: Record<WeaponId, number> = { fists: 28, pistol: 34, m4: 30 };
/** Upward share of the shot impulse (keeps limbs folding rather than sliding). */
const SHOT_LIFT = 0.18;
/** Fraction of the car's velocity a rammed body takes, plus a fixed upward kick (m/s). */
const RAM_TRANSFER = 0.85;
const RAM_LIFT = 1.2;

/** Impulse for a killing shot travelling along `dir` (any length). */
export function shotImpulse(dir: Vec3, weapon: WeaponId): Vec3 {
  const len = Math.hypot(dir.x, dir.y, dir.z);
  if (len < 1e-6) return { x: 0, y: 0, z: 0 };
  const s = SHOT_IMPULSE[weapon] / len;
  return { x: dir.x * s, y: dir.y * s + SHOT_IMPULSE[weapon] * SHOT_LIFT, z: dir.z * s };
}

/** Initial velocity of a body hit by a car moving at `carVel` (m/s). */
export function ramVelocity(carVel: Vec3): Vec3 {
  const speed = Math.hypot(carVel.x, carVel.z);
  return { x: carVel.x * RAM_TRANSFER, y: RAM_LIFT + speed * 0.08, z: carVel.z * RAM_TRANSFER };
}

/** Index of the point closest to `p` (−1 for an empty list). */
export function nearestIndex(points: readonly Vec3[], p: Vec3): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < points.length; i++) {
    const q = points[i];
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2 + (q.z - p.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export interface RecordedShot {
  origin: Vec3;
  end: Vec3;
  /** Game clock (s) when the shot arrived. */
  time: number;
}

/**
 * Most recent shot (no older than `maxAge` s) whose impact landed within
 * `maxDist` metres (horizontally) of the victim's feet — the network "killed"
 * message carries no direction, so the ragdoll impulse comes from this.
 */
export function findKillingShot<T extends RecordedShot>(shots: readonly T[], victim: Vec3, now: number, maxAge: number, maxDist: number): T | null {
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    if (now - s.time > maxAge) continue;
    if (Math.hypot(s.end.x - victim.x, s.end.z - victim.z) <= maxDist) return s;
  }
  return null;
}
