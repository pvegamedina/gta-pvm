// Pure pitched-roof geometry for small houses: the footprint's minimum-area
// oriented bounding box gets a gable roof along its long axis (two slopes
// plus the two gable-end wall triangles) or, when it is nearly square, a
// hipped roof (four slopes, no gables). Eaves overhang the walls and keep
// the slope. Arrays only (RibbonArrays); buildings.ts merges them.

import type { BuildingCategory, Ring } from "../../map/types";
import { polygonArea } from "../../map/geometry";
import { emptyArrays, type RibbonArrays } from "./ribbon";
import { insetRing } from "./extrude";

export interface OrientedBox {
  cx: number;
  cz: number;
  /** Unit long axis (the short axis is (-uz, ux)). */
  ux: number;
  uz: number;
  halfL: number;
  halfW: number;
  area: number;
}

/** Minimum-area rectangle around the ring, trying every edge direction. */
export function orientedBox(ring: Ring): OrientedBox {
  let best: OrientedBox | null = null;
  for (let e = 0, n = ring.length; e < n; e++) {
    const [ax, az] = ring[e];
    const [bx, bz] = ring[(e + 1) % n];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [x, z] of ring) {
      const u = x * ux + z * uz;
      const v = -x * uz + z * ux;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (best && area >= best.area - 1e-9) continue;
    const cu = (minU + maxU) / 2;
    const cv = (minV + maxV) / 2;
    const cx = cu * ux - cv * uz;
    const cz = cu * uz + cv * ux;
    const hu = (maxU - minU) / 2;
    const hv = (maxV - minV) / 2;
    best = hu >= hv ? { cx, cz, ux, uz, halfL: hu, halfW: hv, area } : { cx, cz, ux: -uz, uz: ux, halfL: hv, halfW: hu, area };
  }
  return best ?? { cx: 0, cz: 0, ux: 1, uz: 0, halfL: 0, halfW: 0, area: 0 };
}

/** Largest footprint (m²) / tallest building that gets a pitched roof. */
const MAX_AREA = 450;
const MAX_HEIGHT = 12;
/** Footprint must fill this share of its oriented box. */
const MIN_FILL = 0.82;

export function wantsPitchedRoof(category: BuildingCategory, ring: Ring, height: number): boolean {
  if (category !== "house" && category !== "residential") return false;
  if (height > MAX_HEIGHT) return false;
  const area = polygonArea(ring);
  if (area > MAX_AREA) return false;
  return area / orientedBox(ring).area >= MIN_FILL;
}

export interface PitchedRoof {
  kind: "gable" | "hip";
  /** Roof slopes (tiles). */
  roof: RibbonArrays;
  /** Gable-end wall triangles (wall material). */
  gables: RibbonArrays;
  ridgeHeight: number;
}

export interface PitchedRoofOptions {
  /** Rise over run of the slopes. */
  pitch?: number;
  /** Eave overhang (m). */
  overhang?: number;
  /** Metres per texture repeat. */
  tile?: number;
}

type P3 = [number, number, number];

/** Adds a flat-shaded planar polygon (fan) facing the side its vertices wind counter-clockwise from. */
function face(out: RibbonArrays, pts: P3[], tile: number, uAxis: [number, number]): void {
  const [a, b, c] = pts;
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let nx = u[1] * v[2] - u[2] * v[1];
  let ny = u[2] * v[0] - u[0] * v[2];
  let nz = u[0] * v[1] - u[1] * v[0];
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l;
  ny /= l;
  nz /= l;
  // u along `uAxis` (the eaves), v along t = n x uAxis (in the face plane, up the slope).
  const ax = uAxis[0];
  const az = uAxis[1];
  const tx = ny * az;
  const ty = nz * ax - nx * az;
  const tz = -ny * ax;
  const base = out.positions.length / 3;
  for (const p of pts) {
    out.positions.push(p[0], p[1], p[2]);
    out.normals.push(nx, ny, nz);
    out.uvs.push((p[0] * ax + p[2] * az) / tile, (p[0] * tx + p[1] * ty + p[2] * tz) / tile);
  }
  for (let k = 1; k + 1 < pts.length; k++) out.indices.push(base, base + k, base + k + 1);
}

