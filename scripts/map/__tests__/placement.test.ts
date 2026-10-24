import { describe, expect, it } from "vitest";
import type { MapBuilding, MapRoad } from "../../../src/game/map/types";
import { createBuildingIndex, createRoadIndex, pointInPolygon } from "../../../src/game/map/queries";
import { pickSpecies, scatterInPolygon } from "../trees";
import { generateSpawns } from "../spawns";

describe("pickSpecies", () => {
  const base = { nearMainRoad: false, nearCampusBuilding: false, inParkOrLargeGreen: false };

  it("is deterministic for a given position", () => {
    expect(pickSpecies(base, 12.3, -45.6)).toBe(pickSpecies(base, 12.3, -45.6));
  });

  it("trusts OSM species and leaf type", () => {
    expect(pickSpecies({ ...base, osmSpecies: "Pinus pinea" }, 0, 0)).toBe("pine");
    expect(pickSpecies({ ...base, leafType: "needleleaved" }, 0, 0)).toBe("pine");
    expect(pickSpecies({ ...base, osmSpecies: "Washingtonia robusta", inParkOrLargeGreen: true }, 0, 0)).toBe("palm");
  });

  it("favours palms on avenues, pines in parks and bushes for small plants", () => {
    const count = (ctx: Parameters<typeof pickSpecies>[0], species: string) => {
      let n = 0;
      for (let i = 0; i < 400; i++) if (pickSpecies(ctx, i * 1.7, i * -2.3) === species) n++;
      return n;
    };
    expect(count({ ...base, nearMainRoad: true }, "palm")).toBeGreaterThan(250);
    expect(count({ ...base, inParkOrLargeGreen: true }, "pine")).toBeGreaterThan(200);
    expect(count({ ...base, small: true }, "bush")).toBe(400);
    expect(count(base, "palm")).toBe(0);
  });
});

describe("scatterInPolygon", () => {
  const square: [number, number][] = [
    [0, 0],
    [100, 0],
    [100, -100],
    [0, -100],
  ];

  it("scatters deterministic points inside the polygon at roughly the requested density", () => {
    const a = scatterInPolygon(square, 10, 1, () => true);
    const b = scatterInPolygon(square, 10, 1, () => true);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(60);
    expect(a.length).toBeLessThanOrEqual(121);
    for (const [x, z] of a) expect(pointInPolygon(x, z, square)).toBe(true);
  });

  it("honours the acceptance probability and the blocking predicate", () => {
    const half = scatterInPolygon(square, 10, 0.5, () => true);
    expect(half.length).toBeLessThan(80);
    const blocked = scatterInPolygon(square, 10, 1, (x) => x > 50);
    for (const [x] of blocked) expect(x).toBeGreaterThan(50);
  });
});

describe("generateSpawns", () => {
  const building: MapBuilding = {
    id: "w1",
    name: "Edificio Test",
    type: "yes",
    category: "university",
    height: 14,
    heightSource: "default",
    baseMin: 0,
    baseMax: 0,
    footprint: [
      [0, 0],
      [40, 0],
      [40, -30],
      [0, -30],
    ],
  };
  const roads: MapRoad[] = [
    {
      id: "w2",
      class: "footway",
      width: 2.2,
      lanes: 0,
      oneway: false,
      surface: "paving_stones",
      sidewalkOffset: 0,
      points: [
        [-40, 8],
        [80, 8],
      ],
    },
    {
      id: "w3",
      class: "residential",
      width: 6.5,
      lanes: 2,
      oneway: false,
      surface: "asphalt",
      sidewalkOffset: 0,
      points: [
        [-40, 25],
        [80, 25],
      ],
    },
  ];
  const spawns = generateSpawns({
    buildings: [building],
    roads,
    buildingIndex: createBuildingIndex([building]),
    roadIndex: createRoadIndex(roads),
    perBuilding: 3,
    minSpacing: 10,
  });

  it("places spawns on the walkway next to the building, outside its footprint", () => {
    expect(spawns.length).toBe(3);
    for (const s of spawns) {
      expect(pointInPolygon(s.x, s.z, building.footprint)).toBe(false);
      expect(s.z).toBeCloseTo(8, 0);
      expect(s.near).toBe("Edificio Test");
    }
  });

  it("keeps spawns apart and faces them towards the nearest street (south, yaw ≈ 0)", () => {
    for (let i = 0; i < spawns.length; i++) {
      expect(Math.abs(spawns[i].yaw)).toBeLessThan(0.05);
      for (let j = i + 1; j < spawns.length; j++) {
        expect(Math.hypot(spawns[i].x - spawns[j].x, spawns[i].z - spawns[j].z)).toBeGreaterThanOrEqual(10);
      }
    }
  });
});
