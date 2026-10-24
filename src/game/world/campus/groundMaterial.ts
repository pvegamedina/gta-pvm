// What the ground is made of at a point (footstep timbre, dust vs skid marks):
// asphalt carriageways, paved sidewalks / footways, grass and gravel, read
// from the same map data the world is built from — road centrelines + widths
// (and their generated sidewalk bands, see roads.ts), OSM `surface` tags and
// landuse polygons — so no extra data is needed. Pure (no THREE), tested.

import type { MapLanduse, MapRoad } from "../../map/types";
import { bboxOf, pointInPolygon, pointToSegment } from "../../map/geometry";
import { SpatialHash } from "../../map/spatialHash";
import { createRoadIndex } from "../../map/queries";
import { isDrivable } from "./mapPainter";

export type GroundSurface = "asphalt" | "pavement" | "grass" | "gravel";

const OSM_SURFACES: Record<string, GroundSurface> = {
  asphalt: "asphalt",
  paved: "pavement",
  paving_stones: "pavement",
  concrete: "pavement",
  "concrete:plates": "pavement",
  sett: "pavement",
  cobblestone: "pavement",
  tartan: "pavement",
  metal: "pavement",
  wood: "pavement",
  compacted: "gravel",
  gravel: "gravel",
  fine_gravel: "gravel",
  unpaved: "gravel",
  dirt: "gravel",
  ground: "gravel",
  earth: "gravel",
  sand: "gravel",
  pebblestone: "gravel",
  clay: "gravel",
  grass: "grass",
  artificial_turf: "grass",
};

/** Footstep surface of an OSM `surface=*` value (null when unknown / empty). */
export function osmSurfaceKind(tag: string | undefined): GroundSurface | null {
  return (tag && OSM_SURFACES[tag]) || null;
}

/** Ground of each landuse kind when it has no (known) surface tag. */
const LANDUSE_SURFACE: Partial<Record<MapLanduse["kind"], GroundSurface>> = {
  grass: "grass",
  park: "grass",
  garden: "grass",
  pitch: "grass",
  allotments: "grass",
  farmland: "grass",
  playground: "gravel",
  parking: "asphalt",
  track: "pavement",
  industrial: "pavement",
  residential: "pavement",
  swimming_pool: "pavement",
};

/** Same sidewalk rule as roads.ts: streets with a generated sidewalk band. */
function sidewalkWidth(r: MapRoad): number {
  if (!(r.sidewalkOffset > 0) || r.class === "service" || r.tunnel || r.bridge) return 0;
  return Math.max(1.5, 2 * (r.sidewalkOffset - r.width / 2));
}

/** Widest reach (m) of any road band from its centreline (search radius). */
const MAX_REACH = 20;

/**
 * Builds a `(x, z) => surface` lookup over the map's roads and landuse.
 * Roads win over landuse (closest band edge first); among landuse polygons
 * the smallest containing one wins (a pitch inside a park); open ground is
 * grass.
 */
export function createGroundClassifier(roads: readonly MapRoad[], landuse: readonly MapLanduse[]): (x: number, z: number) => GroundSurface {
  const roadIndex = createRoadIndex(roads);
  const areas = landuse.filter((l) => !l.linear && l.kind !== "water" && l.points.length >= 3);
  const areaSize = areas.map((l) => {
    const b = bboxOf(l.points);
    return (b.maxX - b.minX) * (b.maxZ - b.minZ);
  });
  const hash = new SpatialHash<number>(48);
  areas.forEach((l, i) => {
    const b = bboxOf(l.points);
    hash.insert(i, b.minX, b.minZ, b.maxX, b.maxZ);
  });

  return (x, z) => {
    // Roads: the band (carriageway / sidewalk / footway) the point is deepest inside.
    let best: GroundSurface | null = null;
    let bestExcess = Infinity;
    for (const ref of roadIndex.hash.queryRadius(x, z, MAX_REACH)) {
      const r = roads[ref.road];
      const [ax, az] = r.points[ref.segment];
      const [bx, bz] = r.points[ref.segment + 1];
      const d = pointToSegment(x, z, ax, az, bx, bz).distance;
      if (isDrivable(r.class)) {
        const half = r.width / 2;
        if (d <= half) {
          const excess = d - half;
          if (excess < bestExcess) {
            bestExcess = excess;
            best = osmSurfaceKind(r.surface) === "gravel" ? "gravel" : "asphalt";
          }
          continue;
        }
        const sw = sidewalkWidth(r);
        if (sw > 0 && d <= half + sw) {
          // Sidewalks rank after any carriageway that also covers the point.
          const excess = d - half - sw + 0.001;
          if (excess < bestExcess) {
            bestExcess = excess;
            best = "pavement";
          }
        }
        continue;
      }
      const half = Math.max(1.5, r.width) / 2 + 0.2;
      if (d <= half && d - half < bestExcess) {
        bestExcess = d - half;
        best = osmSurfaceKind(r.surface) ?? (r.class === "track" || r.class === "path" ? "gravel" : "pavement");
      }
    }
    if (best) return best;
    // Landuse: smallest containing polygon.
    let pick = -1;
    for (const i of hash.queryPoint(x, z)) {
      if ((pick < 0 || areaSize[i] < areaSize[pick]) && pointInPolygon(x, z, areas[i].points)) pick = i;
    }
    if (pick >= 0) {
      const l = areas[pick];
      return osmSurfaceKind(l.surface) ?? LANDUSE_SURFACE[l.kind] ?? "grass";
    }
    return "grass";
  };
}
