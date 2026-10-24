// Pure 2D geometry on the map's x/z plane (no THREE dependency so it can run
// in the build script, the server and the browser alike).

import type { Ring, Vec2 } from "./types";

/**
 * Signed area in m². POSITIVE when the ring is counter-clockwise as seen from
 * above (+y looking down, north = -z at the top, east = +x on the right).
 *
 * Note this is the opposite sign of the textbook shoelace applied to (x, z),
 * because z points south (down the screen) in a top view.
 */
export function signedArea(ring: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x0, z0] = ring[i];
    const [x1, z1] = ring[(i + 1) % n];
    s += x1 * z0 - x0 * z1;
  }
  return s / 2;
}

/** Absolute polygon area in m². */
export function polygonArea(ring: readonly Vec2[]): number {
  return Math.abs(signedArea(ring));
}

/** Returns the ring oriented CCW from above (a reversed copy when needed). */
export function ensureCCW(ring: Ring): Ring {
  return signedArea(ring) < 0 ? [...ring].reverse() : ring;
}

/** Area centroid; falls back to the vertex average for degenerate rings. */
export function polygonCentroid(ring: readonly Vec2[]): Vec2 {
  let a = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x0, z0] = ring[i];
    const [x1, z1] = ring[(i + 1) % n];
    const cross = x0 * z1 - x1 * z0;
    a += cross;
    cx += (x0 + x1) * cross;
    cz += (z0 + z1) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0;
    let sz = 0;
    for (const [x, z] of ring) {
      sx += x;
      sz += z;
    }
    return [sx / ring.length, sz / ring.length];
  }
  return [cx / (3 * a), cz / (3 * a)];
}

/** Even-odd point-in-polygon test (orientation independent). */
export function pointInPolygon(x: number, z: number, ring: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export interface SegmentProjection {
  /** Closest point on the segment. */
  x: number;
  z: number;
  /** Parameter of the closest point along the segment, clamped to [0, 1]. */
  t: number;
  distance: number;
}

/** Closest point on segment AB to P. */
export function pointToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): SegmentProjection {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + dx * t;
  const z = az + dz * t;
  return { x, z, t, distance: Math.hypot(px - x, pz - z) };
}

/** Distance from P to the closest edge of a closed ring. */
export function distanceToRing(px: number, pz: number, ring: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % n];
    const d = pointToSegment(px, pz, ax, az, bx, bz).distance;
    if (d < best) best = d;
  }
  return best;
}

/** Total length of an open polyline. */
export function polylineLength(points: readonly Vec2[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return len;
}

/** Length of the sub-polyline between point indices i0 and i1 (either order). */
export function polylineRangeLength(points: readonly Vec2[], i0: number, i1: number): number {
  const a = Math.min(i0, i1);
  const b = Math.max(i0, i1);
  let len = 0;
  for (let i = a + 1; i <= b; i++) {
    len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return len;
}

/**
 * Removes duplicate vertices and vertices whose distance to the line through
 * their neighbours is below `tolerance` metres. Iterates until stable; never
 * returns fewer than 3 points for a non-degenerate input.
 */
export function simplifyRing(ring: readonly Vec2[], tolerance: number): Ring {
  let pts: Vec2[] = [];
  for (const p of ring) {
    const last = pts[pts.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p);
  }
  if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();

  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const next = pts[(i + 1) % pts.length];
      const p = pts[i];
      // Distance from p to the infinite line prev→next.
      const dx = next[0] - prev[0];
      const dz = next[1] - prev[1];
      const len = Math.hypot(dx, dz);
      const d = len > 0 ? Math.abs(dx * (prev[1] - p[1]) - dz * (prev[0] - p[0])) / len : 0;
      // Only drop p when it lies between its neighbours (not a spike).
      const along = len > 0 ? ((p[0] - prev[0]) * dx + (p[1] - prev[1]) * dz) / (len * len) : 0;
      if (d < tolerance && along > 0 && along < 1) {
        pts = pts.slice(0, i).concat(pts.slice(i + 1));
        changed = true;
        i--;
      }
    }
  }
  return pts;
}

/** Axis-aligned bounding box of a point list. */
export function bboxOf(points: readonly Vec2[]): { minX: number; minZ: number; maxX: number; maxZ: number } {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of points) {
    if (x < minX) minX = x;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (z > maxZ) maxZ = z;
  }
  return { minX, minZ, maxX, maxZ };
}
