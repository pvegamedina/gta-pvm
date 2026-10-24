import { describe, it, expect } from "vitest";
import { approachLayout, cornerCurve, insertStations, kerbDrop, polylineCrossings, type Arm } from "../roadDetail";
import type { Vec2 } from "../../../map/types";

describe("polylineCrossings", () => {
  it("returns the arc length along the first polyline where the second crosses it", () => {
    const road: Vec2[] = [
      [0, 0],
      [10, 0],
      [20, 0],
    ];
    const crossing: Vec2[] = [
      [14, -5],
      [14, 5],
    ];
    expect(polylineCrossings(road, crossing)).toEqual([14]);
  });

  it("finds several crossings, sorted, and ignores lines that do not meet", () => {
    const road: Vec2[] = [
      [0, 0],
      [20, 0],
    ];
    const zig: Vec2[] = [
      [15, -2],
      [12, 2],
      [5, -2],
    ];
    const s = polylineCrossings(road, zig);
    expect(s.length).toBe(2);
    expect(s[0]).toBeCloseTo(8.5, 9);
    expect(s[1]).toBeCloseTo(13.5, 9);
    expect(polylineCrossings(road, [[0, 3], [20, 3]])).toEqual([]);
  });
});

describe("kerbDrop", () => {
  const drops = [{ s: 10, half: 1.5 }];
  it("lowers the kerb fully across the crossing and ramps back up", () => {
    expect(kerbDrop(10, drops, 0.1, 1)).toBeCloseTo(0.1, 9);
    expect(kerbDrop(11.5, drops, 0.1, 1)).toBeCloseTo(0.1, 9);
    expect(kerbDrop(12, drops, 0.1, 1)).toBeCloseTo(0.05, 9);
    expect(kerbDrop(12.5, drops, 0.1, 1)).toBeCloseTo(0, 9);
    expect(kerbDrop(30, drops, 0.1, 1)).toBe(0);
    expect(kerbDrop(10, [], 0.1, 1)).toBe(0);
  });
});

describe("cornerCurve", () => {
  // Junction at the origin: arm A goes east (+x), arm B goes south (+z), both 8 m wide, trimmed 5 m out.
  const A: Arm = { end: [5, 0], dir: [1, 0], half: 4 };
  const B: Arm = { end: [0, 5], dir: [0, 1], half: 4 };

  it("joins the two kerb lines with a curve tangent to both", () => {
    const c = cornerCurve([0, 0], A, B)!;
    expect(c).not.toBeNull();
    const first = c.points[0];
    const last = c.points[c.points.length - 1];
    // A's kerb facing B is its +z side (z = 4); B's facing A is its +x side (x = 4).
    expect(first[0]).toBeCloseTo(5, 9);
    expect(first[1]).toBeCloseTo(4, 9);
    expect(last[0]).toBeCloseTo(4, 9);
    expect(last[1]).toBeCloseTo(5, 9);
    // Leaves A heading back towards the junction (-x), arrives on B heading out (+z).
    const d0 = [c.points[1][0] - first[0], c.points[1][1] - first[1]];
    const d1 = [last[0] - c.points[c.points.length - 2][0], last[1] - c.points[c.points.length - 2][1]];
    expect(d0[0]).toBeLessThan(0);
    expect(Math.abs(d0[1])).toBeLessThan(Math.abs(d0[0]) * 0.2);
    expect(d1[1]).toBeGreaterThan(0);
    expect(Math.abs(d1[0])).toBeLessThan(Math.abs(d1[1]) * 0.2);
    // The curve stays inside the corner square (never crosses into the carriageways).
    for (const [x, z] of c.points) {
      expect(x).toBeGreaterThan(3.99);
      expect(z).toBeGreaterThan(3.99);
    }
    // Sidewalk side: away from the junction centre.
    const mid = c.points[Math.floor(c.points.length / 2)];
    const i = Math.floor(c.points.length / 2);
    const tx = c.points[i + 1][0] - c.points[i - 1][0];
    const tz = c.points[i + 1][1] - c.points[i - 1][1];
    const right = [-tz, tx];
    expect(Math.sign(right[0] * mid[0] + right[1] * mid[1])).toBe(c.outward);
  });

  it("works whichever arm comes first", () => {
    const c = cornerCurve([0, 0], B, A)!;
    expect(c.points[0][0]).toBeCloseTo(4, 9);
    expect(c.points[0][1]).toBeCloseTo(5, 9);
  });

  it("skips (nearly) straight continuations and very sharp gores", () => {
    const W: Arm = { end: [-5, 0], dir: [-1, 0], half: 4 };
    expect(cornerCurve([0, 0], A, W)).toBeNull();
    const sharp: Arm = { end: [5, 0.8], dir: [Math.cos(0.15), Math.sin(0.15)], half: 4 };
    expect(cornerCurve([0, 0], A, sharp)).toBeNull();
  });
});

describe("approachLayout", () => {
  // Approach heading north (-z) to a junction; lane end at the origin; 9 m two-way road, 1 lane each way.
  const base = { end: [0, 0] as Vec2, dir: [0, -1] as Vec2, width: 9, lanes: 1, oneway: false };

  it("generates a stop line, a zebra between it and the junction, and a solid centre line", () => {
    const a = approachLayout({ ...base, crossingBehind: null });
    expect(a.zebra).not.toBeNull();
    expect(a.setback).toBeGreaterThan(3.5);
    // Stop line across the right half (two-way): lateral 0 .. +4.5, behind the lane end (+z).
    expect(a.stopLine.lo).toBeCloseTo(0, 9);
    expect(a.stopLine.hi).toBeCloseTo(4.5, 9);
    expect(a.stopLine.centre[1]).toBeCloseTo(a.setback, 9);
    // The zebra sits between the stop line and the junction.
    expect(a.zebra!.centre[1]).toBeLessThan(a.setback);
    expect(a.zebra!.centre[1]).toBeGreaterThan(0);
    expect(a.solidCentre).not.toBeNull();
    expect(a.arrows.length).toBe(0);
  });

  it("stops before an existing (mapped) crossing instead of drawing a new one", () => {
    const a = approachLayout({ ...base, crossingBehind: { distance: 3, half: 1.5 } });
    expect(a.zebra).toBeNull();
    expect(a.setback).toBeCloseTo(3 + 1.5 + 0.8, 9);
  });

  it("spans the whole carriageway on one-way roads and puts an arrow in every lane", () => {
    const a = approachLayout({ ...base, oneway: true, lanes: 3, crossingBehind: null });
    expect(a.stopLine.lo).toBeCloseTo(-4.5, 9);
    expect(a.stopLine.hi).toBeCloseTo(4.5, 9);
    expect(a.solidCentre).toBeNull();
    expect(a.arrows.length).toBe(3);
    for (const ar of a.arrows) {
      // Behind the stop line, pointing along the travel direction (yaw of (0, -1) = pi).
      expect(ar.z).toBeGreaterThan(a.setback);
      expect(Math.abs(Math.abs(ar.yaw) - Math.PI)).toBeLessThan(1e-9);
    }
  });
});

describe("insertStations", () => {
  it("adds vertices at the given arc lengths and keeps the originals", () => {
    const line: Vec2[] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];
    const out = insertStations(line, [2.5, 10, 12, -1, 40]);
    expect(out).toEqual([
      [0, 0],
      [2.5, 0],
      [10, 0],
      [10, 2],
      [10, 10],
    ]);
  });
});
