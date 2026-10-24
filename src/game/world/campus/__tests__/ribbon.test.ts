import { describe, it, expect } from "vitest";
import { resamplePolyline, offsetPolyline, trimPolyline, buildRibbon, buildWallStrip, buildDisc, type RibbonArrays } from "../ribbon";
import type { Vec2 } from "../../../map/types";

const flat = () => 0;

/** y component of the face normal of triangle f. */
function faceNy(a: RibbonArrays, f: number): number {
  const p = a.positions;
  const [i, j, k] = [a.indices[f] * 3, a.indices[f + 1] * 3, a.indices[f + 2] * 3];
  const ux = p[j] - p[i];
  const uz = p[j + 2] - p[i + 2];
  const vx = p[k] - p[i];
  const vz = p[k + 2] - p[i + 2];
  return uz * vx - ux * vz;
}

describe("resamplePolyline", () => {
  it("keeps the original vertices and inserts points so no segment exceeds the max length", () => {
    const pts: Vec2[] = [
      [0, 0],
      [10, 0],
      [10, 3],
    ];
    const out = resamplePolyline(pts, 4);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([10, 3]);
    expect(out).toContainEqual([10, 0]);
    for (let i = 1; i < out.length; i++) {
      expect(Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1])).toBeLessThanOrEqual(4 + 1e-9);
    }
    expect(out.length).toBe(5); // 0, 3.33, 6.67, 10 | 10,3
  });
});

describe("offsetPolyline", () => {
  it("offsets to the RIGHT of the travel direction for positive distances (x east, z south)", () => {
    // Travelling north (-z): the right-hand side is east (+x).
    const out = offsetPolyline(
      [
        [0, 10],
        [0, 0],
      ],
      2,
    );
    expect(out[0][0]).toBeCloseTo(2, 9);
    expect(out[1][0]).toBeCloseTo(2, 9);
  });

  it("uses mitred joins so the offset line stays parallel on both legs of a corner", () => {
    // East then south: a right-hand turn; the right offset is the inner side.
    const out = offsetPolyline(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      -1,
    );
    // Left side (outer corner) of the turn sits at (11, -1).
    expect(out[1][0]).toBeCloseTo(11, 9);
    expect(out[1][1]).toBeCloseTo(-1, 9);
  });

  it("clamps the mitre on hairpins instead of shooting off to infinity", () => {
    const out = offsetPolyline(
      [
        [0, 0],
        [10, 0],
        [0, 0.1],
      ],
      1,
    );
    const d = Math.hypot(out[1][0] - 10, out[1][1]);
    expect(d).toBeLessThanOrEqual(2.5 + 1e-9);
  });
});

describe("trimPolyline", () => {
  const line: Vec2[] = [
    [0, 0],
    [10, 0],
    [10, 10],
  ];
  it("cuts the requested length off both ends", () => {
    const out = trimPolyline(line, 2, 3);
    expect(out[0]).toEqual([2, 0]);
    expect(out[out.length - 1][0]).toBeCloseTo(10, 9);
    expect(out[out.length - 1][1]).toBeCloseTo(7, 9);
    expect(out).toContainEqual([10, 0]);
  });

  it("collapses to the midpoint region when the trims exceed the length", () => {
    const out = trimPolyline(line, 15, 15);
    expect(out.length).toBe(2);
  });
});

describe("buildRibbon", () => {
  const pts: Vec2[] = [
    [0, 0],
    [0, -12],
  ];

  it("spans from the left to the right offset with the requested lateral subdivisions", () => {
    const a = buildRibbon(pts, { left: -3, right: 3, across: 2, maxSegment: 4, height: flat, lift: 0.05 });
    // 4 rows (0, 4, 8, 12 m) x 3 columns.
    expect(a.positions.length / 3).toBe(12);
    expect(a.indices.length).toBe(3 * 2 * 6);
    const xs = new Set<number>();
    for (let i = 0; i < a.positions.length; i += 3) xs.add(Math.round(a.positions[i] * 1000) / 1000);
    expect([...xs].sort((p, q) => p - q)).toEqual([-3, 0, 3]);
  });

  it("drapes every vertex on the height function plus the lift", () => {
    const h = (x: number, z: number) => 0.1 * x - 0.2 * z;
    const a = buildRibbon(pts, { left: -2, right: 2, across: 1, maxSegment: 3, height: h, lift: 0.07 });
    for (let i = 0; i < a.positions.length; i += 3) {
      expect(a.positions[i + 1]).toBeCloseTo(h(a.positions[i], a.positions[i + 2]) + 0.07, 6);
    }
  });

  it("passes the distance along the polyline to the height function (bridge decks)", () => {
    const a = buildRibbon(pts, { left: -1, right: 1, across: 1, maxSegment: 6, height: (_x, _z, s) => s, lift: 0 });
    const ys = new Set<number>();
    for (let i = 1; i < a.positions.length; i += 3) ys.add(a.positions[i]);
    expect([...ys].sort((p, q) => p - q)).toEqual([0, 6, 12]);
  });

  it("faces up and maps u across the width and v along the length", () => {
    const a = buildRibbon(pts, { left: -3, right: 3, across: 1, maxSegment: 12, height: flat, lift: 0, vScale: 6 });
    for (let f = 0; f < a.indices.length; f += 3) expect(faceNy(a, f)).toBeGreaterThan(0);
    // Row 0 left/right, row 1 left/right.
    expect(Array.from(a.uvs)).toEqual([0, 0, 1, 0, 0, 2, 1, 2]);
  });
});

describe("buildWallStrip", () => {
  it("builds a vertical strip between two lifts along the offset line, facing away from the road centre", () => {
    const a = buildWallStrip(
      [
        [0, 0],
        [0, -10],
      ],
      { offset: 3, height: flat, y0: 0.05, y1: 0.17, maxSegment: 10, facing: -1 },
    );
    expect(a.positions.length / 3).toBe(4);
    for (let i = 0; i < a.positions.length; i += 3) expect(a.positions[i]).toBeCloseTo(3, 9);
    // Facing -1 = towards the road centre (-x here).
    for (let i = 0; i < a.normals.length; i += 3) expect(a.normals[i]).toBeCloseTo(-1, 9);
  });

  for (const facing of [1, -1] as const) {
    it(`winds its faces towards the facing side (${facing})`, () => {
      const a = buildWallStrip(
        [
          [0, 0],
          [0, -10],
        ],
        { offset: 3, height: flat, y0: 0, y1: 1, maxSegment: 10, facing },
      );
      const p = a.positions;
      for (let f = 0; f < a.indices.length; f += 3) {
        const [i, j, k] = [a.indices[f] * 3, a.indices[f + 1] * 3, a.indices[f + 2] * 3];
        const u = [p[j] - p[i], p[j + 1] - p[i + 1], p[j + 2] - p[i + 2]];
        const v = [p[k] - p[i], p[k + 1] - p[i + 1], p[k + 2] - p[i + 2]];
        const nx = u[1] * v[2] - u[2] * v[1];
        // Travelling north, the right-hand side is +x.
        expect(Math.sign(nx)).toBe(facing);
      }
    });
  }
});

describe("buildDisc", () => {
  it("fans a draped, upward-facing disc around the centre", () => {
    const a = buildDisc(5, 5, 4, 12, (x) => x * 0.1, 0.03);
    expect(a.positions.length / 3).toBe(13);
    expect(a.positions[1]).toBeCloseTo(0.53, 6);
    for (let f = 0; f < a.indices.length; f += 3) expect(faceNy(a, f)).toBeGreaterThan(0);
  });
});
