// Pure(ish) map build: raw OSM JSON + DEM bytes → CampusMapFile + JSON text.
// No file-system access here so tests can run it directly.

import { createProjection } from "../../src/game/map/projection";
import { createBuildingIndex, createRoadIndex } from "../../src/game/map/queries";
import { decodeTerrain, encodeTerrainHeights } from "../../src/game/map/terrain";
import { CAMPUS_MAP_VERSION, type CampusMapFile, type TreeSpecies } from "../../src/game/map/types";
import { extractBuildings } from "./buildings";
import type { BuildContext } from "./context";
import { buildTerrainGrid, computeBounds, readDem, smoothRaster } from "./dem";
import { extractCampus, extractLanduse } from "./landuse";
import { parseOverpass } from "./osm";
import { buildGraph, extractRoads, findTrafficLights, graphStats, type GraphStats } from "./roads";
import { generateSpawns } from "./spawns";
import { extractTrees } from "./trees";

/** Overpass / WCS bounding box of the raw data (campus + ~150 m margin). */
export const DATA_BBOX = { south: 37.2647, west: -6.9299, north: 37.2763, east: -6.9167 };
/** Projection origin: centre of the campus bbox (Nominatim, way 127717781). */
export const MAP_ORIGIN = { lat: 37.27055, lon: -6.9233 };
/** Terrain grid spacing in metres (the DEM is ~4.0 m × 5.0 m per pixel here). */
export const TERRAIN_CELL_SIZE = 4;
/** Binomial blur passes over the integer-metre DEM (σ ≈ 1.4 px ≈ 6 m). */
export const DEM_SMOOTH_PASSES = 2;
export const MIN_SPAWNS = 16;

export const ATTRIBUTION = [
  "© OpenStreetMap contributors (ODbL)",
  "© Instituto Geográfico Nacional (CC BY 4.0)",
];

export interface BuildInputs {
  /** Parsed Overpass JSON. */
  osm: unknown;
  /** Raw GeoTIFF bytes. */
  demBytes: Uint8Array;
}

export interface BuildStats {
  bytes: number;
  buildings: number;
  buildingsByHeightSource: Record<string, number>;
  roads: number;
  roadSegments: number;
  graphNodes: number;
  roadEdges: number;
  footEdges: number;
  roadGraph: GraphStats;
  footGraph: GraphStats;
  landuse: number;
  trees: number;
  treesBySpecies: Record<TreeSpecies, number>;
  spawns: number;
  trafficLights: number;
  terrain: { width: number; height: number; cellSize: number; minHeight: number; maxHeight: number };
}

export interface BuildResult {
  file: CampusMapFile;
  json: string;
  stats: BuildStats;
}

export async function buildCampusMap(inputs: BuildInputs): Promise<BuildResult> {
  const osm = parseOverpass(inputs.osm);
  const projection = createProjection(MAP_ORIGIN.lat, MAP_ORIGIN.lon);
  const bounds = computeBounds(projection, DATA_BBOX, TERRAIN_CELL_SIZE);

  // Terrain: decode → smooth → resample → quantize. Later steps sample the
  // quantized grid so building bases match what the game will compute.
  const dem = smoothRaster(await readDem(inputs.demBytes), DEM_SMOOTH_PASSES);
  const grid = buildTerrainGrid(dem, projection, bounds, TERRAIN_CELL_SIZE);
  const data = encodeTerrainHeights(grid.heights);
  const terrainMeta = {
    originX: grid.originX,
    originZ: grid.originZ,
    cellSize: grid.cellSize,
    width: grid.width,
    height: grid.height,
    minHeight: 0,
    maxHeight: 0,
    encoding: "int16le-dm-base64" as const,
    data,
  };
  const terrain = decodeTerrain(terrainMeta);
  let minH = Infinity;
  let maxH = -Infinity;
  for (const h of terrain.heights) {
    minH = Math.min(minH, h);
    maxH = Math.max(maxH, h);
  }
  terrainMeta.minHeight = Math.round(minH * 10) / 10;
  terrainMeta.maxHeight = Math.round(maxH * 10) / 10;

  const ctx: BuildContext = { osm, projection, bounds, terrain, campus: [] };
  ctx.campus = extractCampus(ctx);

  const buildings = extractBuildings(ctx);
  const pieces = extractRoads(ctx);
  const roads = pieces.map((p) => p.road);
  const graph = buildGraph(pieces);
  const trafficLights = findTrafficLights(graph, pieces);
  const landuse = extractLanduse(ctx);
  const trees = extractTrees(ctx, buildings, roads, landuse);
  const spawns = generateSpawns({
    buildings,
    roads,
    buildingIndex: createBuildingIndex(buildings),
    roadIndex: createRoadIndex(roads),
    perBuilding: 2,
    minSpacing: 12,
    minTotal: MIN_SPAWNS,
  });

  const file: CampusMapFile = {
    version: CAMPUS_MAP_VERSION,
    name: "Campus de El Carmen — Universidad de Huelva",
    attribution: ATTRIBUTION,
    projection,
    bounds,
    terrain: terrainMeta,
    campus: ctx.campus,
    buildings,
    roads,
    graph,
    landuse,
    trees,
    spawns,
    trafficLights,
  };
  const json = `${JSON.stringify(file)}\n`;

  const count = <T, K extends string>(items: T[], key: (t: T) => K) =>
    items.reduce<Record<string, number>>((acc, t) => ((acc[key(t)] = (acc[key(t)] ?? 0) + 1), acc), {});
  const stats: BuildStats = {
    bytes: new TextEncoder().encode(json).length,
    buildings: buildings.length,
    buildingsByHeightSource: count(buildings, (b) => b.heightSource),
    roads: roads.length,
    roadSegments: roads.reduce((s, r) => s + r.points.length - 1, 0),
    graphNodes: graph.nodes.length,
    roadEdges: graph.roadEdges.length,
    footEdges: graph.footEdges.length,
    roadGraph: graphStats(graph.nodes.length, graph.roadEdges),
    footGraph: graphStats(graph.nodes.length, graph.footEdges),
    landuse: landuse.length,
    trees: trees.length,
    treesBySpecies: { palm: 0, pine: 0, common: 0, bush: 0, ...count(trees, (t) => t.species) },
    spawns: spawns.length,
    trafficLights: trafficLights.length,
    terrain: {
      width: grid.width,
      height: grid.height,
      cellSize: grid.cellSize,
      minHeight: terrainMeta.minHeight,
      maxHeight: terrainMeta.maxHeight,
    },
  };
  return { file, json, stats };
}
