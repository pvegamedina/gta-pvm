import { describe, it, expect } from "vitest";
import { canopyColumns, orientedBox, pitchedRoof, wantsPitchedRoof } from "../roofs";
import type { RibbonArrays } from "../ribbon";
import type { Ring } from "../../../map/types";

const rect: Ring = [
  [0, 0],
  [0, 6],
  [12, 6],
  [12, 0],
];
const square: Ring = [
  [0, 0],
  [0, 8],
  [8, 8],
  [8, 0],
];
const ell: Ring = [
  [0, 0],
  [0, 10],
  [3, 10],
  [3, 3],
  [10, 3],
  [10, 0],
];

function faceNormals(a: RibbonArrays): [number, number, number][] {
  const out: [number, number, number][] = [];
  const p = a.positions;
  for (let f = 0; f < a.indices.length; f += 3) {
    const [i, j, k] = [a.indices[f] * 3, a.indices[f + 1] * 3, a.indices[f + 2] * 3];
    const u = [p[j] - p[i], p[j + 1] - p[i + 1], p[j + 2] - p[i + 2]];
    const v = [p[k] - p[i], p[k + 1] - p[i + 1], p[k + 2] - p[i + 2]];
    out.push([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]);
  }
  return out;
}

describe("orientedBox", () => {
  it("fits an axis-aligned rectangle with its long axis first", () => {
    const b = orientedBox(rect);
    expect(b.cx).toBeCloseTo(6, 9);
    expect(b.cz).toBeCloseTo(3, 9);
    expect(b.halfL).toBeCloseTo(6, 9);
    expect(b.halfW).toBeCloseTo(3, 9);
    expect(Math.abs(b.ux)).toBeCloseTo(1, 9);
    expect(b.area).toBeCloseTo(72, 9);
  });

  it("fits a rotated rectangle", () => {
    const c = Math.cos(0.5);
    const s = Math.sin(0.5);
    const rot = rect.map(([x, z]) => [x * c - z * s, x * s + z * c] as [number, number]);
    const b = orientedBox(rot);
    expect(b.halfL).toBeCloseTo(6, 6);
    expect(b.halfW).toBeCloseTo(3, 6);
  });
});

describe("wantsPitchedRoof", () => {
  it("accepts small houses with a near-rectangular footprint", () => {
    expect(wantsPitchedRoof("house", rect, 6)).toBe(true);
    expect(wantsPitchedRoof("residential", square, 6)).toBe(true);
  });

  it("rejects campus buildings, big blocks and L shapes", () => {
    expect(wantsPitchedRoof("university", rect, 6)).toBe(false);
    const big: Ring = [
      [0, 0],
      [0, 30],
      [40, 30],
      [40, 0],
    ];
    expect(wantsPitchedRoof("house", big, 6)).toBe(false);
    expect(wantsPitchedRoof("house", ell, 6)).toBe(false);
    expect(wantsPitchedRoof("house", rect, 20)).toBe(false);
  });
});

describe("pitchedRoof", () => {
  it("builds a gable roof along the long axis with upward slopes and outward gables", () => {
    const r = pitchedRoof(rect, 10, { pitch: 0.6, overhang: 0.3 })!;
    expect(r.kind).toBe("gable");
    expect(r.ridgeHeight).toBeCloseTo(3 * 0.6, 9);
    const ys = [];
    for (let i = 1; i < r.roof.positions.length; i += 3) ys.push(r.roof.positions[i]);
    expect(Math.max(...ys)).toBeCloseTo(10 + 1.8, 9);
    // Eaves overhang and drop below the wall top along the slope.
    expect(Math.min(...ys)).toBeCloseTo(10 - 0.3 * 0.6, 9);
    for (const n of faceNormals(r.roof)) expect(n[1]).toBeGreaterThan(0);
    // Gable triangles face out along the long axis (x here).
    const gn = faceNormals(r.gables);
    expect(gn.length).toBe(2);
    expect(gn.some((n) => n[0] > 0) && gn.some((n) => n[0] < 0)).toBe(true);
    for (const n of gn) expect(Math.abs(n[1])).toBeLessThan(1e-9);
    expect(r.roof.normals.length).toBe(r.roof.positions.length);
    expect(r.roof.uvs.length / 2).toBe(r.roof.positions.length / 3);
  });

  it("builds a hipped roof on square-ish footprints (no gables)", () => {
    const r = pitchedRoof(square, 5, { pitch: 0.5, overhang: 0.3 })!;
    expect(r.kind).toBe("hip");
    expect(r.gables.indices.length).toBe(0);
    for (const n of faceNormals(r.roof)) expect(n[1]).toBeGreaterThan(0);
    const ys = [];
    for (let i = 1; i < r.roof.positions.length; i += 3) ys.push(r.roof.positions[i]);
    expect(Math.max(...ys)).toBeCloseTo(5 + 4 * 0.5, 9);
  });

  it("returns null for footprints that are not box-like", () => {
    expect(pitchedRoof(ell, 5)).toBeNull();
  });
});

describe("canopyColumns", () => {
  it("puts a column at every corner and along long edges, inside the canopy", () => {
    const cols = canopyColumns(rect, 5, 0.5);
    // Corners (4) + 2 extra along each 12 m edge (11 m inside -> 3 spans); the 5 m short sides need none.
    expect(cols.length).toBe(4 + 2 * 2);
    for (const [x, z] of cols) {
      expect(x).toBeGreaterThan(0.49);
      expect(x).toBeLessThan(11.51);
      expect(z).toBeGreaterThan(0.49);
      expect(z).toBeLessThan(5.51);
    }
  });

  it("returns nothing for slivers", () => {
    expect(canopyColumns([[0, 0], [0, 0.6], [0.6, 0.6], [0.6, 0]], 5, 0.5)).toEqual([]);
  });
});
