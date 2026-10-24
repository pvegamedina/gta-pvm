import { describe, it, expect } from "vitest";
import { createSurface, DECK_MIN_CLEARANCE } from "../surface";
import type { MapRoad, Vec2 } from "../../../map/types";

function road(points: Vec2[], extra: Partial<MapRoad> = {}): MapRoad {
  return { id: "w", class: "motorway", width: 11, lanes: 2, oneway: true, surface: "asphalt", sidewalkOffset: 0, points, ...extra };
}

// A valley 8 m deep around x = 50 between two 10 m embankments.
const terrain = (x: number) => 10 - 8 * Math.exp(-((x - 50) ** 2) / 200);
const bridge = road(
  [
    [0, 0],
    [100, 0],
  ],
  { bridge: true, layer: 1 },
);
const ground = road([
  [0, 30],
  [100, 30],
]);
const s = createSurface(terrain, [ground, bridge]);

describe("createSurface", () => {
  it("is the terrain away from bridges", () => {
    expect(s.height(50, 30)).toBeCloseTo(terrain(50), 6);
    expect(s.height(50, 10)).toBeCloseTo(terrain(50), 6);
  });

  it("spans bridge decks straight between their (embankment) ends", () => {
    expect(s.height(50, 0)).toBeCloseTo(10 - 8 * Math.exp(-2500 / 200), 1);
    expect(s.height(50, 4)).toBeCloseTo(s.height(50, 0), 6); // across the deck width
  });

  it("never lets a deck dip into the terrain", () => {
    const hump = (x: number) => 2 + 6 * Math.exp(-((x - 50) ** 2) / 100);
    const s2 = createSurface(hump, [bridge]);
    expect(s2.height(50, 0)).toBeGreaterThanOrEqual(hump(50) + DECK_MIN_CLEARANCE - 1e-6);
  });

  it("keeps things that are below a deck on the ground underneath (underpasses)", () => {
    expect(s.height(50, 0, terrain(50) + 0.5)).toBeCloseTo(terrain(50), 6);
    expect(s.height(50, 0, 9.9)).toBeCloseTo(s.height(50, 0), 6);
  });

  it("exposes each bridge deck's profile for rendering", () => {
    const decks = s.decks;
    expect(decks).toHaveLength(1);
    expect(decks[0].road).toBe(1);
    const prof = decks[0];
    expect(prof.deckAt(0)).toBeCloseTo(terrain(0), 6);
    expect(prof.deckAt(100)).toBeCloseTo(terrain(100), 6);
    expect(prof.deckAt(50)).toBeGreaterThan(terrain(50) + 5);
  });
});

describe("chained bridge pieces", () => {
  it("treats consecutive bridge ways as one deck (no dip at the joint in the valley)", () => {
    const a = road([[0, 0], [50, 0]], { bridge: true });
    // Second piece drawn the other way round.
    const b = road([[100, 0], [50, 0]], { bridge: true });
    const s3 = createSurface(terrain, [a, b]);
    expect(s3.height(50, 0)).toBeGreaterThan(9.5);
    expect(s3.height(25, 0)).toBeGreaterThan(9.5);
    expect(s3.height(75, 0)).toBeGreaterThan(9.5);
  });
});
