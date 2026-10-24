// Pure bookkeeping for bullet impacts: a fixed-size decal ring that recycles
// the oldest bullet hole, the age-based decal fade, and a ray/ground test
// (the ground isn't a shootable mesh, so shots at the floor would otherwise
// "land" far underground). No THREE/DOM.

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

/** Height of the raised city blocks (world/colliders.ts groundY returns 0 or this). */
const BLOCK_TOP = 0.25;

/**
 * Distance along `dir` (unit) from `origin` to the ground, or null when the
 * ray doesn't reach it within `maxDist`. The ground is two planes: roads at
 * y=0 and raised blocks at y=0.25, chosen per point with `groundY(x, z)`.
 */
export function rayGroundHit(origin: V3, dir: V3, maxDist: number, groundY: (x: number, z: number) => number): number | null {
  if (dir.y >= -1e-6) return null;
  const tBlock = (BLOCK_TOP - origin.y) / dir.y;
  if (tBlock > 0 && tBlock <= maxDist && groundY(origin.x + dir.x * tBlock, origin.z + dir.z * tBlock) >= BLOCK_TOP) return tBlock;
  const tRoad = -origin.y / dir.y;
  if (tRoad > 0 && tRoad <= maxDist) return tRoad;
  return null;
}
