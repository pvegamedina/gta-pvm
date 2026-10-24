// Shared state handed to every build step.

import type { Terrain } from "../../src/game/map/terrain";
import type { MapBounds, MapProjection, Ring, Vec2 } from "../../src/game/map/types";
import { project } from "../../src/game/map/projection";
import type { OsmData } from "./osm";

export interface BuildContext {
  osm: OsmData;
  projection: MapProjection;
  bounds: MapBounds;
  /** Decoded (already quantized) terrain, identical to what the game will see. */
  terrain: Terrain;
  /** University campus outline (may be empty). */
  campus: Ring;
}

/** Quantizes a coordinate to 0.1 m. */
export function q(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Projected + quantized position of an OSM node, or null when it is missing. */
export function nodeXZ(ctx: Pick<BuildContext, "osm" | "projection">, id: number): Vec2 | null {
  const n = ctx.osm.nodes.get(id);
  if (!n) return null;
  const [x, z] = project(ctx.projection, n.lat, n.lon);
  return [q(x), q(z)];
}

export function insideBounds(b: MapBounds, x: number, z: number, margin = 0): boolean {
  return x >= b.minX - margin && x <= b.maxX + margin && z >= b.minZ - margin && z <= b.maxZ + margin;
}
