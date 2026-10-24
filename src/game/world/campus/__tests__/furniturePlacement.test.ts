import { describe, it, expect } from "vitest";
import { bikeRacks, bollardRows, coneGroups, lampPositions, pathFurniture, placeFurniture, LAMP_SPACING } from "../furniturePlacement";
import type { MapRoad, Ring, Vec2 } from "../../../map/types";

function road(id: string, cls: MapRoad["class"], points: Vec2[], extra: Partial<MapRoad> = {}): MapRoad {
  return { id, class: cls, width: 8, lanes: 2, oneway: false, surface: "asphalt", sidewalkOffset: 6, points, ...extra };
}

// A 200 m east-west avenue along z = 0.
const avenue = road("w1", "tertiary", [
  [0, 0],
  [200, 0],
]);

describe("lampPositions", () => {
  it("lines both kerbs of a main road at regular spacing, staggered, facing the road", () => {
    const lamps = lampPositions([avenue], [], []);
    const south = lamps.filter((l) => l.z > 0);
    const north = lamps.filter((l) => l.z < 0);
    expect(south.length).toBeGreaterThan(4);
    expect(north.length).toBeGreaterThan(4);
    // Just outside the kerb (half width 4 m + 0.5 m).
    for (const l of lamps) expect(Math.abs(Math.abs(l.z) - 4.5)).toBeLessThan(1e-6);
    const xs = south.map((l) => l.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(LAMP_SPACING.tertiary!, 6);
    // Staggered: the north row is offset by half a spacing.
    expect(Math.abs(north[0].x - south[0].x)).toBeCloseTo(LAMP_SPACING.tertiary! / 2, 6);
    // Facing the road: forward (sin yaw, cos yaw) points from the lamp to the centreline.
    for (const l of lamps) expect(Math.sign(Math.cos(l.yaw))).toBe(-Math.sign(l.z));
  });

  it("only lights main streets with sidewalks and skips junction areas and crossings", () => {
    const service = road("w2", "service", [[0, 50], [200, 50]]);
    const noWalk = road("w3", "tertiary", [[0, 80], [200, 80]], { sidewalkOffset: 0 });
    expect(lampPositions([service, noWalk], [], [])).toEqual([]);
    const all = lampPositions([avenue], [], []);
    const nearJunction = lampPositions([avenue], [[100, 0]], []);
    expect(nearJunction.length).toBeLessThan(all.length);
    for (const l of nearJunction) expect(Math.hypot(l.x - 100, l.z)).toBeGreaterThan(9);
    const crossing = road("c1", "footway", [[60, -10], [60, 10]], { footway: "crossing", width: 3, sidewalkOffset: 0, lanes: 0 });
    for (const l of lampPositions([avenue], [], [crossing])) expect(Math.abs(l.x - 60)).toBeGreaterThan(2.5);
  });

  it("puts lamps only on the right-hand kerb of one-way carriageways", () => {
    const oneway = road("w4", "secondary", [[0, 0], [200, 0]], { oneway: true });
    const lamps = lampPositions([oneway], [], []);
    // Travelling east, the right-hand side is +z (south).
    expect(lamps.length).toBeGreaterThan(3);
    for (const l of lamps) expect(l.z).toBeGreaterThan(0);
  });
});

describe("pathFurniture", () => {
  const campus: Ring = [
    [0, 0],
    [0, 100],
    [100, 100],
    [100, 0],
  ];
  const path = road("p1", "footway", [[10, 50], [90, 50]], { width: 2.2, lanes: 0, sidewalkOffset: 0 });
  const outside = road("p2", "footway", [[150, 50], [250, 50]], { width: 2.2, lanes: 0, sidewalkOffset: 0 });

  it("puts benches and bins along campus footpaths, beside the path and facing it", () => {
    const items = pathFurniture([path, outside], campus);
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((i) => i.kind === "bench")).toBe(true);
    expect(items.some((i) => i.kind === "bin")).toBe(true);
    for (const i of items) {
      expect(i.x).toBeLessThan(100);
      expect(Math.abs(Math.abs(i.z - 50) - (1.1 + 0.7))).toBeLessThan(1e-6);
      expect(Math.sign(Math.cos(i.yaw))).toBe(-Math.sign(i.z - 50));
    }
  });

  it("ignores sidewalks and crossings", () => {
    const sidewalk = { ...path, footway: "sidewalk" };
    const crossing = { ...path, footway: "crossing" };
    expect(pathFurniture([sidewalk, crossing], campus)).toEqual([]);
  });
});

describe("bollardRows", () => {
  const ped = road("q1", "pedestrian", [[0, 20], [0, 60]], { width: 5, lanes: 0, sidewalkOffset: 0 });
  it("blocks pedestrian streets where they meet a drivable road", () => {
    const rows = bollardRows([ped], (x, z) => Math.abs(z - 15));
    // Only the south end (z = 20) is near the road at z = 15.
    expect(rows.length).toBe(3);
    for (const b of rows) {
      expect(b.kind).toBe("bollard");
      expect(b.z).toBeGreaterThan(20);
      expect(b.z).toBeLessThan(23);
    }
    expect(bollardRows([ped], () => 50)).toEqual([]);
  });
});

describe("bikeRacks", () => {
  it("parks a row of bicycles beside each entrance, perpendicular to the facade", () => {
    const bikes = bikeRacks([{ x: 10, z: 10, yaw: 0 }]);
    expect(bikes.length).toBe(5);
    for (const b of bikes) {
      expect(b.kind).toBe("bicycle");
      expect(Math.abs(Math.sin(b.yaw - Math.PI / 2))).toBeCloseTo(1, 6);
    }
    const xs = bikes.map((b) => b.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4 * 0.8, 6);
  });
});

describe("coneGroups", () => {
  it("drops a few cones in some car parks", () => {
    const lot: Ring = [
      [0, 0],
      [0, 30],
      [40, 30],
      [40, 0],
    ];
    const cones = coneGroups([lot, lot, lot, lot]);
    expect(cones.length).toBeGreaterThan(0);
    expect(cones.length % 3).toBe(0);
    for (const c of cones) expect(c.kind).toBe("cone");
  });
});

describe("placeFurniture", () => {
  it("drops anything the caller reports as blocked and is deterministic", () => {
    const input = { roads: [avenue], campus: [] as Ring, junctions: [] as Vec2[], entrances: [{ x: 50, z: 30, yaw: 0 }], parking: [] as Ring[], drivableDistance: () => 99 };
    const a = placeFurniture(input, () => false);
    const b = placeFurniture(input, () => false);
    expect(a).toEqual(b);
    const none = placeFurniture(input, () => true);
    expect(none).toEqual([]);
  });
});
