import { describe, it, expect } from "vitest";
import { extrudeWalls, buildRoof, insetRing, buildParapet, triangulateRing } from "../extrude";
import type { RibbonArrays } from "../ribbon";
import type { Ring } from "../../../map/types";
import { signedArea } from "../../../map/geometry";

// CCW from above (x east, z south): west edge first, going south.
const square: Ring = [
  [0, 0],
  [0, 10],
  [10, 10],
  [10, 0],
];
const ell: Ring = [
  [0, 0],
  [0, 10],
  [5, 10],
  [5, 5],
  [10, 5],
  [10, 0],
];

function faceNormal(a: RibbonArrays, f: number): [number, number, number] {
  const p = a.positions;
  const [i, j, k] = [a.indices[f] * 3, a.indices[f + 1] * 3, a.indices[f + 2] * 3];
  const u = [p[j] - p[i], p[j + 1] - p[i + 1], p[j + 2] - p[i + 2]];
  const v = [p[k] - p[i], p[k + 1] - p[i + 1], p[k + 2] - p[i + 2]];
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}

describe("fixtures", () => {
  it("are counter-clockwise from above", () => {
    expect(signedArea(square)).toBeGreaterThan(0);
    expect(signedArea(ell)).toBeGreaterThan(0);
  });
});

describe("extrudeWalls", () => {
  const w = extrudeWalls(square, 2, 14.8, { bayWidth: 4, floorHeight: 3.2, vBase: 2 });

  it("emits one flat-shaded quad per edge", () => {
    expect(w.positions.length / 3).toBe(16);
    expect(w.indices.length).toBe(24);
  });

  it("faces every wall outwards", () => {
    for (let f = 0; f < w.indices.length; f += 3) {
      const n = faceNormal(w, f);
      const i = w.indices[f] * 3;
      // Outward = away from the centre (5, 5).
      const cx = w.positions[i] - 5;
      const cz = w.positions[i + 2] - 5;
      expect(n[0] * cx + n[2] * cz).toBeGreaterThan(0);
      expect(Math.abs(n[1])).toBeLessThan(1e-9);
    }
    // Stored normals agree: the first (west) wall faces -x.
    expect([w.normals[0], w.normals[1], w.normals[2]]).toEqual([-1, 0, 0]);
  });

  it("tiles u by the bay width continuously around the perimeter and v by the floor height", () => {
    // Edge k occupies vertices 4k..4k+3: (start bottom, end bottom, start top, end top).
    for (let e = 0; e < 4; e++) {
      expect(w.uvs[(4 * e) * 2]).toBeCloseTo((e * 10) / 4, 9);
      expect(w.uvs[(4 * e + 1) * 2]).toBeCloseTo(((e + 1) * 10) / 4, 9);
    }
    expect(w.uvs[1]).toBeCloseTo(0, 9);
    expect(w.uvs[2 * 2 + 1]).toBeCloseTo(4, 9); // (14.8 - 2) / 3.2
  });
});

describe("triangulateRing / buildRoof", () => {
  it("triangulates a concave footprint into n - 2 upward-facing triangles inside it", () => {
    const tris = triangulateRing(ell);
    expect(tris.length).toBe((ell.length - 2) * 3);
    const roof = buildRoof(ell, 9);
    for (let f = 0; f < roof.indices.length; f += 3) expect(faceNormal(roof, f)[1]).toBeGreaterThan(0);
    for (let i = 1; i < roof.positions.length; i += 3) expect(roof.positions[i]).toBe(9);
    // Area of the triangles = footprint area (no triangle in the notch).
    let area = 0;
    for (let f = 0; f < roof.indices.length; f += 3) area += faceNormal(roof, f)[1] / 2;
    expect(area).toBeCloseTo(75, 6);
  });
});

describe("insetRing", () => {
  it("moves every edge inwards by the distance", () => {
    const r = insetRing(square, 1);
    expect(r).toEqual([
      [1, 1],
      [1, 9],
      [9, 9],
      [9, 1],
    ]);
  });

  it("handles the reflex corner of a concave footprint", () => {
    const r = insetRing(ell, 1);
    // Reflex vertex (5, 5) moves diagonally into the solid part.
    expect(r[3][0]).toBeCloseTo(4, 9);
    expect(r[3][1]).toBeCloseTo(4, 9);
  });
});

describe("buildParapet", () => {
  it("builds an outer face, an inner face and a cap above the roof", () => {
    const p = buildParapet(square, 10, 0.9, 0.3);
    let up = 0;
    let outward = 0;
    let inward = 0;
    for (let f = 0; f < p.indices.length; f += 3) {
      const n = faceNormal(p, f);
      const i = p.indices[f] * 3;
      const radial = n[0] * (p.positions[i] - 5) + n[2] * (p.positions[i + 2] - 5);
      if (n[1] > 1e-9) up++;
      else if (radial > 0) outward++;
      else if (radial < 0) inward++;
      expect(p.positions[i + 1]).toBeGreaterThanOrEqual(10 - 1e-9);
    }
    expect(up).toBe(8);
    expect(outward).toBe(8);
    expect(inward).toBe(8);
  });
});
