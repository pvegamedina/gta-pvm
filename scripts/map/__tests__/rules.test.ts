import { landuseDetails } from "../landuse";
import { describe, expect, it } from "vitest";
import { buildingCategory, buildingHeight } from "../buildings";
import { roadAttributes } from "../roads";
import { hash01, hash32 } from "../hash";

describe("stable hash", () => {
  it("is deterministic and spreads nearby inputs", () => {
    expect(hash32(1, 2, 3)).toBe(hash32(1, 2, 3));
    expect(hash32(1, 2, 3)).not.toBe(hash32(1, 2, 4));
    const v = hash01(123, -456);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });

  it("is roughly uniform", () => {
    let below = 0;
    for (let i = 0; i < 2000; i++) if (hash01(i, 7) < 0.5) below++;
    expect(below).toBeGreaterThan(900);
    expect(below).toBeLessThan(1100);
  });
});

describe("buildingHeight", () => {
  it("prefers an explicit height tag", () => {
    expect(buildingHeight({ building: "yes", height: "12.5", "building:levels": "2" }, "university", 0)).toEqual({
      height: 12.5,
      source: "height",
      levels: 2,
    });
    expect(buildingHeight({ building: "yes", height: "9 m" }, "other", 0).height).toBe(9);
  });

  it("falls back to levels × 3.2 m", () => {
    expect(buildingHeight({ building: "yes", "building:levels": "4" }, "university", 0)).toEqual({
      height: 12.8,
      source: "levels",
      levels: 4,
    });
  });

  it("ignores nonsense tags", () => {
    expect(buildingHeight({ building: "yes", height: "tall", "building:levels": "-1" }, "other", 0)).toEqual({
      height: 8,
      source: "default",
    });
  });

  it("uses per-category defaults", () => {
    const d = (category: Parameters<typeof buildingHeight>[1], seed = 0) =>
      buildingHeight({ building: "yes" }, category, seed).height;
    expect(d("university")).toBe(14);
    expect(d("retail")).toBe(7);
    expect(d("sports")).toBe(12);
    expect(d("residential")).toBe(9);
    expect(d("other")).toBe(8);
    for (let seed = 0; seed < 20; seed++) {
      const h = d("house", seed);
      expect(h).toBeGreaterThanOrEqual(7);
      expect(h).toBeLessThanOrEqual(9);
    }
  });
});

describe("buildingCategory", () => {
  it("recognises university buildings by tag or by location in the campus", () => {
    expect(buildingCategory({ building: "university" }, false)).toBe("university");
    expect(buildingCategory({ building: "yes", amenity: "library" }, false)).toBe("university");
    expect(buildingCategory({ building: "yes" }, true)).toBe("university");
    expect(buildingCategory({ building: "yes" }, false)).toBe("other");
  });

  it("recognises sports halls, retail, homes and roofs", () => {
    expect(buildingCategory({ building: "yes", leisure: "sports_centre", amenity: "university" }, true)).toBe("sports");
    expect(buildingCategory({ building: "yes", name: "Palacio de Deportes" }, false)).toBe("sports");
    expect(buildingCategory({ building: "retail" }, false)).toBe("retail");
    expect(buildingCategory({ building: "yes", amenity: "fast_food" }, false)).toBe("retail");
    expect(buildingCategory({ building: "house" }, false)).toBe("house");
    expect(buildingCategory({ building: "apartments" }, false)).toBe("residential");
    expect(buildingCategory({ building: "roof" }, true)).toBe("roof");
    expect(buildingCategory({ building: "yes", amenity: "kindergarten" }, true)).toBe("school");
  });
});

describe("roadAttributes", () => {
  it("returns null for non-road ways", () => {
    expect(roadAttributes({ building: "yes" })).toBeNull();
    expect(roadAttributes({ highway: "bus_stop" })).toBeNull();
  });

  it("assigns widths by class", () => {
    const w = (highway: string) => roadAttributes({ highway })!.width;
    expect(w("motorway")).toBe(11);
    expect(w("motorway_link")).toBe(6);
    expect(w("primary")).toBe(10);
    expect(w("secondary")).toBe(9);
    expect(w("tertiary")).toBe(8);
    expect(w("residential")).toBe(6.5);
    expect(w("service")).toBe(4.5);
    expect(w("pedestrian")).toBe(5);
    expect(w("footway")).toBe(2.2);
    expect(w("cycleway")).toBe(2.5);
    expect(w("steps")).toBe(2);
  });

  it("honours a numeric width tag and parses lanes", () => {
    expect(roadAttributes({ highway: "footway", width: "5" })!.width).toBe(5);
    expect(roadAttributes({ highway: "footway", width: "wide" })!.width).toBe(2.2);
    expect(roadAttributes({ highway: "primary", lanes: "4" })!.lanes).toBe(4);
    expect(roadAttributes({ highway: "primary" })!.lanes).toBe(2);
    expect(roadAttributes({ highway: "footway" })!.lanes).toBe(0);
  });

  it("derives one-way travel", () => {
    expect(roadAttributes({ highway: "residential" })!.oneway).toBe(false);
    expect(roadAttributes({ highway: "residential", oneway: "yes" })).toMatchObject({ oneway: true, reverse: false });
    expect(roadAttributes({ highway: "residential", oneway: "-1" })).toMatchObject({ oneway: true, reverse: true });
    expect(roadAttributes({ highway: "motorway" })!.oneway).toBe(true);
    expect(roadAttributes({ highway: "motorway_link" })!.oneway).toBe(true);
    expect(roadAttributes({ highway: "motorway", oneway: "no" })!.oneway).toBe(false);
    expect(roadAttributes({ highway: "tertiary", junction: "roundabout" })!.oneway).toBe(true);
    // Footways are never one-way for cars (they are not in the car graph).
    expect(roadAttributes({ highway: "footway", oneway: "yes" })!.oneway).toBe(false);
  });

  it("flags drivable classes, defaults surfaces and adds sidewalks to urban roads", () => {
    expect(roadAttributes({ highway: "residential" })).toMatchObject({ drivable: true, surface: "asphalt" });
    expect(roadAttributes({ highway: "footway" })).toMatchObject({ drivable: false, walkable: true, surface: "paving_stones" });
    expect(roadAttributes({ highway: "residential", surface: "concrete" })!.surface).toBe("concrete");
    expect(roadAttributes({ highway: "residential" })!.sidewalkOffset).toBeCloseTo(6.5 / 2 + 1.5);
    expect(roadAttributes({ highway: "secondary" })!.sidewalkOffset).toBeGreaterThan(0);
    expect(roadAttributes({ highway: "motorway" })!.sidewalkOffset).toBe(0);
    expect(roadAttributes({ highway: "residential", sidewalk: "no" })!.sidewalkOffset).toBe(0);
    expect(roadAttributes({ highway: "footway" })!.sidewalkOffset).toBe(0);
  });
});

describe("landuseDetails", () => {
  it("keeps the surface and sport of pitches and tracks", () => {
    expect(landuseDetails({ leisure: "pitch", sport: "tennis", surface: "clay" })).toEqual({ sport: "tennis", surface: "clay" });
    expect(landuseDetails({ leisure: "track", surface: "tartan" })).toEqual({ surface: "tartan" });
  });

  it("flags tracks mapped as lines around an area (area=no)", () => {
    expect(landuseDetails({ leisure: "track", area: "no", surface: "paved" })).toEqual({ surface: "paved", linear: true });
  });

  it("adds nothing for plain areas", () => {
    expect(landuseDetails({ leisure: "park" })).toEqual({});
  });
});
