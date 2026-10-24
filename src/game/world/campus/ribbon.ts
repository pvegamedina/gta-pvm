// Pure polyline helpers and draped strip geometry for roads, sidewalks,
// kerbs, lane markings and junction fills. No THREE dependency (arrays only)
// so the geometry is unit-testable; world/campus/roads.ts turns the arrays
// into merged BufferGeometries.
//
// Conventions: points are [x, z] with x east and z south. For a travel
// direction (fx, fz) the RIGHT-hand side is (-fz, fx); positive lateral
// offsets are to the right.

import type { Vec2 } from "../../map/types";

export interface RibbonArrays {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

export function emptyArrays(): RibbonArrays {
  return { positions: [], normals: [], uvs: [], indices: [] };
}

/** Appends `src` to `dst` (re-basing the indices). */
export function appendArrays(dst: RibbonArrays, src: RibbonArrays): void {
  const base = dst.positions.length / 3;
  for (const v of src.positions) dst.positions.push(v);
  for (const v of src.normals) dst.normals.push(v);
  for (const v of src.uvs) dst.uvs.push(v);
  for (const i of src.indices) dst.indices.push(i + base);
}

/** Inserts evenly spaced points so no segment is longer than `maxSegment` (originals kept). */
export function resamplePolyline(points: readonly Vec2[], maxSegment: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i === 0) {
      out.push([p[0], p[1]]);
      continue;
    }
    const q = points[i - 1];
    const len = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (len < 1e-6) continue;
    const n = Math.max(1, Math.ceil(len / maxSegment - 1e-9));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push(k === n ? [p[0], p[1]] : [q[0] + (p[0] - q[0]) * t, q[1] + (p[1] - q[1]) * t]);
    }
  }
  return out;
}

/** Cumulative arc length at every vertex. */
export function cumulativeLengths(points: readonly Vec2[]): number[] {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  return cum;
}

/** Longest mitre, as a multiple of the offset, before the join is clamped. */
const MITRE_LIMIT = 2.5;

/**
 * Per-vertex mitred right-hand normals scaled for a unit offset: offsetting
 * by `d` puts the vertex at p + n * d, with legs staying parallel.
 */
export function mitreNormals(points: readonly Vec2[]): Vec2[] {
  const n = points.length;
  const dirs: Vec2[] = [];
  for (let i = 0; i + 1 < n; i++) {
    const dx = points[i + 1][0] - points[i][0];
    const dz = points[i + 1][1] - points[i][1];
    const l = Math.hypot(dx, dz) || 1;
    dirs.push([dx / l, dz / l]);
  }
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = dirs[Math.max(0, i - 1)] ?? [1, 0];
    const b = dirs[Math.min(dirs.length - 1, i)] ?? a;
    // Right-hand normals of the incoming and outgoing legs.
    const na: Vec2 = [-a[1], a[0]];
    const nb: Vec2 = [-b[1], b[0]];
    let mx = na[0] + nb[0];
    let mz = na[1] + nb[1];
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) {
      // 180 degree reversal: fall back to the outgoing normal.
      out.push([nb[0], nb[1]]);
      continue;
    }
    mx /= ml;
    mz /= ml;
    const cos = mx * nb[0] + mz * nb[1];
    const scale = Math.min(MITRE_LIMIT, 1 / Math.max(cos, 1e-6));
    out.push([mx * scale, mz * scale]);
  }
  return out;
}

/** The polyline shifted `d` metres to the right (negative = left) with mitred joins. */
export function offsetPolyline(points: readonly Vec2[], d: number): Vec2[] {
  if (d === 0) return points.map((p) => [p[0], p[1]] as Vec2);
  const ns = mitreNormals(points);
  return points.map((p, i) => [p[0] + ns[i][0] * d, p[1] + ns[i][1] * d] as Vec2);
}

/** Point at arc length `s` (clamped). */
export function pointAt(points: readonly Vec2[], cum: readonly number[], s: number): Vec2 {
  if (s <= 0) return [points[0][0], points[0][1]];
  const total = cum[cum.length - 1];
  if (s >= total) return [points[points.length - 1][0], points[points.length - 1][1]];
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const t = (s - cum[i - 1]) / seg;
  return [points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t];
}

/**
 * Removes `start` metres from the beginning and `end` metres from the end.
 * When the trims overlap, a short 2-point stub around the overlap point is
 * returned instead.
 */
export function trimPolyline(points: readonly Vec2[], start: number, end: number): Vec2[] {
  const cum = cumulativeLengths(points);
  const total = cum[cum.length - 1];
  let s0 = Math.max(0, start);
  let s1 = total - Math.max(0, end);
  if (s1 - s0 < 0.2) {
    const mid = Math.min(total, Math.max(0, (s0 + s1) / 2));
    s0 = Math.max(0, mid - 0.1);
    s1 = Math.min(total, mid + 0.1);
    return [pointAt(points, cum, s0), pointAt(points, cum, s1)];
  }
  const out: Vec2[] = [pointAt(points, cum, s0)];
  for (let i = 1; i < points.length - 1; i++) if (cum[i] > s0 + 1e-6 && cum[i] < s1 - 1e-6) out.push([points[i][0], points[i][1]]);
  out.push(pointAt(points, cum, s1));
  return out;
}

