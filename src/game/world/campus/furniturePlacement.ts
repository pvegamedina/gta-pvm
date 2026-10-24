// Pure street-furniture placement rules (no THREE): street lamps along the
// kerbs of main streets, benches and bins along the campus footpaths,
// bollards closing pedestrian streets where they meet traffic, bike racks
// (rows of parked bicycles) beside campus building entrances and a few
// traffic-cone groups in car parks. Deterministic (no randomness) so every
// client sees the same street; world/campus/furniture.ts renders the result.

import type { MapRoad, RoadClass, Ring, Vec2 } from "../../map/types";
import { pointInPolygon } from "../../map/geometry";
import { cumulativeLengths, offsetPolyline, pointAt } from "./ribbon";
import { polylineCrossings } from "./roadDetail";

export type PropKind = "lamp" | "bench" | "bin" | "bollard" | "planter" | "bicycle" | "cone";

export interface PropPlacement {
  kind: PropKind;
  x: number;
  z: number;
  /** Game yaw: the prop's front (+z in model space) faces (sin yaw, cos yaw). */
  yaw: number;
  /** Model variant (bicycles) or 0. */
  variant: number;
}

/** Lamp spacing (m) per lit road class. */
export const LAMP_SPACING: Partial<Record<RoadClass, number>> = {
  primary: 30,
  primary_link: 30,
  secondary: 30,
  secondary_link: 30,
  tertiary: 32,
  tertiary_link: 32,
  residential: 36,
  unclassified: 36,
  living_street: 30,
};
/** Lamps stay this far (m) from junction centres and crossings. */
const LAMP_JUNCTION_CLEAR = 9;
const LAMP_CROSSING_CLEAR = 2.5;
/** Lateral position of lamps: this far outside the carriageway edge (m). */
const LAMP_KERB_OFFSET = 0.5;

/** Bench/bin spacing (m) along campus footpaths and their distance from the path edge. */
const PATH_SPACING = 38;
const PATH_EDGE = 0.7;
/** Bicycles per rack and their spacing (m). */
const BIKES_PER_RACK = 5;
const BIKE_SPACING = 0.8;

interface Station {
  x: number;
  z: number;
  /** Travel direction at the station. */
  fx: number;
  fz: number;
}

/** Points every `spacing` metres along `pts` starting at `start`, stopping `endMargin` before its end. */
function stations(pts: readonly Vec2[], start: number, spacing: number, endMargin: number): Station[] {
  const cum = cumulativeLengths(pts);
  const total = cum[cum.length - 1];
  const out: Station[] = [];
  for (let s = start; s <= total - endMargin; s += spacing) {
    const p = pointAt(pts, cum, s);
    const q = pointAt(pts, cum, Math.min(total, s + 0.5));
    const r = pointAt(pts, cum, Math.max(0, s - 0.5));
    const dx = q[0] - r[0];
    const dz = q[1] - r[1];
    const l = Math.hypot(dx, dz) || 1;
    out.push({ x: p[0], z: p[1], fx: dx / l, fz: dz / l });
  }
  return out;
}

export function lampPositions(roads: readonly MapRoad[], junctions: readonly Vec2[], crossings: readonly MapRoad[]): PropPlacement[] {
  const out: PropPlacement[] = [];
  for (const r of roads) {
    const spacing = LAMP_SPACING[r.class];
    if (!spacing || r.sidewalkOffset <= 0 || r.bridge || r.tunnel || r.points.length < 2) continue;
    const crossAt = crossings.flatMap((c) => polylineCrossings(r.points, c.points));
    const off = r.width / 2 + LAMP_KERB_OFFSET;
    // Right-hand kerb (+1) always; the left one (-1) only on two-way streets, staggered by half a spacing.
    for (const side of r.oneway ? [1] : [1, -1]) {
      const line = offsetPolyline(r.points, side * off);
      const centreCum = cumulativeLengths(r.points);
      const centreTotal = centreCum[centreCum.length - 1];
      for (const st of stations(line, side === 1 ? spacing / 2 : spacing, spacing, 4)) {
        if (junctions.some(([jx, jz]) => Math.hypot(jx - st.x, jz - st.z) < LAMP_JUNCTION_CLEAR)) continue;
        // Where along the centreline this lamp stands (for the crossing clearance).
        const sApprox = Math.min(centreTotal, nearestArc(r.points, centreCum, st.x, st.z));
        if (crossAt.some((s) => Math.abs(s - sApprox) < LAMP_CROSSING_CLEAR)) continue;
        // Face the road: towards the centreline, i.e. against this side's outward normal.
        const nx = -st.fz * side;
        const nz = st.fx * side;
        out.push({ kind: "lamp", x: st.x, z: st.z, yaw: Math.atan2(-nx, -nz), variant: 0 });
      }
    }
  }
  return out;
}

/** Arc length along `pts` of the point nearest to (x, z). */
function nearestArc(pts: readonly Vec2[], cum: readonly number[], x: number, z: number): number {
  let best = Infinity;
  let bestS = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const ex = bx - ax;
    const ez = bz - az;
    const l2 = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
    const d = Math.hypot(x - (ax + ex * t), z - (az + ez * t));
    if (d < best) {
      best = d;
      bestS = cum[i] + Math.sqrt(l2) * t;
    }
  }
  return bestS;
}

