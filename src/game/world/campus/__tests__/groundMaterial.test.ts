import { describe, expect, it } from "vitest";
import { createGroundClassifier, osmSurfaceKind } from "../groundMaterial";
import type { MapLanduse, MapRoad, Vec2 } from "../../../map/types";

function road(cls: MapRoad["class"], points: Vec2[], width: number, extra: Partial<MapRoad> = {}): MapRoad {
  return { id: "w1", class: cls, width, lanes: 2, oneway: false, surface: "asphalt", sidewalkOffset: 0, points, ...extra };
}

function area(kind: MapLanduse["kind"], ring: Vec2[], extra: Partial<MapLanduse> = {}): MapLanduse {
  return { kind, area: 0, points: ring, ...extra };
}

const square = (x0: number, z0: number, s: number): Vec2[] => [
  [x0, z0],
  [x0 + s, z0],
  [x0 + s, z0 + s],
  [x0, z0 + s],
];

describe("osmSurfaceKind", () => {
  it("maps OSM surface tags to footstep surfaces", () => {
    expect(osmSurfaceKind("asphalt")).toBe("asphalt");
    expect(osmSurfaceKind("paving_stones")).toBe("pavement");
    expect(osmSurfaceKind("concrete")).toBe("pavement");
    expect(osmSurfaceKind("compacted")).toBe("gravel");
    expect(osmSurfaceKind("gravel")).toBe("gravel");
    expect(osmSurfaceKind("grass")).toBe("grass");
    expect(osmSurfaceKind("")).toBeNull();
    expect(osmSurfaceKind("weird")).toBeNull();
  });
});

describe("createGroundClassifier", () => {
  // An east-west street (8 m wide) with sidewalks centred 5.5 m off its axis (3 m wide each).
  const street = road("residential", [[-100, 0], [100, 0]], 8, { sidewalkOffset: 5.5 });
  const footway = road("footway", [[0, 40], [0, 80]], 2, { surface: "paving_stones", lanes: 0 });
  const track = road("track", [[50, 40], [50, 80]], 3, { surface: "compacted", lanes: 0 });
  const park = area("park", square(-60, 20, 50));
  const pitch = area("pitch", square(-50, 30, 10), { surface: "concrete" });
  const parking = area("parking", square(60, -60, 20));
  const classify = createGroundClassifier([street, footway, track], [park, pitch, parking]);

  it("is asphalt on a drivable carriageway", () => {
    expect(classify(10, 0)).toBe("asphalt");
    expect(classify(10, 3.9)).toBe("asphalt");
  });

  it("is pavement on the sidewalk band beside a street", () => {
    expect(classify(10, 5)).toBe("pavement");
    expect(classify(10, -6.5)).toBe("pavement");
  });

  it("uses the footway's OSM surface", () => {
    expect(classify(0.5, 60)).toBe("pavement");
    expect(classify(50.5, 60)).toBe("gravel");
  });

  it("uses landuse off the roads, the smallest containing area winning", () => {
    expect(classify(-20, 60)).toBe("grass");
    expect(classify(-45, 35)).toBe("pavement");
    expect(classify(70, -50)).toBe("asphalt");
  });

  it("defaults to grass on open ground", () => {
    expect(classify(300, 300)).toBe("grass");
  });
});
