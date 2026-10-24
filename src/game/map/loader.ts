// Parses and validates the campus map file. Works unchanged in the browser and
// in Node (plain JSON + atob), so the server can read spawn points from the
// same file the client renders.

import { decodeTerrain, type Terrain } from "./terrain";
import {
  CAMPUS_MAP_VERSION,
  type BuildingCategory,
  type CampusMapFile,
  type LanduseKind,
  type RoadClass,
  type TreeSpecies,
} from "./types";

/** Default public URL of the generated map. */
export const CAMPUS_MAP_URL = "/maps/campus-el-carmen.json";

/** The validated file plus its decoded heightfield. */
export interface CampusMap extends CampusMapFile {
  terrainGrid: Terrain;
}

export class MapValidationError extends Error {
  constructor(message: string) {
    super(`Invalid campus map: ${message}`);
    this.name = "MapValidationError";
  }
}

const ROAD_CLASSES: ReadonlySet<RoadClass> = new Set<RoadClass>([
  "motorway",
  "motorway_link",
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
  "secondary",
  "secondary_link",
  "tertiary",
  "tertiary_link",
  "residential",
  "unclassified",
  "living_street",
  "service",
  "pedestrian",
  "footway",
  "path",
  "cycleway",
  "steps",
  "track",
]);
const BUILDING_CATEGORIES: ReadonlySet<BuildingCategory> = new Set<BuildingCategory>([
  "university",
  "school",
  "sports",
  "retail",
  "house",
  "residential",
  "roof",
  "industrial",
  "other",
]);
const LANDUSE_KINDS: ReadonlySet<LanduseKind> = new Set<LanduseKind>([
  "grass",
  "park",
  "garden",
  "pitch",
  "water",
  "swimming_pool",
  "parking",
  "playground",
  "track",
  "industrial",
  "residential",
  "allotments",
  "farmland",
]);
const TREE_SPECIES: ReadonlySet<TreeSpecies> = new Set<TreeSpecies>(["palm", "pine", "common", "bush"]);

// --- tiny assertion helpers (each throws with the JSON path of the problem) ---

function fail(path: string, what: string): never {
  throw new MapValidationError(`${path} ${what}`);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function obj(v: unknown, path: string): Record<string, unknown> {
  if (!isObject(v)) fail(path, "must be an object");
  return v;
}

function arr(v: unknown, path: string, minLength = 0): unknown[] {
  if (!Array.isArray(v)) fail(path, "must be an array");
  if (v.length < minLength) fail(path, `must have at least ${minLength} item(s)`);
  return v;
}

function num(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) fail(path, "must be a finite number");
  return v;
}

function int(v: unknown, path: string, min: number, maxExclusive: number): number {
  const n = num(v, path);
  if (!Number.isInteger(n) || n < min || n >= maxExclusive) fail(path, `must be an integer in [${min}, ${maxExclusive})`);
  return n;
}

function str(v: unknown, path: string): string {
  if (typeof v !== "string") fail(path, "must be a string");
  return v;
}

function optStr(v: unknown, path: string): void {
  if (v !== undefined) str(v, path);
}

function oneOf<T extends string>(v: unknown, set: ReadonlySet<T>, path: string): T {
  if (typeof v !== "string" || !set.has(v as T)) fail(path, `must be one of ${[...set].join(", ")}`);
  return v as T;
}

function vec2(v: unknown, path: string): void {
  const a = arr(v, path);
  if (a.length !== 2) fail(path, "must be an [x, z] pair");
  num(a[0], path);
  num(a[1], path);
}

function points(v: unknown, path: string, minLength: number): unknown[] {
  const a = arr(v, path, minLength);
  a.forEach((p, i) => vec2(p, `${path}[${i}]`));
  return a;
}

// --- validation ---

