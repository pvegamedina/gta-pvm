// Junction paint from the road network: at every signalled approach a stop
// line across the approach lanes, a zebra crossing between it and the
// junction (unless OSM maps one there, in which case the line stops before
// it), a solid centre line on the last metres of two-way roads and straight
// arrows in each lane of multi-lane approaches. The traffic AI is told where
// each stop line is (RoadNetwork.setStopSetback) so cars stop behind it.
// Three merged meshes (white paint, zebras, arrows): 3 draw calls.

import * as THREE from "three";
import type { CampusMap } from "../../map/loader";
import type { Vec2 } from "../../map/types";
import type { RoadNetwork } from "../../vehicles/roadNetwork";
import { appendArrays, buildRibbon, emptyArrays, type RibbonArrays, type StripHeight } from "./ribbon";
import { approachLayout, polylineCrossings } from "./roadDetail";
import { LIFT } from "./roads";
import { arrowTexture, zebraTexture } from "./textures";

/** How far behind a lane end (m) a mapped crossing still counts as "the" crossing of that approach. */
const CROSSING_LOOKBACK = 14;

export interface MarkingsBuild {
  group: THREE.Group;
  stats: { approaches: number; zebras: number; arrows: number; triangles: number };
}

export function buildMarkings(map: CampusMap, net: RoadNetwork, height: (x: number, z: number) => number, anisotropy: number): MarkingsBuild {
  const crossings = map.roads.filter((r) => r.footway === "crossing");
  const paint = emptyArrays();
  const zebras = emptyArrays();
  const arrows = emptyArrays();
  const flat: StripHeight = (x, z) => height(x, z);
  const seen = new Map<string, number>();
  let approaches = 0;
  let zebraCount = 0;
  let arrowCount = 0;

  for (let e = 0; e < net.edges.length; e++) {
    const j = net.stopJunction(e);
    if (j < 0) continue;
    const edge = net.edges[e];
    const road = net.roads[edge.road];
    if (road.bridge || road.tunnel) continue;
    const key = `${j}:${edge.road}:${edge.to}`;
    const known = seen.get(key);
    if (known !== undefined) {
      // Same approach (duplicate edge / other lane group): same stop line.
      net.setStopSetback(e, known);
      continue;
    }
    const lane = net.lanePath(e, 0);
    if (lane.length < 12) continue;
    const yaw = net.endBearing(e);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const lp = lane.pts[lane.pts.length - 1];
    const off = net.laneOffset(e, 0);
    // Back onto the centreline (lane offsets are to the right: (-fz, fx)).
    const end: Vec2 = [lp[0] + fz * off, lp[1] - fx * off];
    const back: Vec2 = [end[0] - fx * CROSSING_LOOKBACK, end[1] - fz * CROSSING_LOOKBACK];
    let crossingBehind: { distance: number; half: number } | null = null;
    for (const c of crossings) {
      for (const s of polylineCrossings([back, end], c.points)) {
        const distance = CROSSING_LOOKBACK - s;
        if (!crossingBehind || distance < crossingBehind.distance) crossingBehind = { distance, half: Math.max(3, c.width) / 2 };
      }
    }
    const lay = approachLayout({ end, dir: [fx, fz], width: road.width, lanes: net.lanesOf(e), oneway: road.oneway, crossingBehind });
    seen.set(key, lay.setback);
    net.setStopSetback(e, lay.setback);
    approaches++;

    const along = (centreBack: number, depth: number): Vec2[] => [
      [end[0] - fx * (centreBack + depth / 2), end[1] - fz * (centreBack + depth / 2)],
      [end[0] - fx * (centreBack - depth / 2), end[1] - fz * (centreBack - depth / 2)],
    ];
    const ribbon = (dst: RibbonArrays, pts: Vec2[], left: number, right: number, vScale: number, u0 = 0, u1 = 1) =>
      appendArrays(dst, buildRibbon(pts, { left, right, across: Math.max(1, Math.ceil((right - left) / 2.5)), maxSegment: 2, height: flat, lift: LIFT.crossing + 0.004, vScale, u0, u1 }));

    ribbon(paint, along(lay.setback, lay.stopLine.depth), lay.stopLine.lo, lay.stopLine.hi, 1);
    if (lay.solidCentre) ribbon(paint, [lay.solidCentre[1], lay.solidCentre[0]], -0.08, 0.08, 1);
    if (lay.zebra) {
      const z = lay.zebra;
      const cBack = Math.hypot(z.centre[0] - end[0], z.centre[1] - end[1]);
      const cx = end[0] - fx * cBack;
      const cz = end[1] - fz * cBack;
      // Along the walking direction (the road's right), so the stripes run parallel to the traffic.
      const walk: Vec2[] = [
        [cx - fz * z.lo, cz + fx * z.lo],
        [cx - fz * z.hi, cz + fx * z.hi],
      ];
      ribbon(zebras, walk, -z.depth / 2, z.depth / 2, 1);
      zebraCount++;
    }
    for (const a of lay.arrows) {
      const ax = Math.sin(a.yaw);
      const az = Math.cos(a.yaw);
      ribbon(arrows, [[a.x - ax * 1.5, a.z - az * 1.5], [a.x + ax * 1.5, a.z + az * 1.5]], -0.5, 0.5, 3);
      arrowCount++;
    }
  }

  const offset = { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 };
  const group = new THREE.Group();
  group.name = "roads:markings";
  let triangles = 0;
  const add = (a: RibbonArrays, mat: THREE.Material, name: string) => {
    if (a.indices.length === 0) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(a.positions, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(a.normals, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(a.uvs, 2));
    g.setIndex(new THREE.Uint32BufferAttribute(a.indices, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.name = name;
    group.add(m);
    triangles += a.indices.length / 3;
  };
  add(paint, new THREE.MeshLambertMaterial({ color: 0xcfcfc8, ...offset }), "roads:paint");
  add(zebras, new THREE.MeshLambertMaterial({ map: zebraTexture(anisotropy), ...offset }), "roads:junctionZebras");
  add(arrows, new THREE.MeshLambertMaterial({ map: arrowTexture(anisotropy), alphaTest: 0.5, ...offset }), "roads:arrows");
  return { group, stats: { approaches, zebras: zebraCount, arrows: arrowCount, triangles } };
}
