// Road rendering from the map: draped asphalt ribbons with lane markings
// (one merged mesh per marking style), junction fills, raised sidewalks with
// kerbs along streets that have them, paved footways, zebra crossings, and
// bridge decks with side walls, railings and pillars. Everything is merged
// per material (≈12 draw calls).
//
// Phase 4b: sidewalks dip to road level where a mapped crossing meets them
// (dropped kerbs, with red tactile paving), and the sidewalk corners at
// junctions are closed by curved kerbs (roadDetail.cornerCurve) with the
// corner wedge filled with asphalt. Junction paint lives in markings.ts.

import * as THREE from "three";
import type { CampusMap } from "../../map/loader";
import type { MapRoad, Vec2 } from "../../map/types";
import { edgePolyline } from "../../vehicles/roadNetwork";
import type { DeckProfile } from "./surface";
import { isDrivable } from "./mapPainter";
import { cornerCurve, insertStations, kerbDrop, polylineCrossings, type Arm, type KerbDropSpan } from "./roadDetail";
import {
  appendArrays,
  buildDisc,
  buildRibbon,
  buildWallStrip,
  cumulativeLengths,
  emptyArrays,
  pointAt,
  resamplePolyline,
  trimPolyline,
  type RibbonArrays,
  type StripHeight,
} from "./ribbon";
import {
  ROAD_TEX_LENGTH,
  asphaltTexture,
  concreteTexture,
  pavingTexture,
  roadTexture,
  sidewalkTexture,
  tactileTexture,
  zebraTexture,
  type RoadMarking,
} from "./textures";

/** Heights above the terrain (m) of each layer, lowest first. */
export const LIFT = {
  footway: 0.035,
  junction: 0.05,
  road: 0.06,
  crossing: 0.075,
  kerbTop: 0.16,
} as const;

/** Spacing (m) of bridge pillars. */
const PILLAR_SPACING = 16;
/** Dropped kerb: how far the sidewalk dips at a crossing (m) and the ramp length either side. */
const KERB_DROP = LIFT.kerbTop - LIFT.road - 0.01;
const KERB_RAMP = 1.2;
/** Depth (m) of the tactile paving strip at a dropped kerb. */
const TACTILE_DEPTH = 1.2;

/** Unit direction from the polyline end at `fromStart` (start or end) into the line, measured over ~2 m. */
function endDirection(pts: readonly Vec2[], fromStart: boolean): Vec2 {
  const cum = cumulativeLengths(pts);
  const total = cum[cum.length - 1];
  const d = Math.min(2, total);
  const a = fromStart ? pts[0] : pts[pts.length - 1];
  const b = pointAt(pts, cum, fromStart ? d : total - d);
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
}

export interface RoadsBuild {
  group: THREE.Group;
  stats: { vertices: number; triangles: number; meshes: number; corners: number };
}

type Layer = RoadMarking | "asphalt" | "sidewalk" | "kerb" | "concrete" | "paving" | "zebra" | "tactile";

function markingFor(r: MapRoad): RoadMarking {
  if (!r.oneway && r.lanes >= 2) return "twoWay";
  if (r.oneway && r.lanes >= 2) return `oneWay${Math.min(4, r.lanes)}` as RoadMarking;
  return "plain";
}

/** Box (pillar) as arrays: centre (cx, cz), yaw, half sizes, from y0 to y1. */
function boxArrays(cx: number, cz: number, yaw: number, hx: number, hz: number, y0: number, y1: number): RibbonArrays {
  const out = emptyArrays();
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // Local (lx, lz) -> world, with local z along the road (yaw convention).
  const P = (lx: number, lz: number): Vec2 => [cx + lx * c + lz * s, cz - lx * s + lz * c];
  const corners = [P(-hx, -hz), P(hx, -hz), P(hx, hz), P(-hx, hz)];
  // Orient the ring CCW from above (positive signedArea) for outward walls.
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = corners[i];
    const [x1, z1] = corners[(i + 1) % 4];
    area += x1 * z0 - x0 * z1;
  }
  if (area < 0) corners.reverse();
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i];
    const [bx, bz] = corners[(i + 1) % 4];
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const nx = -(bz - az) / len;
    const nz = (bx - ax) / len;
    const base = out.positions.length / 3;
    out.positions.push(ax, y0, az, bx, y0, bz, ax, y1, az, bx, y1, bz);
    for (let k = 0; k < 4; k++) out.normals.push(nx, 0, nz);
    out.uvs.push(0, 0, len, 0, 0, (y1 - y0) / 2, len, (y1 - y0) / 2);
    out.indices.push(base, base + 1, base + 3, base, base + 3, base + 2);
  }
  return out;
}

