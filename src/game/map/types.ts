// Schema of the offline-generated map file `public/maps/campus-el-carmen.json`.
//
// The file is produced by `npm run map:build` (scripts/map/build.ts) from
// OpenStreetMap + IGN MDT05 data and consumed by both the browser (world
// building) and the Node server (spawn points). It must therefore stay plain
// JSON with no DOM- or Node-specific encodings.
//
// Coordinate conventions (shared with the rest of the game):
//   - metres in a local tangent plane centred on `projection.originLat/Lon`;
//   - x grows to the EAST, z grows to the SOUTH, y (height) grows UP, so the
//     map matches three.js when looked at from above with north at the top;
//   - yaw follows the game convention: forward = (sin(yaw), cos(yaw)) in x/z,
//     i.e. yaw 0 faces +z (south) and yaw = atan2(dx, dz);
//   - planar coordinates are quantized to 0.1 m, heights to 0.1 m.

/** Bumped whenever the file layout changes in a non backwards-compatible way. */
export const CAMPUS_MAP_VERSION = 1;

/** A planar point `[x, z]` in metres. */
export type Vec2 = [number, number];

/**
 * Closed polygon ring WITHOUT the repeated closing point. Rings in the file are
 * counter-clockwise when viewed from above (+y looking down, north up); see
 * `signedArea` in `queries.ts`.
 */
export type Ring = Vec2[];

export interface MapProjection {
  originLat: number;
  originLon: number;
  /** Metres per degree of latitude at the origin (x/z scale factors). */
  metresPerDegLat: number;
  metresPerDegLon: number;
}

/** Axis-aligned rectangle in map metres; the playable world extent. */
export interface MapBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/**
 * Regular heightfield. Sample (i, j) sits at
 * x = originX + i * cellSize, z = originZ + j * cellSize and is stored at
 * index j * width + i of the decoded array (row-major, rows run north→south).
 */
export interface TerrainData {
  originX: number;
  originZ: number;
  cellSize: number;
  width: number;
  height: number;
  /** Lowest / highest sample in metres. */
  minHeight: number;
  maxHeight: number;
  /** Encoding of `data`: little-endian int16 decimetres, base64. */
  encoding: "int16le-dm-base64";
  data: string;
}

export type BuildingCategory =
  | "university"
  | "school"
  | "sports"
  | "retail"
  | "house"
  | "residential"
  | "roof"
  | "industrial"
  | "other";

export type HeightSource = "height" | "levels" | "default";

export interface MapBuilding {
  /** OSM element id prefixed with its kind: "w123" (way) or "r456" (relation). */
  id: string;
  name?: string;
  /** Raw OSM `building=*` value ("yes", "house", "retail"…). */
  type: string;
  /** Derived use, drives default heights and facade style. */
  category: BuildingCategory;
  levels?: number;
  /** Height above the footprint base in metres. */
  height: number;
  heightSource: HeightSource;
  /** Min / max terrain height (metres) sampled under the footprint. */
  baseMin: number;
  baseMax: number;
  /** Outer ring only (holes dropped), CCW from above, simplified. */
  footprint: Ring;
}

export type RoadClass =
  | "motorway"
  | "motorway_link"
  | "trunk"
  | "trunk_link"
  | "primary"
  | "primary_link"
  | "secondary"
  | "secondary_link"
  | "tertiary"
  | "tertiary_link"
  | "residential"
  | "unclassified"
  | "living_street"
  | "service"
  | "pedestrian"
  | "footway"
  | "path"
  | "cycleway"
  | "steps"
  | "track";

export interface MapRoad {
  /** OSM way id prefixed with "w"; a way clipped into several pieces gets "w123#1"… */
  id: string;
  class: RoadClass;
  name?: string;
  ref?: string;
  /** Carriageway width in metres. */
  width: number;
  /** Total number of lanes (0 for non-drivable ways). */
  lanes: number;
  /** One-way roads are stored so that travel follows the point order. */
  oneway: boolean;
  surface: string;
  bridge?: boolean;
  tunnel?: boolean;
  layer?: number;
  /** OSM `footway=*` subtype for footways ("sidewalk", "crossing"…). */
  footway?: string;
  /** Lateral distance (m) from the centreline at which pedestrians walk; 0 = no generated sidewalk. */
  sidewalkOffset: number;
  points: Vec2[];
}

/**
 * Directed edge between two graph nodes following `roads[road].points` from
 * point index `i0` to `i1` (i1 < i0 means the polyline is walked backwards).
 */
export interface GraphEdge {
  from: number;
  to: number;
  road: number;
  i0: number;
  i1: number;
  /** Polyline length in metres. */
  length: number;
}

/**
 * Undirected pedestrian edge. `offset` > 0 means the walkable line is a
 * sidewalk running parallel to a road centreline at ±offset metres.
 */
export interface FootEdge extends GraphEdge {
  offset: number;
}

export interface MapGraph {
  /** Shared node table for both graphs (junctions + way ends). */
  nodes: Vec2[];
  /** Directed car graph (drivable classes only, one-ways respected). */
  roadEdges: GraphEdge[];
  /** Pedestrian graph (footways, pedestrian streets, steps, sidewalks). */
  footEdges: FootEdge[];
}

export type LanduseKind =
  | "grass"
  | "park"
  | "garden"
  | "pitch"
  | "water"
  | "swimming_pool"
  | "parking"
  | "playground"
  | "track"
  | "industrial"
  | "residential"
  | "allotments"
  | "farmland";

export interface MapLanduse {
  kind: LanduseKind;
  name?: string;
  /** OSM surface (pitches, tracks): "tartan", "grass", "clay"... */
  surface?: string;
  /** OSM sport of a pitch ("soccer", "tennis", "basketball"...). */
  sport?: string;
  /** A track mapped as a closed LINE (area=no): a running loop, not a filled area. */
  linear?: boolean;
  /** Polygon area in m². */
  area: number;
  points: Ring;
}

export type TreeSpecies = "palm" | "pine" | "common" | "bush";

export interface MapTree {
  x: number;
  z: number;
  species: TreeSpecies;
}

export interface MapSpawn {
  x: number;
  z: number;
  /** Facing the nearest street (game yaw convention). */
  yaw: number;
  /** Name of the campus building the spawn was generated for. */
  near: string;
}

export interface MapTrafficLight {
  /** Junction centre. */
  x: number;
  z: number;
  /** Graph nodes merged into this junction (dual carriageways produce clusters). */
  nodes: number[];
}

export interface CampusMapFile {
  version: typeof CAMPUS_MAP_VERSION;
  name: string;
  attribution: string[];
  projection: MapProjection;
  bounds: MapBounds;
  terrain: TerrainData;
  /** Outline of the university campus (OSM way 127717781), if present. */
  campus: Ring;
  buildings: MapBuilding[];
  roads: MapRoad[];
  graph: MapGraph;
  landuse: MapLanduse[];
  trees: MapTree[];
  spawns: MapSpawn[];
  trafficLights: MapTrafficLight[];
}
