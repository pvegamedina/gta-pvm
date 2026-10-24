// Pure building extrusion from a map footprint (CCW from above): textured
// walls (u tiles per facade bay, v per storey so a window texture repeats
// once per floor), a flat roof (ear-clipping triangulation via three's
// ShapeUtils — plain math, no WebGL) and a parapet. Arrays only; the THREE
// meshes are assembled in world/campus/buildings.ts.

import { ShapeUtils, Vector2 } from "three";
import type { Ring, Vec2 } from "../../map/types";
import { emptyArrays, type RibbonArrays } from "./ribbon";

export interface WallOptions {
  /** Metres per horizontal texture repeat (one window bay). */
  bayWidth: number;
  /** Metres per vertical texture repeat (one storey). */
  floorHeight: number;
  /** Height at which v = 0 (the ground floor level). */
  vBase: number;
}

/** Outward-facing, flat-shaded wall quads from y0 to y1 along every footprint edge. */
export function extrudeWalls(ring: Ring, y0: number, y1: number, o: WallOptions): RibbonArrays {
  const out = emptyArrays();
  let perim = 0;
  const v0 = (y0 - o.vBase) / o.floorHeight;
  const v1 = (y1 - o.vBase) / o.floorHeight;
  for (let e = 0, n = ring.length; e < n; e++) {
    const [ax, az] = ring[e];
    const [bx, bz] = ring[(e + 1) % n];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    // Outward = right-hand side of the edge for a CCW-from-above ring.
    const nx = -(bz - az) / len;
    const nz = (bx - ax) / len;
    const base = out.positions.length / 3;
    out.positions.push(ax, y0, az, bx, y0, bz, ax, y1, az, bx, y1, bz);
    for (let k = 0; k < 4; k++) out.normals.push(nx, 0, nz);
    const u0 = perim / o.bayWidth;
    const u1 = (perim + len) / o.bayWidth;
    out.uvs.push(u0, v0, u1, v0, u0, v1, u1, v1);
    out.indices.push(base, base + 1, base + 3, base, base + 3, base + 2);
    perim += len;
  }
  return out;
}

/** Triangle vertex indices (into `ring`) covering the polygon, wound to face up. */
export function triangulateRing(ring: Ring): number[] {
  const contour = ring.map(([x, z]) => new Vector2(x, z));
  const tris = ShapeUtils.triangulateShape(contour, []);
  const out: number[] = [];
  for (const [a, b, c] of tris) {
    const ux = ring[b][0] - ring[a][0];
    const uz = ring[b][1] - ring[a][1];
    const vx = ring[c][0] - ring[a][0];
    const vz = ring[c][1] - ring[a][1];
    // y of (b - a) x (c - a) must be positive (facing up).
    if (uz * vx - ux * vz > 0) out.push(a, b, c);
    else out.push(a, c, b);
  }
  return out;
}

/** Flat roof at height y (uv in 4 m world tiles). */
export function buildRoof(ring: Ring, y: number, tile = 4): RibbonArrays {
  const out = emptyArrays();
  for (const [x, z] of ring) {
    out.positions.push(x, y, z);
    out.normals.push(0, 1, 0);
    out.uvs.push(x / tile, z / tile);
  }
  out.indices.push(...triangulateRing(ring));
  return out;
}

/** Longest mitre (multiple of the inset) before a sharp corner is clamped. */
const INSET_MITRE_LIMIT = 3;

/** The ring moved `d` metres inwards (mitred, for a CCW-from-above ring). */
export function insetRing(ring: Ring, d: number): Ring {
  const n = ring.length;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p = ring[(i + n - 1) % n];
    const c = ring[i];
    const q = ring[(i + 1) % n];
    const ax = c[0] - p[0];
    const az = c[1] - p[1];
    const bx = q[0] - c[0];
    const bz = q[1] - c[1];
    const la = Math.hypot(ax, az) || 1;
    const lb = Math.hypot(bx, bz) || 1;
    // Left-hand (inward) normals of both edges.
    const nax = az / la;
    const naz = -ax / la;
    const nbx = bz / lb;
    const nbz = -bx / lb;
    let mx = nax + nbx;
    let mz = naz + nbz;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) {
      out.push([c[0] + nbx * d, c[1] + nbz * d]);
      continue;
    }
    mx /= ml;
    mz /= ml;
    const scale = Math.min(INSET_MITRE_LIMIT, 1 / Math.max(mx * nbx + mz * nbz, 1e-6));
    out.push([c[0] + mx * scale * d, c[1] + mz * scale * d]);
  }
  return out;
}

/** Parapet wall around a flat roof: outer face, inner face (on the inset ring) and top cap. */
export function buildParapet(ring: Ring, roofY: number, height: number, thickness: number): RibbonArrays {
  const out = emptyArrays();
  const inner = insetRing(ring, thickness);
  const top = roofY + height;
  const n = ring.length;
  const quad = (pts: number[], nrm: [number, number, number]) => {
    const base = out.positions.length / 3;
    out.positions.push(...pts);
    for (let k = 0; k < 4; k++) out.normals.push(...nrm);
    out.uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
    out.indices.push(base, base + 1, base + 3, base, base + 3, base + 2);
  };
  for (let e = 0; e < n; e++) {
    const a = ring[e];
    const b = ring[(e + 1) % n];
    const ia = inner[e];
    const ib = inner[(e + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const nx = -(b[1] - a[1]) / len;
    const nz = (b[0] - a[0]) / len;
    // Outer face: same layout as extrudeWalls (start/end bottom, start/end top).
    quad([a[0], roofY, a[1], b[0], roofY, b[1], a[0], top, a[1], b[0], top, b[1]], [nx, 0, nz]);
    // Inner face, walked backwards so it faces the roof.
    quad([ib[0], roofY, ib[1], ia[0], roofY, ia[1], ib[0], top, ib[1], ia[0], top, ia[1]], [-nx, 0, -nz]);
    // Cap: inner edge (left) to outer edge (right) along the edge direction.
    const base = out.positions.length / 3;
    out.positions.push(ia[0], top, ia[1], a[0], top, a[1], ib[0], top, ib[1], b[0], top, b[1]);
    for (let k = 0; k < 4; k++) out.normals.push(0, 1, 0);
    out.uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
    out.indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  return out;
}
