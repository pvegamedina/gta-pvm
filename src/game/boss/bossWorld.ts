// BossWorld (see bossBrain.ts) built from the campus map: terrain height,
// building occlusion and walkability. Pure, so the server and the offline
// client build exactly the same one.

import type { CampusMap } from "../map/loader";
import { bboxOf, buildingAt, createBuildingIndex, heightAt, pointInPolygon, polygonCentroid } from "../map/queries";
import type { Ring } from "../map/types";
import type { BossWorld } from "./bossBrain";

/** Line-of-sight samples are this far apart (m). */
const LOS_STEP = 1.5;
/** Patrol points keep this far from the map edge (m). */
const EDGE_MARGIN = 20;

export function createBossWorld(map: CampusMap): BossWorld {
  const buildings = createBuildingIndex(map.buildings);
  const t = map.terrainGrid;
  const groundY = (x: number, z: number) => heightAt(t, x, z);
  const water = map.landuse
    .filter((l) => (l.kind === "water" || l.kind === "swimming_pool") && !l.linear)
    .map((l) => ({ ring: l.points as Ring, bb: bboxOf(l.points) }));
  const b = map.bounds;

  const inWater = (x: number, z: number) =>
    water.some((w) => x >= w.bb.minX && x <= w.bb.maxX && z >= w.bb.minZ && z <= w.bb.maxZ && pointInPolygon(x, z, w.ring));

  const walkable = (x: number, z: number) =>
    x > b.minX + EDGE_MARGIN && x < b.maxX - EDGE_MARGIN && z > b.minZ + EDGE_MARGIN && z < b.maxZ - EDGE_MARGIN &&
    !buildingAt(buildings, x, z) &&
    !inWater(x, z);

  const clearLine = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / LOS_STEP));
    // Skip the end points: someone standing right against a wall can still be seen.
    for (let i = 1; i < n; i++) {
      const f = i / n;
      const x = ax + (bx - ax) * f;
      const z = az + (bz - az) * f;
      const y = ay + (by - ay) * f;
      const hit = buildingAt(buildings, x, z);
      if (hit && y < hit.baseMin + hit.height) return false;
      if (y < groundY(x, z)) return false;
    }
    return true;
  };

  // Patrol points: the pedestrian graph's junctions and way ends.
  const used = new Set<number>();
  for (const e of map.graph.footEdges) {
    used.add(e.from);
    used.add(e.to);
  }
  const waypoints = [...used].map((i) => map.graph.nodes[i]).filter(([x, z]) => walkable(x, z));
  const home = map.campus.length >= 3 ? polygonCentroid(map.campus) : ([0, 0] as const);

  return { groundY, clearLine, walkable, waypoints, home };
}