/** Pitched roof sitting on wall top `y`, or null when the footprint is not box-like. */
export function pitchedRoof(ring: Ring, y: number, o: PitchedRoofOptions = {}): PitchedRoof | null {
  const box = orientedBox(ring);
  if (box.area <= 0 || polygonArea(ring) / box.area < MIN_FILL) return null;
  const pitch = o.pitch ?? 0.55;
  const ov = o.overhang ?? 0.35;
  const tile = o.tile ?? 2;
  const { cx, cz, ux, uz, halfL, halfW } = box;
  // Short axis (vx, vz) such that (u, up, v) is right-handed: v = u x up.
  const vx = -uz;
  const vz = ux;
  const P = (u: number, v: number, h: number): P3 => [cx + ux * u + vx * v, h, cz + uz * u + vz * v];
  const h = halfW * pitch;
  const eave = y - ov * pitch;
  const L = halfL + ov;
  const W = halfW + ov;
  const roof = emptyArrays();
  const gables = emptyArrays();
  const axis: [number, number] = [ux, uz];
  const kind = halfL / Math.max(halfW, 1e-6) < 1.25 ? "hip" : "gable";
  if (kind === "gable") {
    // Two slopes, wound so their normals point up and out (+v / -v).
    face(roof, [P(-L, W, eave), P(L, W, eave), P(L, 0, y + h), P(-L, 0, y + h)].reverse(), tile, axis);
    face(roof, [P(-L, -W, eave), P(L, -W, eave), P(L, 0, y + h), P(-L, 0, y + h)], tile, axis);
    // Gable triangles in the end-wall planes, facing out along +u / -u.
    face(gables, [P(halfL, -halfW, y), P(halfL, 0, y + h), P(halfL, halfW, y)], tile, [vx, vz]);
    face(gables, [P(-halfL, halfW, y), P(-halfL, 0, y + h), P(-halfL, -halfW, y)], tile, [vx, vz]);
  } else {
    const r = Math.max(0, halfL - halfW);
    const top = y + h;
    // A square footprint has a single apex: the long slopes become triangles.
    const ridge = (k: 1 | -1) => (r > 1e-6 ? [P(r * k, 0, top), P(-r * k, 0, top)] : [P(0, 0, top)]);
    face(roof, [P(-L, W, eave), P(L, W, eave), ...ridge(1)].reverse(), tile, axis);
    face(roof, [P(-L, -W, eave), P(L, -W, eave), ...ridge(1)], tile, axis);
    face(roof, [P(L, -W, eave), P(L, W, eave), P(r, 0, top)], tile, [vx, vz]);
    face(roof, [P(-L, W, eave), P(-L, -W, eave), P(-r, 0, top)], tile, [vx, vz]);
  }
  // Make sure every slope faces up (winding fix-up for mirrored boxes).
  orientUp(roof);
  return { kind, roof, gables, ridgeHeight: h };
}

/** Flips any roof triangle whose geometric normal points down (and its stored normals). */
function orientUp(a: RibbonArrays): void {
  const p = a.positions;
  for (let f = 0; f < a.indices.length; f += 3) {
    const [i, j, k] = [a.indices[f], a.indices[f + 1], a.indices[f + 2]];
    const ux = p[j * 3] - p[i * 3];
    const uz = p[j * 3 + 2] - p[i * 3 + 2];
    const vx = p[k * 3] - p[i * 3];
    const vz = p[k * 3 + 2] - p[i * 3 + 2];
    const ny = uz * vx - ux * vz;
    if (ny < 0) {
      a.indices[f + 1] = k;
      a.indices[f + 2] = j;
      for (const q of [i, j, k]) {
        if (a.normals[q * 3 + 1] < 0) {
          a.normals[q * 3] *= -1;
          a.normals[q * 3 + 1] *= -1;
          a.normals[q * 3 + 2] *= -1;
        }
      }
    }
  }
}

/**
 * Column positions holding up an open canopy (`building=roof`): one at every
 * corner of the footprint moved `inset` metres inwards, plus evenly spaced
 * ones so no span exceeds `spacing`. Empty for slivers.
 */
export function canopyColumns(ring: Ring, spacing: number, inset: number): [number, number][] {
  const box = orientedBox(ring);
  if (box.halfW * 2 < inset * 2 + 0.5) return [];
  const inner = insetRing(ring, inset);
  const out: [number, number][] = [];
  for (let e = 0, n = inner.length; e < n; e++) {
    const a = inner[e];
    const b = inner[(e + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    out.push([a[0], a[1]]);
    const spans = Math.ceil(len / spacing - 1e-9);
    for (let k = 1; k < spans; k++) out.push([a[0] + ((b[0] - a[0]) * k) / spans, a[1] + ((b[1] - a[1]) * k) / spans]);
  }
  return out;
}
