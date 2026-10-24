import { describe, expect, it } from "vitest";
import type { MapBuilding, MapRoad } from "../types";
import { SpatialHash } from "../spatialHash";
import { buildingAt, createBuildingIndex, createRoadIndex, nearestRoadPoint } from "../queries";

function building(id: string, x0: number, z0: number, size: number): MapBuilding {
  return {
    id,
    type: "yes",
    category: "other",
    height: 8,
    heightSource: "default",
    baseMin: 0,
    baseMax: 0,
    footprint: [
      [x0, z0],
      [x0 + size, z0],
      [x0 + size, z0 - size],
      [x0, z0 - size],
    ],
  };
}

function road(id: string, points: [number, number][], cls: MapRoad["class"] = "residential"): MapRoad {
  return { id, class: cls, width: 6.5, lanes: 2, oneway: false, surface: "asphalt", sidewalkOffset: 4.5, points };
}

describe("SpatialHash", () => {
  it("returns each item once for overlapping queries", () => {
    const h = new SpatialHash<string>(10);
    h.insert("a", 0, 0, 25, 25); // spans 9 cells
    h.insert("b", 100, 100, 101, 101);
    expect(h.query(-5, -5, 30, 30)).toEqual(["a"]);
    expect(h.queryPoint(100.5, 100.5)).toEqual(["b"]);
    expect(h.query(-1000, -1000, 1000, 1000).sort()).toEqual(["a", "b"]);
  });

  it("supports negative coordinates", () => {
    const h = new SpatialHash<number>(8);
    h.insert(1, -20, -20, -15, -15);
    expect(h.queryPoint(-18, -18)).toEqual([1]);
    expect(h.queryPoint(18, 18)).toEqual([]);
  });
});

describe("buildingAt", () => {
  const buildings = [building("w1", 0, 0, 10), building("w2", 50, 0, 20)];
  const index = createBuildingIndex(buildings);

  it("finds the building containing a point", () => {
    expect(buildingAt(index, 5, -5)?.id).toBe("w1");
    expect(buildingAt(index, 60, -10)?.id).toBe("w2");
  });

  it("returns null in the open", () => {
    expect(buildingAt(index, 30, -5)).toBeNull();
    expect(buildingAt(index, 5, 5)).toBeNull();
  });
});

describe("nearestRoadPoint", () => {
  const roads = [
    road("w10", [
      [0, 0],
      [100, 0],
    ]),
    road(
      "w11",
      [
        [0, 50],
        [0, 150],
      ],
      "footway",
    ),
  ];
  const index = createRoadIndex(roads);

  it("snaps to the closest segment", () => {
    const hit = nearestRoadPoint(index, 40, 8);
    expect(hit).not.toBeNull();
    expect(hit!.road).toBe(0);
    expect(hit!.x).toBeCloseTo(40);
    expect(hit!.z).toBeCloseTo(0);
    expect(hit!.distance).toBeCloseTo(8);
  });

  it("respects a class filter and a max distance", () => {
    const footOnly = nearestRoadPoint(index, 40, 8, { filter: (r) => r.class === "footway" });
    expect(footOnly!.road).toBe(1);
    expect(nearestRoadPoint(index, 40, 8, { maxDistance: 5 })).toBeNull();
  });

  it("finds far roads beyond the first search ring", () => {
    const hit = nearestRoadPoint(index, 400, 0);
    expect(hit!.road).toBe(0);
    expect(hit!.distance).toBeCloseTo(300);
  });
});