/** Benches and bins along footpaths / pedestrian streets inside the campus outline. */
export function pathFurniture(roads: readonly MapRoad[], campus: Ring): PropPlacement[] {
  const out: PropPlacement[] = [];
  let k = 0;
  for (const r of roads) {
    if (r.class !== "footway" && r.class !== "pedestrian" && r.class !== "path") continue;
    if (r.footway === "sidewalk" || r.footway === "crossing" || r.points.length < 2) continue;
    for (const st of stations(r.points, 8, PATH_SPACING, 6)) {
      if (campus.length < 3 || !pointInPolygon(st.x, st.z, campus)) continue;
      // Bench, bin, bench, bin... switching sides every pair.
      const side = Math.floor(k / 2) % 2 === 0 ? 1 : -1;
      const kind: PropKind = k % 2 === 1 ? "bin" : "bench";
      k++;
      const off = side * (r.width / 2 + PATH_EDGE);
      const nx = -st.fz * side;
      const nz = st.fx * side;
      out.push({ kind, x: st.x - st.fz * off, z: st.z + st.fx * off, yaw: Math.atan2(-nx, -nz), variant: 0 });
    }
  }
  return out;
}

/** Rows of three bollards just inside each end of a pedestrian street that meets a drivable road. */
export function bollardRows(roads: readonly MapRoad[], drivableDistance: (x: number, z: number) => number): PropPlacement[] {
  const out: PropPlacement[] = [];
  for (const r of roads) {
    if (r.class !== "pedestrian" || r.points.length < 2) continue;
    for (const atStart of [true, false]) {
      const pts = atStart ? r.points : [...r.points].reverse();
      const [ex, ez] = pts[0];
      if (drivableDistance(ex, ez) > 8) continue;
      const cum = cumulativeLengths(pts);
      if (cum[cum.length - 1] < 4) continue;
      const [px, pz] = pointAt(pts, cum, 1.5);
      const [qx, qz] = pointAt(pts, cum, 2.5);
      const l = Math.hypot(qx - px, qz - pz) || 1;
      const fx = (qx - px) / l;
      const fz = (qz - pz) / l;
      for (const lat of [-1.5, 0, 1.5]) out.push({ kind: "bollard", x: px - fz * lat, z: pz + fx * lat, yaw: 0, variant: 0 });
    }
  }
  return out;
}

/** Planters lining pedestrian streets, outside their edges. */
export function planters(roads: readonly MapRoad[]): PropPlacement[] {
  const out: PropPlacement[] = [];
  for (const r of roads) {
    if (r.class !== "pedestrian" || r.points.length < 2) continue;
    for (const st of stations(r.points, 10, 24, 8)) {
      for (const side of [1, -1]) {
        const off = side * (r.width / 2 + 1.2);
        out.push({ kind: "planter", x: st.x - st.fz * off, z: st.z + st.fx * off, yaw: Math.atan2(st.fx, st.fz), variant: 0 });
      }
    }
  }
  return out;
}

/** A row of parked bicycles beside each entrance (`yaw` = the facade's outward direction). */
export function bikeRacks(entrances: readonly { x: number; z: number; yaw: number }[]): PropPlacement[] {
  const out: PropPlacement[] = [];
  entrances.forEach((e, i) => {
    const nx = Math.sin(e.yaw);
    const nz = Math.cos(e.yaw);
    // Along the facade (to the entrance's right as seen from outside), a step back towards the wall.
    const ax = -nz;
    const az = nx;
    for (let k = 0; k < BIKES_PER_RACK; k++) {
      const t = 3 + k * BIKE_SPACING;
      out.push({ kind: "bicycle", x: e.x + ax * t - nx * 0.8, z: e.z + az * t - nz * 0.8, yaw: e.yaw + Math.PI, variant: (i + k) % 2 });
    }
  });
  return out;
}

/** Three cones near a corner of every other car park. */
export function coneGroups(parking: readonly Ring[]): PropPlacement[] {
  const out: PropPlacement[] = [];
  parking.forEach((lot, i) => {
    if (i % 2 === 1 || lot.length < 3) return;
    let cx = 0;
    let cz = 0;
    for (const [x, z] of lot) {
      cx += x / lot.length;
      cz += z / lot.length;
    }
    const [vx, vz] = lot[0];
    const dx = cx - vx;
    const dz = cz - vz;
    const l = Math.hypot(dx, dz) || 1;
    const bx = vx + (dx / l) * Math.min(4, l * 0.5);
    const bz = vz + (dz / l) * Math.min(4, l * 0.5);
    for (let k = 0; k < 3; k++) out.push({ kind: "cone", x: bx - (dz / l) * k * 1.2, z: bz + (dx / l) * k * 1.2, yaw: k, variant: 0 });
  });
  return out;
}

export interface FurnitureInput {
  roads: readonly MapRoad[];
  campus: Ring;
  /** Junction centres (degree >= 3 nodes). */
  junctions: readonly Vec2[];
  /** Building entrances for bike racks (yaw = outward facade direction). */
  entrances: readonly { x: number; z: number; yaw: number }[];
  parking: readonly Ring[];
  /** Distance (m) to the nearest drivable road centreline. */
  drivableDistance: (x: number, z: number) => number;
}

/** Every prop, minus those the caller reports as `blocked` (inside buildings, on carriageways...). */
export function placeFurniture(input: FurnitureInput, blocked: (p: PropPlacement) => boolean): PropPlacement[] {
  const crossings = input.roads.filter((r) => r.footway === "crossing");
  const all = [
    ...lampPositions(input.roads, input.junctions, crossings),
    ...pathFurniture(input.roads, input.campus),
    ...bollardRows(input.roads, input.drivableDistance),
    ...planters(input.roads),
    ...bikeRacks(input.entrances),
    ...coneGroups(input.parking),
  ];
  return all.filter((p) => !blocked(p));
}
