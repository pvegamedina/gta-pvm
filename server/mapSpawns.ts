// Spawn points for the server, read once at startup from the same campus map
// file the client renders (public/maps/campus-el-carmen.json). Falls back to
// the protocol's built-in list when the file is missing or invalid so the
// server still starts.

import { readFileSync } from "node:fs";
import path from "node:path";
import { SPAWN_POINTS, type SpawnPoint } from "../shared/protocol";
import { parseCampusMap, type CampusMap } from "../src/game/map/loader";
import type { MapSpawn } from "../src/game/map/types";

export const DEFAULT_MAP_FILE = path.resolve(import.meta.dirname, "../public/maps/campus-el-carmen.json");

/** The map's spawns as protocol SpawnPoints (x, z, yaw only); the fallback list when there are none. */
export function spawnsFromMap(map: { spawns: readonly MapSpawn[] }): readonly SpawnPoint[] {
  if (map.spawns.length === 0) return SPAWN_POINTS;
  return map.spawns.map((s) => ({ x: s.x, z: s.z, yaw: s.yaw }));
}

/** Reads and validates the map file; null (logged) on any error. */
export function loadMap(file: string = DEFAULT_MAP_FILE, warn: (msg: string) => void = console.warn): CampusMap | null {
  try {
    return parseCampusMap(JSON.parse(readFileSync(file, "utf8")) as unknown);
  } catch (err) {
    warn(`[map] could not load ${file}, using the built-in spawn points and no boss: ${(err as Error).message}`);
    return null;
  }
}

/** Reads and validates the map file; logs and falls back to SPAWN_POINTS on any error. */
export function loadMapSpawns(file: string = DEFAULT_MAP_FILE, warn: (msg: string) => void = console.warn): readonly SpawnPoint[] {
  const map = loadMap(file, warn);
  return map ? spawnsFromMap(map) : SPAWN_POINTS;
}

/** Uniform pick from `list` using a [0, 1) random source (1 wraps to the first entry). */
export function pickSpawn(list: readonly SpawnPoint[], random: () => number): SpawnPoint {
  const i = Math.floor(random() * list.length) % list.length;
  return list[i];
}
