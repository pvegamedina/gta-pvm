// Clipping of polylines and polygons against the axis-aligned map bounds.

import type { MapBounds, Vec2 } from "../../src/game/map/types";

/** A projected point that remembers which OSM node it came from. */
export interface KeyedPoint {
  x: number;
  z: number;
  /** OSM node id as string, or a synthetic key for boundary intersections. */
  key: string;
}

const inside = (x: number, z: number, r: MapBounds) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;

/** Liang–Barsky: parametric [t0, t1] of segment AB inside the rectangle, or null. */
function clipSegment(ax: number, az: number, bx: number, bz: number, r: MapBounds): [number, number] | null {
  const dx = bx - ax;
  const dz = bz - az;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dz, dz];
  const q = [ax - r.minX, r.maxX - ax, az - r.minZ, r.maxZ - az];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return null;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return null;
        if (t < t1) t1 = t;
      }
    }
  }
  return [t0, t1];
}

/**
 * Clips a polyline to the rectangle, returning the inside runs (≥ 2 points
 * each). Points created on the border get a key derived from the segment's
 * endpoint keys so they are stable and unique.
 */
export function clipPolyline(points: KeyedPoint[], r: MapBounds): KeyedPoint[][] {
  const runs: KeyedPoint[][] = [];
  let run: KeyedPoint[] = [];
  const flush = () => {
    if (run.length >= 2) runs.push(run);
    run = [];
  };
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const t = clipSegment(a.x, a.z, b.x, b.z, r);
    if (!t) {
      flush();
      continue;
    }
    const [t0, t1] = t;
    const at = (tt: number, tag: string): KeyedPoint =>
      tt === 0 ? a : tt === 1 ? b : { x: a.x + (b.x - a.x) * tt, z: a.z + (b.z - a.z) * tt, key: `${a.key}>${b.key}:${tag}` };
    const start = at(t0, "in");
    const end = at(t1, "out");
    if (run.length === 0 || run[run.length - 1] !== start) {
      flush();
      run.push(start);
    }
    if (end !== start) run.push(end);
    if (t1 < 1) flush();
  }
  flush();
  // A degenerate run touching only the border at one point is dropped above.
  return runs.filter((rn) => rn.some((p) => inside(p.x, p.z, r)));
}

/** Sutherland–Hodgman clip of a ring against the rectangle. */
export function clipPolygon(ring: Vec2[], r: MapBounds): Vec2[] {
  type Edge = { inside: (p: Vec2) => boolean; cut: (a: Vec2, b: Vec2) => Vec2 };
  const lerpX = (a: Vec2, b: Vec2, x: number): Vec2 => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])];
  const lerpZ = (a: Vec2, b: Vec2, z: number): Vec2 => [a[0] + ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]), z];
  const edges: Edge[] = [
    { inside: (p) => p[0] >= r.minX, cut: (a, b) => lerpX(a, b, r.minX) },
    { inside: (p) => p[0] <= r.maxX, cut: (a, b) => lerpX(a, b, r.maxX) },
    { inside: (p) => p[1] >= r.minZ, cut: (a, b) => lerpZ(a, b, r.minZ) },
    { inside: (p) => p[1] <= r.maxZ, cut: (a, b) => lerpZ(a, b, r.maxZ) },
  ];
  let out = ring;
  for (const e of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i - 1 + input.length) % input.length];
      const ci = e.inside(cur);
      const pi = e.inside(prev);
      if (ci) {
        if (!pi) out.push(e.cut(prev, cur));
        out.push(cur);
      } else if (pi) {
        out.push(e.cut(prev, cur));
      }
    }
    if (out.length === 0) break;
  }
  return out;
}