export function buildRoads(map: CampusMap, height: (x: number, z: number) => number, decks: readonly DeckProfile[], anisotropy: number): RoadsBuild {
  const layers = new Map<Layer, RibbonArrays>();
  const add = (layer: Layer, a: RibbonArrays) => {
    let dst = layers.get(layer);
    if (!dst) layers.set(layer, (dst = emptyArrays()));
    appendArrays(dst, a);
  };
  const flat: StripHeight = (x, z) => height(x, z);
  const deckOf = new Map<number, DeckProfile>();
  for (const d of decks) deckOf.set(d.road, d);

  // --- Junction geometry: arms (distinct spans) and widest road per node.
  const { nodes, roadEdges } = map.graph;
  const arms = new Map<number, Set<string>>();
  const widest = new Map<number, number>();
  const bridgeNode = new Set<number>();
  const spans = new Map<string, { road: number; lo: number; hi: number; loNode: number; hiNode: number }>();
  for (const e of roadEdges) {
    const lo = Math.min(e.i0, e.i1);
    const hi = Math.max(e.i0, e.i1);
    const key = `${e.road}:${lo}:${hi}`;
    const loNode = e.i0 < e.i1 ? e.from : e.to;
    const hiNode = e.i0 < e.i1 ? e.to : e.from;
    if (!spans.has(key)) spans.set(key, { road: e.road, lo, hi, loNode, hiNode });
    const r = map.roads[e.road];
    for (const n of [e.from, e.to]) {
      let s = arms.get(n);
      if (!s) arms.set(n, (s = new Set()));
      s.add(key);
      widest.set(n, Math.max(widest.get(n) ?? 0, r.width));
      if (r.bridge) bridgeNode.add(n);
    }
  }
  const isJunction = (n: number) => (arms.get(n)?.size ?? 0) >= 3;
  const junctionTrim = (n: number) => (isJunction(n) ? (widest.get(n) ?? 6) / 2 + 0.4 : 0);

  const hasSidewalk = (ri: number) => {
    const r = map.roads[ri];
    return r.sidewalkOffset > 0 && r.class !== "service" && !r.tunnel && !r.bridge;
  };
  const sidewalkWidth = (ri: number) => Math.max(1.5, 2 * (map.roads[ri].sidewalkOffset - map.roads[ri].width / 2));
  /** Trimmed road ends around every junction node (for the curved corners). */
  const junctionArms = new Map<number, { arm: Arm; road: number }[]>();
  const pushArm = (node: number, road: number, pts: readonly Vec2[], atStart: boolean) => {
    if (pts.length < 2) return;
    let list = junctionArms.get(node);
    if (!list) junctionArms.set(node, (list = []));
    const end = atStart ? pts[0] : pts[pts.length - 1];
    list.push({ arm: { end: [end[0], end[1]], dir: endDirection(pts, atStart), half: map.roads[road].width / 2 }, road });
  };

  // --- Drivable pieces: graph spans, plus drivable roads the graph doesn't cover.
  const pieces: { road: number; pts: Vec2[]; sOffset: number }[] = [];
  const covered = new Set<number>();
  for (const sp of spans.values()) {
    covered.add(sp.road);
    const r = map.roads[sp.road];
    const pts = edgePolyline(r, { i0: sp.lo, i1: sp.hi });
    const cum = cumulativeLengths(pts);
    const len = cum[cum.length - 1];
    const t0 = Math.min(junctionTrim(sp.loNode), len * 0.45);
    const t1 = Math.min(junctionTrim(sp.hiNode), len * 0.45);
    const roadCum = cumulativeLengths(r.points);
    const piecePts = t0 + t1 > 0 ? trimPolyline(pts, t0, t1) : pts;
    pieces.push({ road: sp.road, pts: piecePts, sOffset: roadCum[sp.lo] + t0 });
    if (!r.bridge && len > 4) {
      if (t0 > 0) pushArm(sp.loNode, sp.road, piecePts, true);
      if (t1 > 0) pushArm(sp.hiNode, sp.road, piecePts, false);
    }
  }
  map.roads.forEach((r, ri) => {
    if (isDrivable(r.class) && !covered.has(ri)) pieces.push({ road: ri, pts: r.points.map((p) => [p[0], p[1]] as Vec2), sOffset: 0 });
  });

  const crossings = map.roads.filter((r) => r.footway === "crossing");
  for (const p of pieces) {
    const r = map.roads[p.road];
    const w = r.width;
    const deck = r.bridge ? deckOf.get(p.road) : undefined;
    const h: StripHeight = deck ? (_x, _z, s) => deck.deckAt(p.sOffset + s) : flat;
    add(
      markingFor(r),
      buildRibbon(p.pts, { left: -w / 2, right: w / 2, across: Math.max(1, Math.ceil(w / 3.5)), maxSegment: 3, height: h, lift: LIFT.road, vScale: ROAD_TEX_LENGTH }),
    );
    if (deck) {
      // Deck slab sides, railings and pillars.
      for (const side of [1, -1] as const) {
        add("concrete", buildWallStrip(p.pts, { offset: (side * w) / 2, height: h, y0: -1.1, y1: LIFT.road, maxSegment: 3, facing: side, vScale: 2 }));
        add("concrete", buildWallStrip(p.pts, { offset: side * (w / 2 + 0.15), height: h, y0: LIFT.road, y1: 1.0, maxSegment: 3, facing: side, vScale: 2 }));
        add("concrete", buildWallStrip(p.pts, { offset: side * (w / 2 - 0.1), height: h, y0: LIFT.road, y1: 1.0, maxSegment: 3, facing: side === 1 ? -1 : 1, vScale: 2 }));
      }
      const res = resamplePolyline(p.pts, 1);
      const cum = cumulativeLengths(res);
      for (let s = PILLAR_SPACING / 2; s < cum[cum.length - 1]; s += PILLAR_SPACING) {
        let i = 1;
        while (i < cum.length - 1 && cum[i] < s) i++;
        const [x, z] = res[i];
        const yaw = Math.atan2(res[i][0] - res[i - 1][0], res[i][1] - res[i - 1][1]);
        const top = deck.deckAt(p.sOffset + s) - 1.1;
        const ground = height(x, z);
        if (top - ground < 1.2) continue;
        add("concrete", boxArrays(x, z, yaw, Math.min(w * 0.3, 3), 0.6, ground - 0.5, top));
      }
      continue;
    }
    // Sidewalks + kerbs on streets that have them (not on service roads / tunnels),
    // dipping to road level where a mapped crossing meets them (dropped kerbs).
    if (hasSidewalk(p.road)) {
      const sw = sidewalkWidth(p.road);
      const drops: KerbDropSpan[] = [];
      for (const c of crossings) for (const s of polylineCrossings(p.pts, c.points)) drops.push({ s, half: Math.max(3, c.width) / 2 });
      const dropped: StripHeight = drops.length > 0 ? (x, z, s) => flat(x, z, s) - kerbDrop(s, drops, KERB_DROP, KERB_RAMP) : flat;
      // Extra vertices where the profile bends (start/end of each ramp) so the dip is draped exactly.
      const stations = drops.flatMap((d) => [d.s - d.half - KERB_RAMP, d.s - d.half - KERB_RAMP / 2, d.s - d.half, d.s, d.s + d.half, d.s + d.half + KERB_RAMP / 2, d.s + d.half + KERB_RAMP]);
      const swPts = drops.length > 0 ? insertStations(p.pts, stations) : p.pts;
      const seg = 3;
      for (const side of [1, -1] as const) {
        const inner = (side * w) / 2;
        const outer = side * (w / 2 + sw);
        add(
          "sidewalk",
          buildRibbon(swPts, { left: Math.min(inner, outer), right: Math.max(inner, outer), across: 1, maxSegment: seg, height: dropped, lift: LIFT.kerbTop, vScale: 2, u0: 0, u1: sw / 2 }),
        );
        add("kerb", buildWallStrip(swPts, { offset: inner, height: dropped, y0: LIFT.road - 0.03, y1: LIFT.kerbTop, maxSegment: seg, facing: side === 1 ? -1 : 1, vScale: 2 }));
        add("kerb", buildWallStrip(swPts, { offset: outer, height: dropped, y0: -0.05, y1: LIFT.kerbTop, maxSegment: seg, facing: side, vScale: 2 }));
        // Tactile paving on the lowered part, next to the kerb.
        const cum = cumulativeLengths(p.pts);
        const total = cum[cum.length - 1];
        for (const d of drops) {
          const s0 = Math.max(0, d.s - d.half);
          const s1 = Math.min(total, d.s + d.half);
          if (s1 - s0 < 0.5) continue;
          const strip = trimPolyline(p.pts, s0, total - s1);
          const depth = Math.min(TACTILE_DEPTH, sw - 0.2);
          const a = inner;
          const b = side * (w / 2 + depth);
          add("tactile", buildRibbon(strip, { left: Math.min(a, b), right: Math.max(a, b), across: 1, maxSegment: 0.6, height: (x, z) => flat(x, z, 0) - KERB_DROP, lift: LIFT.kerbTop + 0.004, vScale: 1, u0: 0, u1: depth }));
        }
      }
    }
  }

  // --- Curved kerbs closing the sidewalk corners between neighbouring arms of a junction.
  let corners = 0;
  junctionArms.forEach((list, n) => {
    if (list.length < 2 || bridgeNode.has(n)) return;
    const node = nodes[n];
    const sorted = [...list].sort((a, b) => Math.atan2(a.arm.dir[1], a.arm.dir[0]) - Math.atan2(b.arm.dir[1], b.arm.dir[0]));
    for (let i = 0; i < sorted.length; i++) {
      const A = sorted[i];
      const B = sorted[(i + 1) % sorted.length];
      if (A === B) continue;
      const curve = cornerCurve(node, A.arm, B.arm);
      if (!curve) continue;
      // Asphalt wedge between the junction centre and the kerb, so no ground shows in the corner.
      const fan = emptyArrays();
      fan.positions.push(node[0], height(node[0], node[1]) + LIFT.junction, node[1]);
      fan.normals.push(0, 1, 0);
      fan.uvs.push(node[0] / 8, node[1] / 8);
      for (const [x, z] of curve.points) {
        fan.positions.push(x, height(x, z) + LIFT.junction, z);
        fan.normals.push(0, 1, 0);
        fan.uvs.push(x / 8, z / 8);
      }
      for (let k = 1; k < curve.points.length; k++) {
        // Wind upwards whichever way the curve runs.
        const [ax, az] = curve.points[k - 1];
        const [bx, bz] = curve.points[k];
        const up = (ax - node[0]) * (bz - node[1]) - (az - node[1]) * (bx - node[0]) < 0;
        if (up) fan.indices.push(0, k, k + 1);
        else fan.indices.push(0, k + 1, k);
      }
      add("asphalt", fan);
      if (!hasSidewalk(A.road) || !hasSidewalk(B.road)) continue;
      const sw = Math.min(sidewalkWidth(A.road), sidewalkWidth(B.road));
      const o = curve.outward;
      add("sidewalk", buildRibbon(curve.points, { left: o === 1 ? 0 : -sw, right: o === 1 ? sw : 0, across: 1, maxSegment: 1, height: flat, lift: LIFT.kerbTop, vScale: 2, u0: 0, u1: sw / 2 }));
      add("kerb", buildWallStrip(curve.points, { offset: 0, height: flat, y0: LIFT.road - 0.03, y1: LIFT.kerbTop, maxSegment: 1, facing: o === 1 ? -1 : 1, vScale: 2 }));
      add("kerb", buildWallStrip(curve.points, { offset: o * sw, height: flat, y0: -0.05, y1: LIFT.kerbTop, maxSegment: 1, facing: o, vScale: 2 }));
      corners++;
    }
  });

  // --- Junction fills (and joint caps between consecutive pieces).
  arms.forEach((set, n) => {
    if (bridgeNode.has(n)) return;
    const [x, z] = nodes[n];
    const w = widest.get(n) ?? 6;
    const junction = set.size >= 3;
    const disc = buildDisc(x, z, junction ? w / 2 + 0.6 : w / 2, junction ? 24 : 16, height, junction ? LIFT.junction : LIFT.junction - 0.005);
    for (let i = 0; i < disc.uvs.length / 2; i++) {
      disc.uvs[i * 2] = disc.positions[i * 3] / 8;
      disc.uvs[i * 2 + 1] = disc.positions[i * 3 + 2] / 8;
    }
    add("asphalt", disc);
  });

  // --- Footways, pedestrian streets, paths, steps; zebra crossings over the roads.
  const drivableRoads = map.roads.filter((r) => isDrivable(r.class));
  for (const r of map.roads) {
    if (isDrivable(r.class) || r.footway === "sidewalk") continue;
    if (r.footway === "crossing") {
      const w = Math.max(3, r.width);
      // Stripes only over the carriageway(s) it crosses (the sidewalks keep their paving and tactile strips).
      const cum = cumulativeLengths(r.points);
      const total = cum[cum.length - 1];
      let painted = false;
      for (const road of drivableRoads) {
        if (road.bridge || road.tunnel) continue;
        for (const sc of polylineCrossings(r.points, road.points)) {
          const half = road.width / 2 + 0.15;
          const s0 = Math.max(0, sc - half);
          const s1 = Math.min(total, sc + half);
          if (s1 - s0 < 0.5) continue;
          add("zebra", buildRibbon(trimPolyline(r.points, s0, total - s1), { left: -w / 2, right: w / 2, across: 1, maxSegment: 2, height: flat, lift: LIFT.crossing, vScale: 1 }));
          painted = true;
        }
      }
      if (!painted) add("zebra", buildRibbon(r.points, { left: -w / 2, right: w / 2, across: 1, maxSegment: 2, height: flat, lift: LIFT.crossing, vScale: 1 }));
      continue;
    }
    const w = r.width;
    add("paving", buildRibbon(r.points, { left: -w / 2, right: w / 2, across: Math.max(1, Math.ceil(w / 3)), maxSegment: 3, height: flat, lift: LIFT.footway, vScale: 2, u0: 0, u1: w / 2 }));
  }

  // --- Materials and meshes.
  const offset = (factor: number) => ({ polygonOffset: true, polygonOffsetFactor: factor, polygonOffsetUnits: factor * 2 });
  const mats: Record<Layer, THREE.MeshLambertMaterial> = {
    twoWay: new THREE.MeshLambertMaterial({ map: roadTexture("twoWay", anisotropy), ...offset(-2) }),
    oneWay2: new THREE.MeshLambertMaterial({ map: roadTexture("oneWay2", anisotropy), ...offset(-2) }),
    oneWay3: new THREE.MeshLambertMaterial({ map: roadTexture("oneWay3", anisotropy), ...offset(-2) }),
    oneWay4: new THREE.MeshLambertMaterial({ map: roadTexture("oneWay4", anisotropy), ...offset(-2) }),
    plain: new THREE.MeshLambertMaterial({ map: roadTexture("plain", anisotropy), ...offset(-2) }),
    asphalt: new THREE.MeshLambertMaterial({ map: asphaltTexture(anisotropy), ...offset(-1.5) }),
    sidewalk: new THREE.MeshLambertMaterial({ map: sidewalkTexture(anisotropy), ...offset(-2) }),
    kerb: new THREE.MeshLambertMaterial({ map: concreteTexture(anisotropy) }),
    concrete: new THREE.MeshLambertMaterial({ map: concreteTexture(anisotropy) }),
    paving: new THREE.MeshLambertMaterial({ map: pavingTexture(anisotropy), ...offset(-1) }),
    zebra: new THREE.MeshLambertMaterial({ map: zebraTexture(anisotropy), ...offset(-3) }),
    tactile: new THREE.MeshLambertMaterial({ map: tactileTexture(anisotropy), ...offset(-3) }),
  };
  const group = new THREE.Group();
  group.name = "roads";
  let vertices = 0;
  let triangles = 0;
  for (const [layer, a] of layers) {
    if (a.indices.length === 0) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(a.positions, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(a.normals, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(a.uvs, 2));
    g.setIndex(new THREE.Uint32BufferAttribute(a.indices, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mats[layer]);
    m.receiveShadow = true;
    m.name = `roads:${layer}`;
    // Deck/pillar concrete is the only layer tall enough to cast a visible shadow.
    m.castShadow = layer === "concrete";
    group.add(m);
    vertices += a.positions.length / 3;
    triangles += a.indices.length / 3;
  }
  return { group, stats: { vertices, triangles, meshes: group.children.length, corners } };
}
