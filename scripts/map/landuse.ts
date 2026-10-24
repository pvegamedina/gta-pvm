// Landuse / leisure / natural areas → MapLanduse polygons, plus the campus outline.

import { ensureCCW, polygonArea, simplifyRing } from "../../src/game/map/geometry";
import type { LanduseKind, MapLanduse, Ring, Vec2 } from "../../src/game/map/types";
import { clipPolygon } from "./clip";
import { type BuildContext, nodeXZ, q } from "./context";
import { isClosed, relationOuterRings, type Tags } from "./osm";

/** OSM way id of "Universidad de Huelva - Campus de El Carmen". */
export const CAMPUS_WAY_ID = 127717781;

/** Maps OSM tags to a landuse kind (null when the area is not rendered). */
export function landuseKind(tags: Tags): LanduseKind | null {
  if (tags.building) return null;
  switch (tags.leisure) {
    case "park":
    case "dog_park":
      return "park";
    case "garden":
      return "garden";
    case "pitch":
      return "pitch";
    case "swimming_pool":
      return "swimming_pool";
    case "playground":
      return "playground";
    case "track":
      return "track";
  }
  if (tags.natural === "water") return "water";
  if (tags.natural === "grassland" || tags.natural === "scrub") return "grass";
  if (tags.amenity === "parking") return "parking";
  switch (tags.landuse) {
    case "grass":
    case "village_green":
    case "meadow":
      return "grass";
    case "recreation_ground":
      return "park";
    case "industrial":
    case "residential":
    case "allotments":
    case "farmland":
      return tags.landuse;
  }
  return null;
}

/** Projects, clips, simplifies and orients a ring of node ids (null if degenerate). */
export function ringFromNodes(ctx: BuildContext, ids: number[], minArea = 4): Ring | null {
  const pts = ids.map((id) => nodeXZ(ctx, id)).filter((p): p is Vec2 => p !== null);
  if (pts.length < 3) return null;
  const clipped = clipPolygon(pts, ctx.bounds).map(([x, z]): Vec2 => [q(x), q(z)]);
  if (clipped.length < 3) return null;
  const ring = ensureCCW(simplifyRing(clipped, 0.1));
  return ring.length >= 3 && polygonArea(ring) >= minArea ? ring : null;
}

/** All landuse polygons, largest first so smaller areas paint on top. */
export function extractLanduse(ctx: BuildContext): MapLanduse[] {
  const out: MapLanduse[] = [];
  const push = (kind: LanduseKind, tags: Tags, ring: Ring) =>
    out.push({ kind, ...(tags.name ? { name: tags.name } : {}), area: Math.round(polygonArea(ring)), points: ring });
  for (const way of ctx.osm.ways) {
    const kind = way.tags && landuseKind(way.tags);
    if (!kind || !isClosed(way)) continue;
    const ring = ringFromNodes(ctx, way.nodes.slice(0, -1));
    if (ring) push(kind, way.tags!, ring);
  }
  for (const rel of ctx.osm.relations) {
    const kind = rel.tags && landuseKind(rel.tags);
    if (!kind) continue;
    for (const ids of relationOuterRings(rel, ctx.osm)) {
      const ring = ringFromNodes(ctx, ids);
      if (ring) push(kind, rel.tags!, ring);
    }
  }
  // Stable sort keeps OSM id order between equal areas.
  return out.sort((a, b) => b.area - a.area);
}

/** Campus outline ring, or [] when the way is missing. */
export function extractCampus(ctx: BuildContext): Ring {
  const way = ctx.osm.wayById.get(CAMPUS_WAY_ID);
  if (!way || !isClosed(way)) return [];
  return ringFromNodes(ctx, way.nodes.slice(0, -1)) ?? [];
}
