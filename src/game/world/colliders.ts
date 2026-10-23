// Static collision grid: box/circle colliders bucketed into a coarse spatial hash.
// Ported from the legacy game's `grid`/`eachStatic`/`circleVsCollider`.

import { G, P, HALF, WORLD, rc } from "../core/constants";

export interface BoxCollider {
  t: 0;
  x: number;
  z: number;
  hx: number;
  hz: number;
  h: number;
}
export interface CircleCollider {
  t: 1;
  x: number;
  z: number;
  r: number;
  h: number;
}
export type Collider = BoxCollider | CircleCollider;

export interface HitInfo {
  nx: number;
  nz: number;
  pen: number;
}

const CELL = 16;

export class CollisionGrid {
  private grid = new Map<number, Collider[]>();

  private gk(cx: number, cz: number): number {
    return (cx + 256) * 512 + (cz + 256);
  }

  add(c: Collider): void {
    const x0 = c.t === 0 ? c.x - c.hx : c.x - c.r;
    const x1 = c.t === 0 ? c.x + c.hx : c.x + c.r;
    const z0 = c.t === 0 ? c.z - c.hz : c.z - c.r;
    const z1 = c.t === 0 ? c.z + c.hz : c.z + c.r;
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

  addBox(x: number, z: number, hx: number, hz: number, h: number): void {
    this.add({ t: 0, x, z, hx, hz, h });
  }

  addCirc(x: number, z: number, r: number): void {
    this.add({ t: 1, x, z, r, h: 99 });
  }

  each(x: number, z: number, r: number, fn: (c: Collider) => void): void {
    const cx0 = Math.floor((x - r) / CELL);
    const cx1 = Math.floor((x + r) / CELL);
    const cz0 = Math.floor((z - r) / CELL);
    const cz1 = Math.floor((z + r) / CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const a = this.grid.get(this.gk(cx, cz));
        if (a) for (let i = 0; i < a.length; i++) fn(a[i]);
      }
    }
  }
}

export function circleVsCollider(c: Collider, x: number, z: number, r: number, out: HitInfo): boolean {
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

export function groundY(x: number, z: number): number {
  if (Math.abs(x) > WORLD || Math.abs(z) > WORLD) return 0;
  const ix = Math.round((x - rc(0)) / P);
  const iz = Math.round((z - rc(0)) / P);
  const onX = ix >= 0 && ix <= G && Math.abs(x - rc(ix)) < HALF;
  const onZ = iz >= 0 && iz <= G && Math.abs(z - rc(iz)) < HALF;
  return onX || onZ ? 0 : 0.25;
}
