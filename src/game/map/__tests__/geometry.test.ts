import { describe, expect, it } from "vitest";
import type { Ring } from "../types";
import {
  ensureCCW,
  pointInPolygon,
  pointToSegment,
  polygonArea,
  polygonCentroid,
  polylineLength,
  signedArea,
  simplifyRing,
} from "../geometry";

// A 10 x 10 square drawn counter-clockwise as seen from above with north up:
// east (+x) -> north (-z) -> west -> south.
const ccwSquare: Ring = [
  [0, 0],
  [10, 0],
  [10, -10],
  [0, -10],
];

describe("polygon orientation and area", () => {
  it("reports positive signed area for CCW-from-above rings", () => {
    expect(signedArea(ccwSquare)).toBeCloseTo(100);
    expect(signedArea([...ccwSquare].reverse())).toBeCloseTo(-100);
  });

  it("polygonArea is orientation independent", () => {
    expect(polygonArea(ccwSquare)).toBeCloseTo(100);
    expect(polygonArea([...ccwSquare].reverse())).toBeCloseTo(100);
  });

  it("ensureCCW flips clockwise rings and keeps CCW ones", () => {
    expect(signedArea(ensureCCW([...ccwSquare].reverse()))).toBeGreaterThan(0);
    expect(ensureCCW(ccwSquare)).toEqual(ccwSquare);
  });

  it("computes the area centroid of an L shape", () => {
    // 2x1 rectangle + 1x1 square on top of its left half.
    const l: Ring = [
      [0, 0],
      [2, 0],
      [2, -1],
      [1, -1],
      [1, -2],
      [0, -2],
    ];
    const [cx, cz] = polygonCentroid(l);
    // Union of A1 (2x1, centroid (1,-0.5)) and A2 (1x1, centroid (0.5,-1.5)).
    expect(cx).toBeCloseTo((2 * 1 + 1 * 0.5) / 3);
    expect(cz).toBeCloseTo((2 * -0.5 + 1 * -1.5) / 3);
  });
});

describe("pointInPolygon", () => {
  it("detects inside and outside points", () => {
    expect(pointInPolygon(5, -5, ccwSquare)).toBe(true);
    expect(pointInPolygon(15, -5, ccwSquare)).toBe(false);
    expect(pointInPolygon(5, 5, ccwSquare)).toBe(false);
  });

  it("handles concave polygons", () => {
    const u: Ring = [
      [0, 0],
      [3, 0],
      [3, -3],
      [2, -3],
      [2, -1],
      [1, -1],
      [1, -3],
      [0, -3],
    ];
    expect(pointInPolygon(1.5, -2, u)).toBe(false); // inside the notch
    expect(pointInPolygon(0.5, -2, u)).toBe(true);
  });
});

describe("segments and polylines", () => {
  it("projects a point onto a segment and clamps to its ends", () => {
    const mid = pointToSegment(5, 3, 0, 0, 10, 0);
    expect(mid.distance).toBeCloseTo(3);
    expect(mid.t).toBeCloseTo(0.5);
    expect(mid.x).toBeCloseTo(5);
    const beyond = pointToSegment(14, 3, 0, 0, 10, 0);
    expect(beyond.t).toBe(1);
    expect(beyond.distance).toBeCloseTo(5);
  });

  it("handles zero-length segments", () => {
    const r = pointToSegment(3, 4, 0, 0, 0, 0);
    expect(r.distance).toBeCloseTo(5);
    expect(r.t).toBe(0);
  });

  it("measures polyline length", () => {
    expect(
      polylineLength([
        [0, 0],
        [3, 4],
        [3, 10],
      ]),
    ).toBeCloseTo(11);
  });
});

describe("simplifyRing", () => {
  it("removes collinear and duplicate points", () => {
    const ring: Ring = [
      [0, 0],
      [5, 0],
      [5, 0],
      [10, 0.02],
      [10, -10],
      [5, -10],
      [0, -10],
      [0, -5],
    ];
    expect(simplifyRing(ring, 0.1)).toEqual([
      [0, 0],
      [10, 0.02],
      [10, -10],
      [0, -10],
    ]);
  });

  it("keeps real corners", () => {
    expect(simplifyRing(ccwSquare, 0.1)).toEqual(ccwSquare);
  });
});