/** Height callback for draped strips: `s` is the distance along the polyline. */
export type StripHeight = (x: number, z: number, s: number) => number;

export interface RibbonOptions {
  /** Lateral offset of the left edge (negative = left of the centreline). */
  left: number;
  /** Lateral offset of the right edge. */
  right: number;
  /** Lateral subdivisions (columns - 1); more for wide roads so they follow cross slopes. */
  across?: number;
  /** Longest segment along the strip (finer draping on bumpy ground). */
  maxSegment?: number;
  height: StripHeight;
  /** Added to every vertex height (z-fight margin). */
  lift: number;
  /** Metres per texture repeat along the strip (v). */
  vScale?: number;
  /** u at the left / right edge. */
  u0?: number;
  u1?: number;
}

/** A draped strip following the polyline between two lateral offsets, facing up. */
export function buildRibbon(points: readonly Vec2[], o: RibbonOptions): RibbonArrays {
  const out = emptyArrays();
  const pts = resamplePolyline(points, o.maxSegment ?? 4);
  if (pts.length < 2) return out;
  const ns = mitreNormals(pts);
  const cum = cumulativeLengths(pts);
  const cols = Math.max(1, o.across ?? 1) + 1;
  const vScale = o.vScale ?? 1;
  const u0 = o.u0 ?? 0;
  const u1 = o.u1 ?? 1;
  for (let i = 0; i < pts.length; i++) {
    for (let c = 0; c < cols; c++) {
      const f = c / (cols - 1);
      const off = o.left + (o.right - o.left) * f;
      const x = pts[i][0] + ns[i][0] * off;
      const z = pts[i][1] + ns[i][1] * off;
      out.positions.push(x, o.height(x, z, cum[i]) + o.lift, z);
      out.normals.push(0, 1, 0);
      out.uvs.push(u0 + (u1 - u0) * f, cum[i] / vScale);
    }
  }
  for (let i = 0; i + 1 < pts.length; i++) {
    for (let c = 0; c + 1 < cols; c++) {
      const a = i * cols + c;
      const b = a + 1; // to the right
      const cc = a + cols; // next row
      const d = cc + 1;
      out.indices.push(a, b, cc, b, d, cc);
    }
  }
  return out;
}

export interface WallStripOptions {
  /** Lateral offset of the wall line. */
  offset: number;
  height: StripHeight;
  /** Bottom / top lift above the height function. */
  y0: number;
  y1: number;
  maxSegment?: number;
  /** +1 = faces right (away from the centreline for positive offsets), -1 = faces left. */
  facing: 1 | -1;
  vScale?: number;
}

/** A vertical strip (kerb face, parapet, deck side) along the offset line. */
export function buildWallStrip(points: readonly Vec2[], o: WallStripOptions): RibbonArrays {
  const out = emptyArrays();
  const pts = resamplePolyline(points, o.maxSegment ?? 4);
  if (pts.length < 2) return out;
  const ns = mitreNormals(pts);
  const cum = cumulativeLengths(pts);
  const vScale = o.vScale ?? 1;
  for (let i = 0; i < pts.length; i++) {
    const x = pts[i][0] + ns[i][0] * o.offset;
    const z = pts[i][1] + ns[i][1] * o.offset;
    const h = o.height(x, z, cum[i]);
    const nl = Math.hypot(ns[i][0], ns[i][1]) || 1;
    const nx = (ns[i][0] / nl) * o.facing;
    const nz = (ns[i][1] / nl) * o.facing;
    out.positions.push(x, h + o.y0, z, x, h + o.y1, z);
    out.normals.push(nx, 0, nz, nx, 0, nz);
    out.uvs.push(cum[i] / vScale, 0, cum[i] / vScale, 1);
  }
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = i * 2; // bottom
    const b = a + 1; // top
    const c = a + 2; // next bottom
    const d = a + 3; // next top
    // Facing right: (a, c, d) is counter-clockwise seen from the right-hand side.
    if (o.facing === 1) out.indices.push(a, c, d, a, d, b);
    else out.indices.push(a, d, c, a, b, d);
  }
  return out;
}

/** Upward-facing draped disc (junction fill / round cap) as a triangle fan. */
export function buildDisc(cx: number, cz: number, r: number, segments: number, height: (x: number, z: number) => number, lift: number): RibbonArrays {
  const out = emptyArrays();
  out.positions.push(cx, height(cx, cz) + lift, cz);
  out.normals.push(0, 1, 0);
  out.uvs.push(0.5, 0.5);
  for (let k = 0; k < segments; k++) {
    const a = (k / segments) * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    out.positions.push(x, height(x, z) + lift, z);
    out.normals.push(0, 1, 0);
    out.uvs.push(0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5);
  }
  for (let k = 0; k < segments; k++) {
    const a = 1 + k;
    const b = 1 + ((k + 1) % segments);
    // Angle grows from +x towards +z (south): (centre, b, a) is CCW from above.
    out.indices.push(0, b, a);
  }
  return out;
}
