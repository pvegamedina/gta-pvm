import { describe, expect, it } from "vitest";
import type { TerrainData } from "../types";
import { decodeTerrain, encodeTerrainHeights, heightAt, normalAt } from "../terrain";

function makeTerrain(heights: number[], width: number, height: number, cellSize = 4): TerrainData {
  return {
    originX: -4,
    originZ: -4,
    cellSize,
    width,
    height,
    minHeight: Math.min(...heights),
    maxHeight: Math.max(...heights),
    encoding: "int16le-dm-base64",
    data: encodeTerrainHeights(heights),
  };
}

describe("terrain encoding", () => {
  it("round-trips heights quantized to decimetres, including negatives", () => {
    const t = decodeTerrain(makeTerrain([0, 1.25, -3.4, 32.06], 2, 2));
    expect(Array.from(t.heights).map((h) => Math.round(h * 10) / 10)).toEqual([0, 1.3, -3.4, 32.1]);
  });

  it("rejects payloads whose length does not match width × height", () => {
    const bad = makeTerrain([1, 2, 3, 4], 2, 2);
    bad.width = 3;
    expect(() => decodeTerrain(bad)).toThrow(/terrain/i);
  });
});

describe("heightAt (bilinear)", () => {
  // 3 x 3 samples with origin (-4, -4) and 4 m cells:
  //   z=-4: 0  4  8
  //   z= 0: 2  6 10
  //   z= 4: 4  8 12      → h = x + z/2 + 6
  const t = decodeTerrain(makeTerrain([0, 4, 8, 2, 6, 10, 4, 8, 12], 3, 3));

  it("returns the exact sample on grid nodes", () => {
    expect(heightAt(t, -4, -4)).toBeCloseTo(0);
    expect(heightAt(t, 0, 0)).toBeCloseTo(6);
    expect(heightAt(t, 4, 4)).toBeCloseTo(12);
  });

  it("interpolates linearly between samples", () => {
    expect(heightAt(t, -2, -4)).toBeCloseTo(2);
    expect(heightAt(t, 1, 2)).toBeCloseTo(1 + 1 + 6);
  });

  it("clamps outside the grid", () => {
    expect(heightAt(t, -100, -100)).toBeCloseTo(0);
    expect(heightAt(t, 100, 100)).toBeCloseTo(12);
  });

  it("computes an up-facing unit normal tilted against the slope", () => {
    const [nx, ny, nz] = normalAt(t, 0, 0);
    expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1);
    expect(ny).toBeGreaterThan(0);
    // dh/dx = 1, dh/dz = 0.5 → normal ∝ (-1, 1, -0.5).
    expect(nx / ny).toBeCloseTo(-1);
    expect(nz / ny).toBeCloseTo(-0.5);
  });
});
