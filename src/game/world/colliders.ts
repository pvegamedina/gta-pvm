// Static collision grid: box / circle / polygon colliders bucketed into a
// coarse spatial hash. Boxes and circles come from the legacy game (street
// furniture, tree trunks, signal poles); polygons are the campus building
// footprints (arbitrary, possibly concave rings).
//
// Heights are ABSOLUTE world heights now that the ground is a terrain: every
// collider spans y0 (base) .. h (top). The camera uses them to know whether
// a point is inside a wall; the 2D circle tests ignore them.

import { pointInPolygon } from "../map/geometry";
import type { Vec2 } from "../map/types";

export interface BoxCollider {
  t: 0;
  x: number;
  z: number;
  hx: number;
  hz: number;
  y0: number;
  h: number;
}
export interface CircleCollider {
  t: 1;
  x: number;
  z: number;
  r: number;
  y0: number;
  h: number;
}
export interface PolygonCollider {
  t: 2;
  /** Closed ring without the repeated point (any orientation). */
  ring: readonly Vec2[];
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  y0: number;
  h: number;
}
export type Collider = BoxCollider | CircleCollider | PolygonCollider;

export interface HitInfo {
  nx: number;
  nz: number;
  pen: number;
}

/** Builds a polygon collider (bbox precomputed) spanning y0..top. */
export function makePolygonCollider(ring: readonly Vec2[], y0: number, top: number): PolygonCollider {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { t: 2, ring, minX, minZ, maxX, maxZ, y0, h: top };
}

function extent(c: Collider): [number, number, number, number] {
  if (c.t === 0) return [c.x - c.hx, c.z - c.hz, c.x + c.hx, c.z + c.hz];
  if (c.t === 1) return [c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r];
  return [c.minX, c.minZ, c.maxX, c.maxZ];
}

const CELL = 16;
/** Cell coordinates are offset by this so keys stay positive for the whole map. */
const KEY_OFFSET = 4096;

export class CollisionGrid {
  private grid = new Map<number, Collider[]>();
  /** Every collider once (the grid buckets duplicate colliders spanning cells). */
  private list: Collider[] = [];
  /** Per-collider stamp of the last query that visited it (dedupes multi-cell colliders). */
  private stamps = new WeakMap<Collider, number>();
  private query = 0;

  private gk(cx: number, cz: number): number {
    return (cx + KEY_OFFSET) * 8192 + (cz + KEY_OFFSET);
  }

  add(c: Collider): void {
    this.list.push(c);
    const [x0, z0, x1, z1] = extent(c);
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
      for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
        const k = this.gk(cx, cz);
        let a = this.grid.get(k);
        if (!a) {
          a = [];
          this.grid.set(k, a);
        }
        a.push(c);
      }
    }
  }

  /** Axis-aligned box; `y0` is its base height, `h` its height above that base. */
  addBox(x: number, z: number, hx: number, hz: number, h: number, y0 = 0): void {
    this.add({ t: 0, x, z, hx, hz, y0, h: y0 + h });
  }

  /** Vertical cylinder (trunks, poles); tall by default so the camera never clips through. */
  addCirc(x: number, z: number, r: number, y0 = 0, height = 99): void {
    this.add({ t: 1, x, z, r, y0, h: y0 + height });
  }

  addPolygon(ring: readonly Vec2[], y0: number, top: number): PolygonCollider {
    const c = makePolygonCollider(ring, y0, top);
    this.add(c);
    return c;
  }

  /** All colliders, each once (used to mirror the static world into the ragdoll physics). */
  all(): readonly Collider[] {
    return this.list;
  }

  /** Calls `fn` once for every collider whose cells overlap the square (x ± r, z ± r). */
  each(x: number, z: number, r: number, fn: (c: Collider) => void): void {
    const q = ++this.query;
    const cx0 = Math.floor((x - r) / CELL);
    const cx1 = Math.floor((x + r) / CELL);
    const cz0 = Math.floor((z - r) / CELL);
    const cz1 = Math.floor((z + r) / CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const a = this.grid.get(this.gk(cx, cz));
        if (!a) continue;
        for (let i = 0; i < a.length; i++) {
          const c = a[i];
          if (this.stamps.get(c) === q) continue;
          this.stamps.set(c, q);
          fn(c);
        }
      }
    }
  }
}

