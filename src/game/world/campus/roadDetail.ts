// Pure road-detail geometry rules (no THREE): where mapped crossings cut a
// road (for dropped kerbs), the dropped-kerb profile, curved kerbs closing
// the sidewalk corners at junctions, and the paint at signalled junction
// approaches (stop line, zebra, solid centre line, lane arrows).
// world/campus/roads.ts and markings.ts turn these into draped geometry.
//
// Conventions as in ribbon.ts: points are [x, z] (x east, z south); for a
// direction (fx, fz) the right-hand side is (-fz, fx); yaw = atan2(fx, fz).

import type { Vec2 } from "../../map/types";

/** Arc lengths along `a` where any segment of `b` crosses it (sorted). */
export function polylineCrossings(a: readonly Vec2[], b: readonly Vec2[]): number[] {
  const out: number[] = [];
  let s0 = 0;
  for (let i = 0; i + 1 < a.length; i++) {
    const [ax, az] = a[i];
    const [bx, bz] = a[i + 1];
    const ex = bx - ax;
    const ez = bz - az;
    const len = Math.hypot(ex, ez);
    for (let j = 0; j + 1 < b.length; j++) {
      const [cx, cz] = b[j];
      const [dx, dz] = b[j + 1];
      const fx = dx - cx;
      const fz = dz - cz;
      const den = ex * fz - ez * fx;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((cx - ax) * fz - (cz - az) * fx) / den;
      const u = ((cx - ax) * ez - (cz - az) * ex) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) out.push(s0 + t * len);
    }
    s0 += len;
  }
  return out.sort((x, y) => x - y);
}

export interface KerbDropSpan {
  /** Arc length of the crossing's centre along the road. */
  s: number;
  /** Half the crossing width (m). */
  half: number;
}

/** How much (m) the sidewalk/kerb is lowered at arc length `s`: full `depth` over the crossing, linear `ramp` either side. */
export function kerbDrop(s: number, drops: readonly KerbDropSpan[], depth: number, ramp: number): number {
  let best = 0;
  for (const d of drops) {
    const off = Math.abs(s - d.s) - d.half;
    const k = off <= 0 ? 1 : off >= ramp ? 0 : 1 - off / ramp;
    if (k > best) best = k;
  }
  return best * depth;
}

/** One road arm at a junction: its (trimmed) centreline end, the unit direction away from the junction and half its width. */
export interface Arm {
  end: Vec2;
  dir: Vec2;
  half: number;
}

export interface CornerCurve {
  /** From arm A's kerb end round the corner to arm B's kerb end. */
  points: Vec2[];
  /** +1 when the sidewalk lies to the right of the curve's direction, -1 when to the left. */
  outward: 1 | -1;
}

/** Smallest / largest angle (rad) between two arms that get a curved corner. */
const MIN_CORNER = (25 * Math.PI) / 180;
const MAX_CORNER = (165 * Math.PI) / 180;

/**
 * Curved kerb between two neighbouring arms of a junction centred at `node`:
 * a cubic Bézier from A's kerb (on the side facing B) to B's kerb (facing
 * A), tangent to both kerb lines, approximating a circular fillet. Null for
 * near-straight continuations, sharp gores (dual-carriageway medians) or
 * when the kerb lines do not meet in front of the arm ends.
 */
export function cornerCurve(node: Vec2, A: Arm, B: Arm, segments = 10): CornerCurve | null {
  const cos = A.dir[0] * B.dir[0] + A.dir[1] * B.dir[1];
  const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
  if (angle < MIN_CORNER || angle > MAX_CORNER) return null;
  const rA: Vec2 = [-A.dir[1], A.dir[0]];
  const rB: Vec2 = [-B.dir[1], B.dir[0]];
  const sA = Math.sign(rA[0] * B.dir[0] + rA[1] * B.dir[1]) || 1;
  const sB = Math.sign(rB[0] * A.dir[0] + rB[1] * A.dir[1]) || 1;
  const pa: Vec2 = [A.end[0] + rA[0] * sA * A.half, A.end[1] + rA[1] * sA * A.half];
  const pb: Vec2 = [B.end[0] + rB[0] * sB * B.half, B.end[1] + rB[1] * sB * B.half];
  // Kerb lines heading into the junction: pa - dA * t, pb - dB * u; their meeting point is the sharp corner.
  const den = -A.dir[0] * B.dir[1] + A.dir[1] * B.dir[0];
  if (Math.abs(den) < 1e-9) return null;
  const qx = pb[0] - pa[0];
  const qz = pb[1] - pa[1];
  // Solve pa - dA t = pb - dB u  ->  -dA t + dB u = q.
  const t = (qx * B.dir[1] - qz * B.dir[0]) / den;
  const u = (-A.dir[0] * qz + A.dir[1] * qx) / den;
  if (t <= 0.05 || u <= 0.05) return null;
  // Circular-arc handle length (k = 4/3 tan(theta/4) of the turn, as a share of the tangent lengths).
  const turn = Math.PI - angle;
  const k = (4 / 3) * Math.tan(turn / 4) / Math.max(Math.tan(turn / 2), 1e-6);
  const p1: Vec2 = [pa[0] - A.dir[0] * t * k, pa[1] - A.dir[1] * t * k];
  const p2: Vec2 = [pb[0] - B.dir[0] * u * k, pb[1] - B.dir[1] * u * k];
  const points: Vec2[] = [];
  for (let i = 0; i <= segments; i++) {
    const w = i / segments;
    const v = 1 - w;
    const b0 = v * v * v;
    const b1 = 3 * v * v * w;
    const b2 = 3 * v * w * w;
    const b3 = w * w * w;
    points.push([b0 * pa[0] + b1 * p1[0] + b2 * p2[0] + b3 * pb[0], b0 * pa[1] + b1 * p1[1] + b2 * p2[1] + b3 * pb[1]]);
  }
  const i = Math.floor(segments / 2);
  const tx = points[i + 1][0] - points[i - 1][0];
  const tz = points[i + 1][1] - points[i - 1][1];
  const mx = points[i][0] - node[0];
  const mz = points[i][1] - node[1];
  const outward = -tz * mx + tx * mz >= 0 ? 1 : -1;
  return { points, outward };
}

