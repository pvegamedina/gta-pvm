// Pure bookkeeping for bullet impacts: a fixed-size decal ring that recycles
// the oldest bullet hole, the age-based decal fade, and a ray/terrain test
// (the terrain is not a shootable mesh, so shots at the floor or into a hill
// would otherwise "land" far underground). No THREE/DOM.

export class DecalRing {
  private born: number[] = [];
  private next = 0;

  constructor(readonly capacity: number) {}

  get count(): number {
    return this.born.length;
  }

  /** Reserves a slot for a decal created at time `now`; the oldest is recycled when full. */
  push(now: number): number {
    if (this.born.length < this.capacity) {
      this.born.push(now);
      return this.born.length - 1;
    }
    const slot = this.next;
    this.born[slot] = now;
    this.next = (this.next + 1) % this.capacity;
    return slot;
  }

  bornAt(slot: number): number {
    return this.born[slot] ?? -Infinity;
  }

  clear(): void {
    this.born = [];
    this.next = 0;
  }
}

/** Decal visibility: 1 until `life - fade` seconds, then linearly to 0 at `life`. */
export function decalFade(age: number, life: number, fade: number): number {
  if (age >= life) return 0;
  return Math.min(1, (life - age) / fade);
}

interface V3 {
  x: number;
  y: number;
  z: number;
}

/** March step (m) of the terrain ray test: well under a 4 m terrain cell. */
const RAY_STEP = 1;

/**
 * Distance along `dir` (unit) from `origin` to the terrain `height(x, z)`, or
 * null when the ray stays above it within `maxDist`. Marches in RAY_STEP
 * increments (so hills between the shooter and the target stop the round)
 * and refines the crossing by bisection. Returns 0 when the origin already
 * is underground.
 */
export function rayTerrainHit(origin: V3, dir: V3, maxDist: number, height: (x: number, z: number) => number): number | null {
  const above = (t: number) => origin.y + dir.y * t - height(origin.x + dir.x * t, origin.z + dir.z * t);
  if (above(0) <= 0) return 0;
  let prevT = 0;
  for (let t = RAY_STEP; ; t += RAY_STEP) {
    const tt = Math.min(t, maxDist);
    if (above(tt) <= 0) {
      let lo = prevT;
      let hi = tt;
      for (let k = 0; k < 18; k++) {
        const mid = (lo + hi) / 2;
        if (above(mid) > 0) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    }
    if (tt >= maxDist) return null;
    prevT = tt;
  }
}
