import { describe, expect, it } from "vitest";
import path from "node:path";
import { SPAWN_POINTS } from "../shared/protocol";
import { loadMapSpawns, pickSpawn, spawnsFromMap, DEFAULT_MAP_FILE } from "./mapSpawns";

describe("map spawns", () => {
  it("reads the campus map's spawn points from disk", () => {
    const spawns = loadMapSpawns(DEFAULT_MAP_FILE);
    expect(spawns.length).toBe(46);
    for (const s of spawns) {
      expect(Number.isFinite(s.x) && Number.isFinite(s.z) && Number.isFinite(s.yaw)).toBe(true);
      expect(Object.keys(s).sort()).toEqual(["x", "yaw", "z"]);
    }
  });

  it("falls back to the protocol's spawn points when the map cannot be read", () => {
    const warnings: string[] = [];
    const spawns = loadMapSpawns(path.join(import.meta.dirname, "does-not-exist.json"), (m) => warnings.push(m));
    expect(spawns).toBe(SPAWN_POINTS);
    expect(warnings).toHaveLength(1);
  });

  it("keeps only x/z/yaw from map spawns and falls back when the map has none", () => {
    expect(spawnsFromMap({ spawns: [{ x: 1, z: 2, yaw: 3, near: "Biblioteca" }] })).toEqual([{ x: 1, z: 2, yaw: 3 }]);
    expect(spawnsFromMap({ spawns: [] })).toBe(SPAWN_POINTS);
  });

  it("picks spawns uniformly from the random source and never out of range", () => {
    const list = [
      { x: 0, z: 0, yaw: 0 },
      { x: 1, z: 1, yaw: 1 },
      { x: 2, z: 2, yaw: 2 },
    ];
    expect(pickSpawn(list, () => 0)).toBe(list[0]);
    expect(pickSpawn(list, () => 0.5)).toBe(list[1]);
    expect(pickSpawn(list, () => 0.9999)).toBe(list[2]);
    expect(pickSpawn(list, () => 1)).toBe(list[0]);
  });

  it("protocol fallback spawns lie on the campus map", () => {
    for (const s of SPAWN_POINTS) {
      expect(Math.abs(s.x)).toBeLessThan(582);
      expect(s.z).toBeGreaterThan(-635);
      expect(s.z).toBeLessThan(645);
    }
  });
});
