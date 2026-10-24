// End-to-end checks of the map pipeline on the committed raw data
// (data/campus/osm.json + mdt05.tif).

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildCampusMap, type BuildResult } from "../pipeline";
import { parseCampusMap, type CampusMap } from "../../../src/game/map/loader";
import {
  buildingAt,
  createBuildingIndex,
  createRoadIndex,
  heightAt,
  nearestRoadPoint,
  signedArea,
} from "../../../src/game/map/queries";

const root = path.resolve(import.meta.dirname, "../../..");
const readInputs = () => ({
  osm: JSON.parse(readFileSync(path.join(root, "data/campus/osm.json"), "utf8")) as unknown,
  demBytes: new Uint8Array(readFileSync(path.join(root, "data/campus/mdt05.tif"))),
});

let result: BuildResult;
let map: CampusMap;

beforeAll(async () => {
  result = await buildCampusMap(readInputs());
  map = parseCampusMap(result.json);
}, 60_000);

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("campus map build", () => {
  it("is deterministic (same input → byte-identical output)", async () => {
    const again = await buildCampusMap(readInputs());
    expect(sha(again.json)).toBe(sha(result.json));
  }, 60_000);

  it("stays within the 1.5 MB size budget and passes the loader validation", () => {
    expect(Buffer.byteLength(result.json, "utf8")).toBeLessThan(1.5 * 1024 * 1024);
    expect(map.version).toBe(1);
    expect(map.attribution.join(" ")).toContain("OpenStreetMap");
    expect(map.attribution.join(" ")).toContain("Instituto Geográfico Nacional");
  });

  it("has terrain that is high in the north-west and low in the south-east", () => {
    const { minX, minZ, maxX, maxZ } = map.bounds;
    const qx = (maxX - minX) / 4;
    const qz = (maxZ - minZ) / 4;
    const nw = heightAt(map.terrainGrid, minX + qx, minZ + qz);
    const se = heightAt(map.terrainGrid, maxX - qx, maxZ - qz);
    expect(nw).toBeGreaterThan(se + 5);
    expect(map.terrain.minHeight).toBeGreaterThanOrEqual(0);
    expect(map.terrain.maxHeight).toBeLessThanOrEqual(35);
  });

  it("keeps named campus buildings with sane footprints and heights", () => {
    expect(map.buildings.length).toBeGreaterThan(120);
    const names = map.buildings.map((b) => b.name);
    for (const n of ["Aulario Galileo Galilei", "Facultad de Derecho", 'Edificio "Alan Turing"', "Comedor Universitario"]) {
      expect(names).toContain(n);
    }
    for (const b of map.buildings) {
      expect(signedArea(b.footprint)).toBeGreaterThan(0);
      expect(b.height).toBeGreaterThan(2);
      expect(b.baseMax).toBeGreaterThanOrEqual(b.baseMin);
    }
    expect(map.buildings.find((b) => b.name === "Aulario Galileo Galilei")!.height).toBeCloseTo(12.8);
  });

  it("builds a mostly connected directed road graph", () => {
    const s = result.stats.roadGraph;
    expect(map.graph.roadEdges.length).toBeGreaterThan(300);
    expect(s.largestEdgeShare).toBeGreaterThan(0.75);
    expect(result.stats.footGraph.largestEdgeShare).toBeGreaterThan(0.6);
    expect(map.roads.some((r) => r.class === "motorway")).toBe(true);
    expect(map.trafficLights.length).toBeGreaterThan(0);
  });

  it("places ≥ 16 spawn points on walkable ground, clear of buildings and carriageways", () => {
    expect(map.spawns.length).toBeGreaterThanOrEqual(16);
    const bIndex = createBuildingIndex(map.buildings);
    const rIndex = createRoadIndex(map.roads);
    for (const s of map.spawns) {
      expect(buildingAt(bIndex, s.x, s.z)).toBeNull();
      const drive = nearestRoadPoint(rIndex, s.x, s.z, { filter: (r) => r.lanes > 0 })!;
      expect(drive.distance).toBeGreaterThan(map.roads[drive.road].width / 2);
      // Either on a footway-like centreline or on a generated sidewalk band.
      const foot = nearestRoadPoint(rIndex, s.x, s.z, { filter: (r) => r.lanes === 0, maxDistance: 3 });
      const sidewalk = nearestRoadPoint(rIndex, s.x, s.z, {
        filter: (r) => r.sidewalkOffset > 0,
        maxDistance: 12,
      });
      const onSidewalk = sidewalk !== null && Math.abs(sidewalk.distance - map.roads[sidewalk.road].sidewalkOffset) < 1.5;
      expect(foot !== null || onSidewalk).toBe(true);
    }
  });

  it("plants every species, never inside buildings", () => {
    const bIndex = createBuildingIndex(map.buildings);
    const species = new Set(map.trees.map((t) => t.species));
    expect([...species].sort()).toEqual(["bush", "common", "palm", "pine"]);
    for (const t of map.trees) expect(buildingAt(bIndex, t.x, t.z)).toBeNull();
  });
});
