// Player spawn points on walkways next to named campus buildings.

import { distanceToRing, pointInPolygon, polygonCentroid } from "../../src/game/map/geometry";
import { type BuildingIndex, nearestRoadPoint, type RoadIndex } from "../../src/game/map/queries";
import { SpatialHash } from "../../src/game/map/spatialHash";
import type { MapBuilding, MapRoad, MapSpawn, Vec2 } from "../../src/game/map/types";
import { q } from "./context";
import { resampleAlong } from "./trees";

const WALK_CLASSES = new Set(["footway", "pedestrian", "path", "cycleway", "living_street"]);
const TARGET_CATEGORIES = new Set(["university", "school", "sports"]);
/** Max distance (m) between a spawn and its building. */
const MAX_BUILDING_DISTANCE = 35;
/** Required clearance (m) from any building wall. */
const WALL_CLEARANCE = 2;

export interface SpawnOptions {
  buildings: MapBuilding[];
  roads: MapRoad[];
  buildingIndex: BuildingIndex;
  roadIndex: RoadIndex;
  /** Spawns generated per named building in the first round. */
  perBuilding?: number;
  /** Minimum distance between two spawns. */
  minSpacing?: number;
  /** When > 0, extra rounds with more spawns per building run until reached. */
  minTotal?: number;
}

/** Offsets a polyline sideways by `d` metres (positive = right of travel when seen from above). */
function offsetPolyline(points: readonly Vec2[], d: number): Vec2[] {
  return points.map(([x, z], i) => {
    const [ax, az] = points[Math.max(0, i - 1)];
    const [bx, bz] = points[Math.min(points.length - 1, i + 1)];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    // Right-hand normal of (dx, dz) in a top view with z south is (-dz, dx).
    return [x - (dz / len) * d, z + (dx / len) * d];
  });
}

/** Candidate walkable positions sampled every 2 m. */
function walkableSamples(roads: MapRoad[]): Vec2[] {
  const out: Vec2[] = [];
  for (const r of roads) {
    const lines: Vec2[][] = [];
    if (WALK_CLASSES.has(r.class)) lines.push(r.points);
    if (r.sidewalkOffset > 0 && r.class !== "service") {
      lines.push(offsetPolyline(r.points, r.sidewalkOffset), offsetPolyline(r.points, -r.sidewalkOffset));
    }
    for (const l of lines) out.push(...resampleAlong(l, 2));
  }
  return out;
}

/**
 * Picks spawn points for each named campus building (sorted by name): the
 * walkable samples closest to the building, clear of every footprint and of
 * the carriageways, at least `minSpacing` apart. Each spawn faces the
 * nearest drivable road.
 */
export function generateSpawns(opts: SpawnOptions): MapSpawn[] {
  const { buildings, roads, buildingIndex, roadIndex } = opts;
  const minSpacing = opts.minSpacing ?? 12;
  const drivable = (r: MapRoad) => r.lanes > 0;

  const isClear = ([x, z]: Vec2) => {
    for (const i of buildingIndex.hash.queryRadius(x, z, WALL_CLEARANCE)) {
      const fp = buildings[i].footprint;
      if (pointInPolygon(x, z, fp) || distanceToRing(x, z, fp) < WALL_CLEARANCE) return false;
    }
    const road = nearestRoadPoint(roadIndex, x, z, { filter: drivable, maxDistance: 20 });
    return !road || road.distance > roads[road.road].width / 2 + 1;
  };
  const samples = walkableSamples(roads).filter(isClear);
  const sampleHash = new SpatialHash<number>(16);
  samples.forEach(([x, z], i) => sampleHash.insert(i, x, z, x, z));

  const targets = buildings
    .filter((b) => b.name && TARGET_CATEGORIES.has(b.category))
    .sort((a, b) => (a.name! < b.name! ? -1 : a.name! > b.name! ? 1 : a.id < b.id ? -1 : 1));

  // Candidates per target ordered by distance to the wall (1 m buckets), then to the centroid.
  const ranked = targets.map((b) => {
    const xs = b.footprint.map((p) => p[0]);
    const zs = b.footprint.map((p) => p[1]);
    const [cx, cz] = polygonCentroid(b.footprint);
    const near = sampleHash.query(
      Math.min(...xs) - MAX_BUILDING_DISTANCE,
      Math.min(...zs) - MAX_BUILDING_DISTANCE,
      Math.max(...xs) + MAX_BUILDING_DISTANCE,
      Math.max(...zs) + MAX_BUILDING_DISTANCE,
    );
    return near
      .map((i) => {
        const [x, z] = samples[i];
        const wall = distanceToRing(x, z, b.footprint);
        return { i, wall, key: Math.round(wall) * 1000 + Math.hypot(x - cx, z - cz) };
      })
      .filter((c) => c.wall <= MAX_BUILDING_DISTANCE)
      .sort((a, b2) => a.key - b2.key || a.i - b2.i);
  });

  const spawns: MapSpawn[] = [];
  const farEnough = ([x, z]: Vec2) => spawns.every((s) => Math.hypot(s.x - x, s.z - z) >= minSpacing);
  let perBuilding = opts.perBuilding ?? 2;
  const minTotal = opts.minTotal ?? 0;
  const counts = targets.map(() => 0);
  for (let round = 0; round < 6; round++) {
    targets.forEach((b, t) => {
      for (const c of ranked[t]) {
        if (counts[t] >= perBuilding) break;
        const p = samples[c.i];
        if (!farEnough(p)) continue;
        const road = nearestRoadPoint(roadIndex, p[0], p[1], { filter: drivable });
        const yaw = road ? Math.atan2(road.x - p[0], road.z - p[1]) : 0;
        spawns.push({ x: q(p[0]), z: q(p[1]), yaw: Math.round(yaw * 1000) / 1000, near: b.name! });
        counts[t]++;
      }
    });
    if (spawns.length >= minTotal) break;
    perBuilding++;
  }
  return spawns;
}