function validate(m: Record<string, unknown>): CampusMapFile {
  if (m.version !== CAMPUS_MAP_VERSION) fail("version", `must be ${CAMPUS_MAP_VERSION} (got ${String(m.version)})`);
  str(m.name, "name");
  arr(m.attribution, "attribution", 1).forEach((a, i) => str(a, `attribution[${i}]`));

  const proj = obj(m.projection, "projection");
  for (const k of ["originLat", "originLon", "metresPerDegLat", "metresPerDegLon"]) num(proj[k], `projection.${k}`);

  const bounds = obj(m.bounds, "bounds");
  for (const k of ["minX", "minZ", "maxX", "maxZ"]) num(bounds[k], `bounds.${k}`);

  const terrain = obj(m.terrain, "terrain");
  for (const k of ["originX", "originZ", "cellSize", "minHeight", "maxHeight"]) num(terrain[k], `terrain.${k}`);
  int(terrain.width, "terrain.width", 2, 1 << 16);
  int(terrain.height, "terrain.height", 2, 1 << 16);
  if (terrain.encoding !== "int16le-dm-base64") fail("terrain.encoding", "must be int16le-dm-base64");
  str(terrain.data, "terrain.data");

  points(m.campus, "campus", 0);

  arr(m.buildings, "buildings").forEach((raw, i) => {
    const p = `buildings[${i}]`;
    const b = obj(raw, p);
    str(b.id, `${p}.id`);
    optStr(b.name, `${p}.name`);
    str(b.type, `${p}.type`);
    oneOf(b.category, BUILDING_CATEGORIES, `${p}.category`);
    if (b.levels !== undefined) num(b.levels, `${p}.levels`);
    if (num(b.height, `${p}.height`) <= 0) fail(`${p}.height`, "must be > 0");
    num(b.baseMin, `${p}.baseMin`);
    num(b.baseMax, `${p}.baseMax`);
    points(b.footprint, `${p}.footprint`, 3);
  });

  const roads = arr(m.roads, "roads").map((raw, i) => {
    const p = `roads[${i}]`;
    const r = obj(raw, p);
    str(r.id, `${p}.id`);
    oneOf(r.class, ROAD_CLASSES, `${p}.class`);
    optStr(r.name, `${p}.name`);
    optStr(r.ref, `${p}.ref`);
    num(r.width, `${p}.width`);
    num(r.lanes, `${p}.lanes`);
    if (typeof r.oneway !== "boolean") fail(`${p}.oneway`, "must be a boolean");
    str(r.surface, `${p}.surface`);
    num(r.sidewalkOffset, `${p}.sidewalkOffset`);
    return points(r.points, `${p}.points`, 2).length;
  });

  const graph = obj(m.graph, "graph");
  const nodeCount = points(graph.nodes, "graph.nodes", 0).length;
  const checkEdges = (key: "roadEdges" | "footEdges") => {
    arr(graph[key], `graph.${key}`).forEach((raw, i) => {
      const p = `graph.${key}[${i}]`;
      const e = obj(raw, p);
      int(e.from, `${p}.from`, 0, nodeCount);
      int(e.to, `${p}.to`, 0, nodeCount);
      const road = int(e.road, `${p}.road`, 0, roads.length);
      int(e.i0, `${p}.i0`, 0, roads[road]);
      int(e.i1, `${p}.i1`, 0, roads[road]);
      num(e.length, `${p}.length`);
      if (key === "footEdges") num(e.offset, `${p}.offset`);
    });
  };
  checkEdges("roadEdges");
  checkEdges("footEdges");

  arr(m.landuse, "landuse").forEach((raw, i) => {
    const p = `landuse[${i}]`;
    const l = obj(raw, p);
    oneOf(l.kind, LANDUSE_KINDS, `${p}.kind`);
    optStr(l.name, `${p}.name`);
    num(l.area, `${p}.area`);
    points(l.points, `${p}.points`, 3);
  });

  arr(m.trees, "trees").forEach((raw, i) => {
    const p = `trees[${i}]`;
    const t = obj(raw, p);
    num(t.x, `${p}.x`);
    num(t.z, `${p}.z`);
    oneOf(t.species, TREE_SPECIES, `${p}.species`);
  });

  arr(m.spawns, "spawns", 1).forEach((raw, i) => {
    const p = `spawns[${i}]`;
    const s = obj(raw, p);
    num(s.x, `${p}.x`);
    num(s.z, `${p}.z`);
    num(s.yaw, `${p}.yaw`);
    str(s.near, `${p}.near`);
  });

  arr(m.trafficLights, "trafficLights").forEach((raw, i) => {
    const p = `trafficLights[${i}]`;
    const t = obj(raw, p);
    num(t.x, `${p}.x`);
    num(t.z, `${p}.z`);
    arr(t.nodes, `${p}.nodes`, 1).forEach((n, j) => int(n, `${p}.nodes[${j}]`, 0, nodeCount));
  });

  return m as unknown as CampusMapFile;
}

/**
 * Validates a parsed map (or its JSON text) and decodes the terrain.
 * Throws MapValidationError with the JSON path of the first problem found.
 */
export function parseCampusMap(input: unknown): CampusMap {
  let data = input;
  if (typeof input === "string") {
    try {
      data = JSON.parse(input);
    } catch (e) {
      throw new MapValidationError(`not valid JSON (${(e as Error).message})`);
    }
  }
  const file = validate(obj(data, "root"));
  let terrainGrid: Terrain;
  try {
    terrainGrid = decodeTerrain(file.terrain);
  } catch (e) {
    throw new MapValidationError((e as Error).message);
  }
  return { ...file, terrainGrid };
}

/** Fetches and parses the map (browser, or Node ≥ 18 with an absolute URL). */
export async function fetchCampusMap(url: string = CAMPUS_MAP_URL, fetchImpl: typeof fetch = fetch): Promise<CampusMap> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Failed to load campus map ${url}: HTTP ${res.status}`);
  return parseCampusMap(await res.text());
}