export interface ApproachInput {
  /** Where the lanes end (the junction starts), on the road centreline. */
  end: Vec2;
  /** Unit travel direction. */
  dir: Vec2;
  width: number;
  /** Lanes in the travel direction. */
  lanes: number;
  oneway: boolean;
  /** A mapped crossing just behind the lane end: distance (m) of its centre behind `end`, half width. */
  crossingBehind: { distance: number; half: number } | null;
}

export interface Strip {
  /** Centre of the strip. */
  centre: Vec2;
  /** Lateral extent relative to the road centreline (m, + = right of travel). */
  lo: number;
  hi: number;
  /** Depth along the road (m). */
  depth: number;
}

export interface ApproachLayout {
  /** Distance (m) from the lane end back to the stop line (cars stop just behind it). */
  setback: number;
  stopLine: Strip;
  zebra: Strip | null;
  /** Solid centre line (two-way roads): polyline from the stop line back. */
  solidCentre: [Vec2, Vec2] | null;
  arrows: { x: number; z: number; yaw: number }[];
}

/** Stop-line depth, zebra depth, gap between them (m). */
const STOP_DEPTH = 0.4;
const ZEBRA_DEPTH = 3;
const ZEBRA_GAP = 0.9;
/** Solid centre line length and arrow distance behind the stop line (m). */
const SOLID_LENGTH = 15;
const ARROW_BACK = 9;

export function approachLayout(a: ApproachInput): ApproachLayout {
  const [fx, fz] = a.dir;
  const rx = -fz;
  const rz = fx;
  const lo = a.oneway ? -a.width / 2 : 0;
  const hi = a.width / 2;
  const at = (back: number, lateral: number): Vec2 => [a.end[0] - fx * back + rx * lateral, a.end[1] - fz * back + rz * lateral];
  let setback: number;
  let zebra: Strip | null = null;
  if (a.crossingBehind && a.crossingBehind.distance > -a.crossingBehind.half) {
    setback = a.crossingBehind.distance + a.crossingBehind.half + 0.8;
  } else {
    // Our own zebra right before the junction, the stop line a step behind it.
    const zc = 0.6 + ZEBRA_DEPTH / 2;
    zebra = { centre: at(zc, 0), lo: -a.width / 2, hi: a.width / 2, depth: ZEBRA_DEPTH };
    setback = 0.6 + ZEBRA_DEPTH + ZEBRA_GAP + STOP_DEPTH / 2;
  }
  const stopLine: Strip = { centre: at(setback, (lo + hi) / 2), lo, hi, depth: STOP_DEPTH };
  const solidCentre: [Vec2, Vec2] | null = a.oneway ? null : [at(setback + STOP_DEPTH / 2, 0), at(setback + SOLID_LENGTH, 0)];
  const arrows: ApproachLayout["arrows"] = [];
  if (a.lanes >= 2) {
    const lw = (hi - lo) / a.lanes;
    const yaw = Math.atan2(fx, fz);
    for (let k = 0; k < a.lanes; k++) {
      const [x, z] = at(setback + ARROW_BACK, lo + lw * (k + 0.5));
      arrows.push({ x, z, yaw });
    }
  }
  return { setback, stopLine, zebra, solidCentre, arrows };
}

/**
 * The polyline with extra vertices at the given arc lengths (stations off
 * the line or on an existing vertex are ignored), so draped strips can follow
 * a local profile (dropped kerbs) without resampling the whole line finely.
 */
export function insertStations(points: readonly Vec2[], stations: readonly number[]): Vec2[] {
  const sorted = [...stations].sort((a, b) => a - b);
  const out: Vec2[] = [[points[0][0], points[0][1]]];
  let s0 = 0;
  let k = 0;
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1];
    const [bx, bz] = points[i];
    const len = Math.hypot(bx - ax, bz - az);
    while (k < sorted.length && sorted[k] <= s0 + 1e-6) k++;
    while (k < sorted.length && sorted[k] < s0 + len - 1e-6) {
      const t = (sorted[k] - s0) / len;
      out.push([ax + (bx - ax) * t, az + (bz - az) * t]);
      k++;
    }
    out.push([bx, bz]);
    s0 += len;
  }
  return out;
}
