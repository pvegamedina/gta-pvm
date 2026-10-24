// Trees: OSM tree nodes, tree rows sampled along their line and a sparse
// deterministic scatter inside green areas, each with a species hint.

import {
  bboxOf,
  distanceToRing,
  pointInPolygon,
  polylineLength,
} from "../../src/game/map/geometry";
import { createBuildingIndex, createRoadIndex, nearestRoadPoint } from "../../src/game/map/queries";
import { SpatialHash } from "../../src/game/map/spatialHash";
import type { MapBuilding, MapLanduse, MapRoad, MapTree, Ring, TreeSpecies, Vec2 } from "../../src/game/map/types";
import { type BuildContext, insideBounds, nodeXZ, q } from "./context";
import { hash01, hashXZ } from "./hash";

/** Points every ~`spacing` metres along a polyline, both ends included (evenly spread). */
export function resampleAlong(points: readonly Vec2[], spacing: number): Vec2[] {
  const total = polylineLength(points);
  if (total === 0) return [[q(points[0][0]), q(points[0][1])]];
  const n = Math.max(1, Math.round(total / spacing));
  const step = total / n;
  const out: Vec2[] = [];
  let seg = 0;
  let segStart = 0; // distance at points[seg]
  for (let k = 0; k <= n; k++) {
    const d = k === n ? total : k * step;
    while (seg < points.length - 2) {
      const len = Math.hypot(points[seg + 1][0] - points[seg][0], points[seg + 1][1] - points[seg][1]);
      if (segStart + len >= d) break;
      segStart += len;
      seg++;
    }
    const [ax, az] = points[seg];
    const [bx, bz] = points[seg + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const t = len > 0 ? Math.min(1, Math.max(0, (d - segStart) / len)) : 0;
    out.push([q(ax + (bx - ax) * t), q(az + (bz - az) * t)]);
  }
  return out;
}

export interface SpeciesContext {
  osmSpecies?: string;
  leafType?: string;
  nearMainRoad: boolean;
  nearCampusBuilding: boolean;
  inParkOrLargeGreen: boolean;
  /** Small plant (bush) rather than a tree. */
  small?: boolean;
}

const PINE = /pinus|pine|pino/i;
const PALM = /phoenix|washingtonia|palm|chamaerops|syagrus|trachycarpus|butia/i;

/**
 * Species hint. OSM `species`/`leaf_type` win; otherwise a stable hash of
 * the position picks among the plausible species for the surroundings:
 * palms on main avenues and around campus buildings, pines in parks and large
 * green areas, common broadleaf trees elsewhere.
 */
export function pickSpecies(ctx: SpeciesContext, x: number, z: number): TreeSpecies {
  if (ctx.osmSpecies && PINE.test(ctx.osmSpecies)) return "pine";
  if (ctx.osmSpecies && PALM.test(ctx.osmSpecies)) return "palm";
  if (ctx.leafType === "needleleaved") return "pine";
  if (ctx.small) return "bush";
  const h = hashXZ(x, z, 17);
  if (ctx.nearMainRoad) return h < 0.8 ? "palm" : "common";
  if (ctx.nearCampusBuilding) return h < 0.55 ? "palm" : h < 0.85 ? "common" : "bush";
  if (ctx.inParkOrLargeGreen) return h < 0.65 ? "pine" : h < 0.9 ? "common" : "bush";
  return h < 0.85 ? "common" : "bush";
}

/**
 * Jittered-grid scatter: one candidate per `spacing` cell of a world-aligned
 * grid, kept with probability `probability` when inside the ring and accepted
 * by `accept`. Fully deterministic.
 */
export function scatterInPolygon(
  ring: Ring,
  spacing: number,
  probability: number,
  accept: (x: number, z: number) => boolean,
): Vec2[] {
  const bb = bboxOf(ring);
  const out: Vec2[] = [];
  const salt = Math.round(spacing * 10);
  for (let j = Math.floor(bb.minZ / spacing); j <= Math.floor(bb.maxZ / spacing); j++) {
    for (let i = Math.floor(bb.minX / spacing); i <= Math.floor(bb.maxX / spacing); i++) {
      if (hash01(i, j, salt, 3) >= probability) continue;
      const x = q((i + 0.15 + 0.7 * hash01(i, j, salt, 1)) * spacing);
      const z = q((j + 0.15 + 0.7 * hash01(i, j, salt, 2)) * spacing);
      if (pointInPolygon(x, z, ring) && accept(x, z)) out.push([x, z]);
    }
  }
  return out;
}

const MAIN_ROADS = new Set(["trunk", "primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link"]);
const CAMPUS_CATEGORIES = new Set(["university", "school", "sports"]);
/** Landuse where scattered trees must not grow. */
const NO_TREES = new Set(["pitch", "water", "swimming_pool", "parking", "track", "playground"]);

/** Collects every tree in the map with its species hint. */
export function extractTrees(
  ctx: BuildContext,
  buildings: MapBuilding[],
  roads: MapRoad[],
  landuse: MapLanduse[],
): MapTree[] {
  const bIndex = createBuildingIndex(buildings);
  const rIndex = createRoadIndex(roads);
  const landHash = new SpatialHash<number>(64);
  landuse.forEach((l, i) => {
    const bb = bboxOf(l.points);
    landHash.insert(i, bb.minX, bb.minZ, bb.maxX, bb.maxZ);
  });
  const landAt = (x: number, z: number) =>
    landHash.queryPoint(x, z).filter((i) => pointInPolygon(x, z, landuse[i].points)).map((i) => landuse[i]);

  const nearBuilding = (x: number, z: number, r: number, pred: (b: MapBuilding) => boolean = () => true) =>
    bIndex.hash
      .queryRadius(x, z, r)
      .map((i) => buildings[i])
      .some((b) => pred(b) && (pointInPolygon(x, z, b.footprint) || distanceToRing(x, z, b.footprint) <= r));

  const context = (x: number, z: number): SpeciesContext => {
    const lands = landAt(x, z);
    return {
      nearMainRoad:
        nearestRoadPoint(rIndex, x, z, { maxDistance: 15, filter: (r) => MAIN_ROADS.has(r.class) }) !== null,
      nearCampusBuilding: nearBuilding(x, z, 20, (b) => CAMPUS_CATEGORIES.has(b.category)),
      inParkOrLargeGreen: lands.some(
        (l) => l.kind === "park" || l.kind === "garden" || (l.kind === "grass" && l.area > 3000),
      ),
    };
  };

  const trees: MapTree[] = [];
  const placed = new SpatialHash<Vec2>(8);
  const tooClose = (x: number, z: number, d: number) =>
    placed.queryRadius(x, z, d).some(([px, pz]) => Math.hypot(px - x, pz - z) < d);
  const add = (x: number, z: number, species: TreeSpecies) => {
    trees.push({ x, z, species });
    placed.insert([x, z], x, z, x, z);
  };
  const insideAnyBuilding = (x: number, z: number) => nearBuilding(x, z, 0.5);

  // 1. Mapped single trees.
  const treeNodes = [...ctx.osm.nodes.values()].filter((n) => n.tags?.natural === "tree").sort((a, b) => a.id - b.id);
  for (const n of treeNodes) {
    const p = nodeXZ(ctx, n.id)!;
    if (!insideBounds(ctx.bounds, p[0], p[1]) || insideAnyBuilding(p[0], p[1]) || tooClose(p[0], p[1], 1.5)) continue;
    add(p[0], p[1], pickSpecies({ ...context(p[0], p[1]), osmSpecies: n.tags?.species, leafType: n.tags?.leaf_type }, p[0], p[1]));
  }

  // 2. Tree rows, one tree every ~7 m.
  for (const way of ctx.osm.ways) {
    if (way.tags?.natural !== "tree_row") continue;
    const line = way.nodes.map((id) => nodeXZ(ctx, id)).filter((p): p is Vec2 => p !== null);
    if (line.length < 2) continue;
    for (const [x, z] of resampleAlong(line, 7)) {
      if (!insideBounds(ctx.bounds, x, z) || insideAnyBuilding(x, z) || tooClose(x, z, 3)) continue;
      add(x, z, pickSpecies({ ...context(x, z), osmSpecies: way.tags.species, leafType: way.tags.leaf_type }, x, z));
    }
  }

  // 3. Sparse scatter in green areas (largest first, as stored).
  const clearOfRoads = (x: number, z: number) => {
    const hit = nearestRoadPoint(rIndex, x, z, { maxDistance: 12 });
    return !hit || hit.distance > roads[hit.road].width / 2 + 1.5;
  };
  for (const l of landuse) {
    const spacing = l.kind === "park" || l.kind === "garden" ? 14 : l.kind === "grass" ? 18 : 0;
    if (spacing === 0) continue;
    const probability = l.kind === "grass" ? 0.35 : 0.6;
    const pts = scatterInPolygon(l.points, spacing, probability, (x, z) => {
      if (!insideBounds(ctx.bounds, x, z) || nearBuilding(x, z, 2.5) || !clearOfRoads(x, z) || tooClose(x, z, 4)) {
        return false;
      }
      return !landAt(x, z).some((o) => NO_TREES.has(o.kind));
    });
    for (const [x, z] of pts) {
      const small = hashXZ(x, z, 5) < (l.kind === "garden" ? 0.35 : 0.15);
      add(x, z, pickSpecies({ ...context(x, z), small }, x, z));
    }
  }
  return trees;
}
