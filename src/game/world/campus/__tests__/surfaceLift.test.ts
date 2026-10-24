import { describe, expect, it } from "vitest";
import { createSurfaceLift } from "../surfaceLift";
import { KERB_DROP, KERB_RAMP, LIFT } from "../roadLevels";
import type { MapRoad, Vec2 } from "../../../map/types";

function road(cls: MapRoad["class"], points: Vec2[], width: number, extra: Partial<MapRoad> = {}): MapRoad {
  return { id: "w1", class: cls, width, lanes: 2, oneway: false, surface: "asphalt", sidewalkOffset: 0, points, ...extra };
}

// A street along X (8 m carriageway, sidewalks 4..8 m either side), a zebra
// crossing it at x = 0, and a separate footway path.
const street = road("residential", [[-100, 0], [100, 0]], 8, { sidewalkOffset: 6 });
const crossing = road("footway", [[0, -12], [0, 12]], 4, { footway: "crossing", lanes: 0 });
const path = road("footway", [[-50, 40], [50, 40]], 2, { lanes: 0 });
const lift = createSurfaceLift([street, crossing, path]);

describe("createSurfaceLift", () => {
  it("is the carriageway height on the road", () => {
    expect(lift(30, 0)).toBeCloseTo(LIFT.road, 9);
    expect(lift(30, -3.9)).toBeCloseTo(LIFT.road, 9);
  });

  it("steps up to the kerb top on the sidewalk band (a kerb)", () => {
    expect(lift(30, 4.2)).toBeCloseTo(LIFT.kerbTop, 9);
    expect(lift(30, -7.5)).toBeCloseTo(LIFT.kerbTop, 9);
  });

  it("is the bare terrain beyond the sidewalk", () => {
    expect(lift(30, 9)).toBe(0);
  });

  it("dips the sidewalk to road level at the crossing (dropped kerb) with ramps either side", () => {
    expect(lift(0, 5)).toBeCloseTo(LIFT.kerbTop - KERB_DROP, 9);
    // Half-way down the ramp.
    expect(lift(2 + KERB_RAMP / 2, 5)).toBeCloseTo(LIFT.kerbTop - KERB_DROP / 2, 9);
    expect(lift(2 + KERB_RAMP + 0.5, 5)).toBeCloseTo(LIFT.kerbTop, 9);
  });

  it("puts zebra paint above the asphalt where the crossing covers the carriageway", () => {
    expect(lift(0.5, 1)).toBeCloseTo(LIFT.crossing, 9);
  });

  it("raises footways by the paving height", () => {
    expect(lift(10, 40.5)).toBeCloseTo(LIFT.footway, 9);
    expect(lift(10, 42)).toBe(0);
  });

  it("ignores tunnels and bridge sidewalks", () => {
    const t = createSurfaceLift([road("primary", [[0, 0], [50, 0]], 8, { tunnel: true, sidewalkOffset: 6 })]);
    expect(t(10, 0)).toBe(0);
    const b = createSurfaceLift([road("primary", [[0, 0], [50, 0]], 8, { bridge: true, sidewalkOffset: 6 })]);
    expect(b(10, 0)).toBeCloseTo(LIFT.road, 9);
    expect(b(10, 5)).toBe(0);
  });

  it("is 0 far from everything and for an empty map", () => {
    expect(lift(500, 500)).toBe(0);
    expect(createSurfaceLift([])(0, 0)).toBe(0);
  });
});