/** Closest point on the ring's edges to (x, z): writes it into `out` and returns the distance. */
export function nearestOnRing(ring: readonly Vec2[], x: number, z: number, out: { x: number; z: number }): number {
  let best = Infinity;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % n];
    const ex = bx - ax;
    const ez = bz - az;
    const l2 = ex * ex + ez * ez;
    let t = l2 > 0 ? ((x - ax) * ex + (z - az) * ez) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + ex * t;
    const pz = az + ez * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) {
      best = d;
      out.x = px;
      out.z = pz;
    }
  }
  return best;
}

const _near = { x: 0, z: 0 };

function circleVsPolygon(c: PolygonCollider, x: number, z: number, r: number, out: HitInfo): boolean {
  if (x < c.minX - r || x > c.maxX + r || z < c.minZ - r || z > c.maxZ + r) return false;
  const inside = pointInPolygon(x, z, c.ring);
  const d = nearestOnRing(c.ring, x, z, _near);
  if (!inside && d >= r) return false;
  if (d < 1e-6) {
    // Exactly on an edge: push along the edge's outward normal guess (away from the centre of the bbox).
    const cx = (c.minX + c.maxX) / 2;
    const cz = (c.minZ + c.maxZ) / 2;
    const l = Math.hypot(x - cx, z - cz) || 1;
    out.nx = (x - cx) / l;
    out.nz = (z - cz) / l;
    out.pen = r;
    return true;
  }
  if (inside) {
    // Out through the nearest edge.
    out.nx = (_near.x - x) / d;
    out.nz = (_near.z - z) / d;
    out.pen = d + r;
  } else {
    out.nx = (x - _near.x) / d;
    out.nz = (z - _near.z) / d;
    out.pen = r - d;
  }
  return true;
}

export function circleVsCollider(c: Collider, x: number, z: number, r: number, out: HitInfo): boolean {
  if (c.t === 2) return circleVsPolygon(c, x, z, r, out);
  if (c.t === 1) {
    const dx = x - c.x;
    const dz = z - c.z;
    const rs = r + c.r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= rs * rs) return false;
    const d = Math.sqrt(d2);
    if (d < 1e-4) {
      out.nx = 1;
      out.nz = 0;
      out.pen = rs;
      return true;
    }
    out.nx = dx / d;
    out.nz = dz / d;
    out.pen = rs - d;
    return true;
  }
  const px = Math.min(Math.max(x, c.x - c.hx), c.x + c.hx);
  const pz = Math.min(Math.max(z, c.z - c.hz), c.z + c.hz);
  const dx = x - px;
  const dz = z - pz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2);
    out.nx = dx / d;
    out.nz = dz / d;
    out.pen = r - d;
    return true;
  }
  const l = x - (c.x - c.hx);
  const rt = c.x + c.hx - x;
  const t = z - (c.z - c.hz);
  const b = c.z + c.hz - z;
  const m = Math.min(l, rt, t, b);
  if (m === l) {
    out.nx = -1;
    out.nz = 0;
    out.pen = l + r;
  } else if (m === rt) {
    out.nx = 1;
    out.nz = 0;
    out.pen = rt + r;
  } else if (m === t) {
    out.nx = 0;
    out.nz = -1;
    out.pen = t + r;
  } else {
    out.nx = 0;
    out.nz = 1;
    out.pen = b + r;
  }
  return true;
}

/** True when the point (x, y, z) is inside (or within `margin` of) a collider's solid volume. */
export function pointBlocked(c: Collider, x: number, y: number, z: number, margin: number): boolean {
  if (y > c.h || y < c.y0 - margin) return false;
  if (c.t === 0) return Math.abs(x - c.x) < c.hx + margin && Math.abs(z - c.z) < c.hz + margin;
  if (c.t === 1) return Math.hypot(x - c.x, z - c.z) < c.r + margin;
  if (x < c.minX - margin || x > c.maxX + margin || z < c.minZ - margin || z > c.maxZ + margin) return false;
  return pointInPolygon(x, z, c.ring) || nearestOnRing(c.ring, x, z, _near) < margin;
}
