// OSM buildings → MapBuilding (footprint, category, height, terrain base).

import {
  bboxOf,
  ensureCCW,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  simplifyRing,
} from "../../src/game/map/geometry";
import { heightAt } from "../../src/game/map/terrain";
import type { BuildingCategory, HeightSource, MapBuilding, Ring, Vec2 } from "../../src/game/map/types";
import { clipPolygon } from "./clip";
import { type BuildContext, insideBounds, nodeXZ, q } from "./context";
import { hash32 } from "./hash";
import { isClosed, parseNumberTag, relationOuterRings, type Tags } from "./osm";

/** Storey height used to convert `building:levels` into metres. */
export const LEVEL_HEIGHT = 3.2;

const DEFAULT_HEIGHT: Record<BuildingCategory, number> = {
  university: 14,
  school: 8,
  sports: 12,
  retail: 7,
  house: 7, // + 0–2 m chosen by hash → 7–9 m
  residential: 9,
  roof: 4,
  industrial: 8,
  other: 8,
};

/** Raw `building=*` values that are small utility structures. */
const SMALL_TYPES = new Set(["service", "shed", "hut", "garage", "garages", "kiosk", "toilets", "cabin"]);

const SPORTS_NAME = /pabell[oó]n de deportes|palacio de deportes|polideportivo/i;

/**
 * Derived building use. `insideCampus` promotes generic buildings within the
 * university outline to "university".
 */
export function buildingCategory(tags: Tags, insideCampus: boolean): BuildingCategory {
  const b = tags.building ?? "yes";
  const amenity = tags.amenity ?? "";
  if (b === "roof") return "roof";
  if (
    tags.leisure === "sports_centre" ||
    tags.leisure === "stadium" ||
    ["sports_hall", "sports_centre", "stadium"].includes(b) ||
    SPORTS_NAME.test(tags.name ?? "")
  ) {
    return "sports";
  }
  if (["school", "kindergarten"].includes(b) || ["school", "kindergarten"].includes(amenity)) return "school";
  if (["university", "college"].includes(b) || ["university", "college", "library"].includes(amenity)) return "university";
  if (["house", "detached", "semidetached_house", "terrace", "bungalow"].includes(b)) return "house";
  if (["apartments", "residential", "dormitory"].includes(b)) return "residential";
  if (["retail", "commercial", "supermarket", "kiosk"].includes(b)) return "retail";
  if (["industrial", "warehouse"].includes(b)) return "industrial";
  if (insideCampus && b === "yes") return "university";
  if (tags.shop || ["fast_food", "restaurant", "cafe", "bank", "car_wash", "fuel"].includes(amenity)) return "retail";
  return "other";
}

export interface HeightInfo {
  height: number;
  source: HeightSource;
  levels?: number;
}

/**
 * Height priority: `height` tag > `building:levels` × 3.2 m > category default.
 * `seed` makes per-building variation (house heights) deterministic; `area`
 * (m²), when known, shrinks defaults for tiny structures.
 */
export function buildingHeight(tags: Tags, category: BuildingCategory, seed: number, area?: number): HeightInfo {
  const rawLevels = parseNumberTag(tags["building:levels"]);
  const levels = rawLevels !== undefined && rawLevels > 0 && rawLevels < 60 ? rawLevels : undefined;
  const tagged = parseNumberTag(tags.height);
  if (tagged !== undefined && tagged > 0 && tagged < 200) return { height: q(tagged), source: "height", levels };
  if (levels !== undefined) return { height: q(levels * LEVEL_HEIGHT), source: "levels", levels };

  let height = DEFAULT_HEIGHT[category];
  if (category === "house") height += hash32(seed) % 3;
  if (SMALL_TYPES.has(tags.building ?? "")) height = 4;
  if (area !== undefined) {
    if (area < 60) height = Math.min(height, 3.5);
    else if (category === "university" && area < 300) height = Math.min(height, 7);
  }
  return { height, source: "default" };
}

/** Projects, clips, simplifies and orients a ring of OSM node ids. */
function footprintFromNodes(ctx: BuildContext, ids: number[]): Ring | null {
  const pts: Vec2[] = [];
  for (const id of ids) {
    const p = nodeXZ(ctx, id);
    if (p) pts.push(p);
  }
  if (pts.length < 3) return null;
  const c = polygonCentroid(pts);
  if (!insideBounds(ctx.bounds, c[0], c[1])) return null;
  const clipped = clipPolygon(pts, ctx.bounds).map(([x, z]): Vec2 => [q(x), q(z)]);
  const ring = ensureCCW(simplifyRing(clipped, 0.15));
  if (ring.length < 3 || polygonArea(ring) < 4) return null;
  return ring;
}

/** Min / max terrain height under a footprint (vertices + interior grid samples). */
export function terrainUnder(ctx: BuildContext, ring: Ring): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  const add = (x: number, z: number) => {
    const h = heightAt(ctx.terrain, x, z);
    if (h < min) min = h;
    if (h > max) max = h;
  };
  for (const [x, z] of ring) add(x, z);
  const bb = bboxOf(ring);
  const step = ctx.terrain.cellSize;
  for (let z = Math.ceil(bb.minZ / step) * step; z <= bb.maxZ; z += step) {
    for (let x = Math.ceil(bb.minX / step) * step; x <= bb.maxX; x += step) {
      if (pointInPolygon(x, z, ring)) add(x, z);
    }
  }
  return { min: q(min), max: q(max) };
}

function makeBuilding(ctx: BuildContext, id: string, numericId: number, tags: Tags, ring: Ring): MapBuilding {
  const [cx, cz] = polygonCentroid(ring);
  const insideCampus = ctx.campus.length >= 3 && pointInPolygon(cx, cz, ctx.campus);
  const category = buildingCategory(tags, insideCampus);
  const area = polygonArea(ring);
  const h = buildingHeight(tags, category, numericId, area);
  const base = terrainUnder(ctx, ring);
  const b: MapBuilding = {
    id,
    ...(tags.name ? { name: tags.name } : {}),
    type: tags.building ?? "yes",
    category,
    ...(h.levels !== undefined ? { levels: h.levels } : {}),
    height: h.height,
    heightSource: h.source,
    baseMin: base.min,
    baseMax: base.max,
    footprint: ring,
  };
  return b;
}

/** All buildings inside the bounds: closed ways first, then multipolygon relations, by OSM id. */
export function extractBuildings(ctx: BuildContext): MapBuilding[] {
  const out: MapBuilding[] = [];
  for (const way of ctx.osm.ways) {
    if (!way.tags?.building || !isClosed(way)) continue;
    const ring = footprintFromNodes(ctx, way.nodes.slice(0, -1));
    if (ring) out.push(makeBuilding(ctx, `w${way.id}`, way.id, way.tags, ring));
  }
  for (const rel of ctx.osm.relations) {
    if (!rel.tags?.building) continue;
    relationOuterRings(rel, ctx.osm).forEach((ids, k) => {
      const ring = footprintFromNodes(ctx, ids);
      if (ring) out.push(makeBuilding(ctx, k === 0 ? `r${rel.id}` : `r${rel.id}#${k}`, rel.id, rel.tags!, ring));
    });
  }
  return out;
}
