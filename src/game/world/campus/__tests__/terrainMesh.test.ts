import { describe, it, expect } from "vitest";
import { buildTerrainArrays, slopeShade, meshHeightAt } from "../terrainMesh";
import type { Terrain } from "../../../map/terrain";

function grid(width: number, height: number, fn: (i: number, j: number) => number): Terrain {
  const heights = new Float32Array(width * height);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) heights[j * width + i] = fn(i, j);
  return { originX: -10, originZ: 20, cellSize: 4, width, height, heights };
}

describe("buildTerrainArrays", () => {
  const t = grid(4, 3, (i, j) => i + 10 * j);
  const a = buildTerrainArrays(t);

  it("emits one vertex per sample at the sample's world position", () => {
    expect(a.positions.length).toBe(4 * 3 * 3);
    // Sample (i=2, j=1) sits at x = -10 + 8, z = 20 + 4 with height 12.
    const k = (1 * 4 + 2) * 3;
    expect([a.positions[k], a.positions[k + 1], a.positions[k + 2]]).toEqual([-2, 12, 24]);
  });

  it("emits two triangles per cell", () => {
    expect(a.indices.length).toBe((4 - 1) * (3 - 1) * 6);
    expect(Math.max(...a.indices)).toBe(4 * 3 - 1);
  });

  it("winds every triangle counter-clockwise seen from above (normals point up)", () => {
    const flat = buildTerrainArrays(grid(3, 3, () => 5));
    const p = flat.positions;
    for (let f = 0; f < flat.indices.length; f += 3) {
      const [a0, b0, c0] = [flat.indices[f] * 3, flat.indices[f + 1] * 3, flat.indices[f + 2] * 3];
      const ux = p[b0] - p[a0];
      const uz = p[b0 + 2] - p[a0 + 2];
      const vx = p[c0] - p[a0];
      const vz = p[c0 + 2] - p[a0 + 2];
      // y component of (b - a) x (c - a)
      const ny = uz * vx - ux * vz;
      expect(ny).toBeGreaterThan(0);
    }
  });

  it("maps uv (0,0) to the north-west corner and (1,1) to the south-east corner", () => {
    expect([a.uvs[0], a.uvs[1]]).toEqual([0, 1]);
    const last = (4 * 3 - 1) * 2;
    expect([a.uvs[last], a.uvs[last + 1]]).toEqual([1, 0]);
  });

  it("computes smooth vertex normals that lean against the slope", () => {
    const slope = buildTerrainArrays(grid(3, 3, (i) => i * 4)); // 45 degrees rising to +x
    const k = (1 * 3 + 1) * 3;
    expect(slope.normals[k]).toBeCloseTo(-Math.SQRT1_2, 4);
    expect(slope.normals[k + 1]).toBeCloseTo(Math.SQRT1_2, 4);
    expect(slope.normals[k + 2]).toBeCloseTo(0, 6);
  });

  it("tints steeper vertices darker/earthier than flat ones", () => {
    const steep = buildTerrainArrays(grid(3, 3, (i) => i * 4));
    const flat = buildTerrainArrays(grid(3, 3, () => 0));
    const k = (1 * 3 + 1) * 3;
    expect(steep.colors[k + 1]).toBeLessThan(flat.colors[k + 1]);
  });
});

describe("slopeShade", () => {
  it("is white on flat ground and fades with the slope", () => {
    expect(slopeShade(1)).toEqual([1, 1, 1]);
    const s = slopeShade(0.7);
    expect(s[1]).toBeLessThan(1);
    expect(s[0]).toBeGreaterThan(s[2]);
  });
});

describe("meshHeightAt", () => {
  const t = grid(4, 3, (i, j) => ((i * 5 + j * 3) % 4) * 1.5 + j);
  const a = buildTerrainArrays(t);

  it("equals the sample heights at the vertices", () => {
    for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) expect(meshHeightAt(t, -10 + i * 4, 20 + j * 4)).toBeCloseTo(t.heights[j * 4 + i], 6);
  });

  it("lies exactly on the rendered triangles inside every cell", () => {
    // Barycentric check against the actual index buffer.
    const p = a.positions;
    for (let f = 0; f < a.indices.length; f += 3) {
      const [i0, i1, i2] = [a.indices[f] * 3, a.indices[f + 1] * 3, a.indices[f + 2] * 3];
      for (const [w0, w1] of [
        [0.2, 0.3],
        [0.6, 0.1],
        [0.33, 0.33],
      ]) {
        const w2 = 1 - w0 - w1;
        const x = p[i0] * w0 + p[i1] * w1 + p[i2] * w2;
        const y = p[i0 + 1] * w0 + p[i1 + 1] * w1 + p[i2 + 1] * w2;
        const z = p[i0 + 2] * w0 + p[i1 + 2] * w1 + p[i2 + 2] * w2;
        expect(meshHeightAt(t, x, z)).toBeCloseTo(y, 5);
      }
    }
  });

  it("clamps to the grid edge outside it", () => {
    expect(meshHeightAt(t, -100, 20)).toBeCloseTo(t.heights[0], 6);
  });
});
