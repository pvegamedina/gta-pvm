// Pure lookup helpers over the decoded campus map, shared by the client world
// builder, gameplay systems and the server. No THREE dependency.

import { bboxOf, pointInPolygon, pointToSegment } from "./geometry";
import { SpatialHash } from "./spatialHash";
import type { MapBuilding, MapRoad } from "./types";

export * from "./geometry";
export { heightAt, normalAt, decodeTerrain, type Terrain } from "./terrain";
export { SpatialHash } from "./spatialHash";

// ---------------------------------------------------------------------------
// Buildings

export interface BuildingIndex {
  buildings: readonly MapBuilding[];
  hash: SpatialHash<number>;
}

export function createBuildingIndex(buildings: readonly MapBuilding[], cellSize = 32): BuildingIndex {
  const hash = new SpatialHash<number>(cellSize);
  buildings.forEach((b, i) => {
    const bb = bboxOf(b.footprint);
    hash.insert(i, bb.minX, bb.minZ, bb.maxX, bb.maxZ);
  });
  return { buildings, hash };
}

/** The building whose footprint contains (x, z), or null. */
export function buildingAt(index: BuildingIndex, x: number, z: number): MapBuilding | null {
  for (const i of index.hash.queryPoint(x, z)) {
    const b = index.buildings[i];
    if (pointInPolygon(x, z, b.footprint)) return b;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Roads

interface SegmentRef {
  road: number;
  segment: number;
}

export interface RoadIndex {
  roads: readonly MapRoad[];
  hash: SpatialHash<SegmentRef>;
  /** Extent of every indexed segment, used to bound the nearest search. */
  extent: { minX: number; minZ: number; maxX: number; maxZ: number };
}

export function createRoadIndex(roads: readonly MapRoad[], cellSize = 32): RoadIndex {
  const hash = new SpatialHash<SegmentRef>(cellSize);
  const extent = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  roads.forEach((r, ri) => {
    for (let s = 0; s + 1 < r.points.length; s++) {
      const [ax, az] = r.points[s];
      const [bx, bz] = r.points[s + 1];
      const minX = Math.min(ax, bx);
      const minZ = Math.min(az, bz);
      const maxX = Math.max(ax, bx);
      const maxZ = Math.max(az, bz);
      hash.insert({ road: ri, segment: s }, minX, minZ, maxX, maxZ);
      extent.minX = Math.min(extent.minX, minX);
      extent.minZ = Math.min(extent.minZ, minZ);
      extent.maxX = Math.max(extent.maxX, maxX);
      extent.maxZ = Math.max(extent.maxZ, maxZ);
    }
  });
  return { roads, hash, extent };
}

export interface RoadHit {
  road: number;
  /** Segment index: the hit lies between points[segment] and points[segment + 1]. */
  segment: number;
  t: number;
  x: number;
  z: number;
  distance: number;
}

export interface NearestRoadOptions {
  maxDistance?: number;
  filter?: (road: MapRoad, index: number) => boolean;
}

/** Closest point on any (filtered) road centreline, or null if none within maxDistance. */
export function nearestRoadPoint(
  index: RoadIndex,
  x: number,
  z: number,
  options: NearestRoadOptions = {},
): RoadHit | null {
  const maxDistance = options.maxDistance ?? Infinity;
  const { extent } = index;
  if (!Number.isFinite(extent.minX)) return null;
  // Farthest distance at which an indexed segment could possibly be.
  const reach = Math.hypot(
    Math.max(Math.abs(x - extent.minX), Math.abs(x - extent.maxX)),
    Math.max(Math.abs(z - extent.minZ), Math.abs(z - extent.maxZ)),
  );
  const limit = Math.min(maxDistance, reach);
  let r = index.hash.cellSize;
  for (;;) {
    const radius = Math.min(r, limit);
    let best: RoadHit | null = null;
    for (const ref of index.hash.queryRadius(x, z, radius)) {
      const road = index.roads[ref.road];
      if (options.filter && !options.filter(road, ref.road)) continue;
      const [ax, az] = road.points[ref.segment];
      const [bx, bz] = road.points[ref.segment + 1];
      const p = pointToSegment(x, z, ax, az, bx, bz);
      if (!best || p.distance < best.distance) {
        best = { road: ref.road, segment: ref.segment, t: p.t, x: p.x, z: p.z, distance: p.distance };
      }
    }
    // A hit inside the searched radius is guaranteed to be the global nearest.
    if (best && best.distance <= radius) return best.distance <= maxDistance ? best : null;
    if (radius >= limit) return best && best.distance <= maxDistance ? best : null;
    r *= 2;
  }
}
