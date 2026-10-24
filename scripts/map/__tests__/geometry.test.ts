import { describe, expect, it } from "vitest";
import { assembleRings } from "../osm";
import { clipPolygon, clipPolyline, type KeyedPoint } from "../clip";
import { resampleAlong } from "../trees";

const rect = { minX: 0, minZ: 0, maxX: 10, maxZ: 10 };
const kp = (x: number, z: number, key: string): KeyedPoint => ({ x, z, key });

describe("assembleRings", () => {
  it("joins open member ways sharing endpoints (in any direction) into closed rings", () => {
    const rings = assembleRings([
      [1, 2, 3],
      [5, 4, 3], // reversed
      [5, 6, 1],
      [10, 11, 12, 10], // already closed
    ]);
    expect(rings).toHaveLength(2);
    const big = rings.find((r) => r.length === 6)!;
    expect(new Set(big)).toEqual(new Set([1, 2, 3, 4, 5, 6]));
    expect(rings.find((r) => r.length === 3)).toEqual([10, 11, 12]);
  });

  it("drops chains that never close", () => {
    expect(assembleRings([[1, 2, 3]])).toEqual([]);
  });
});

describe("clipPolyline", () => {
  it("keeps fully inside polylines untouched", () => {
    const pts = [kp(1, 1, "a"), kp(5, 5, "b")];
    expect(clipPolyline(pts, rect)).toEqual([pts]);
  });

  it("cuts a polyline at the rectangle border with keyed boundary points", () => {
    const runs = clipPolyline([kp(-10, 5, "a"), kp(5, 5, "b"), kp(20, 5, "c")], rect);
    expect(runs).toHaveLength(1);
    expect(runs[0].map((p) => [p.x, p.z])).toEqual([
      [0, 5],
      [5, 5],
      [10, 5],
    ]);
    expect(runs[0][1].key).toBe("b");
    expect(runs[0][0].key).not.toBe(runs[0][2].key);
  });

  it("splits a polyline that leaves and re-enters", () => {
    const runs = clipPolyline([kp(2, 2, "a"), kp(2, 20, "b"), kp(8, 20, "c"), kp(8, 2, "d")], rect);
    expect(runs).toHaveLength(2);
  });

  it("drops polylines completely outside", () => {
    expect(clipPolyline([kp(20, 20, "a"), kp(30, 30, "b")], rect)).toEqual([]);
  });
});

describe("clipPolygon", () => {
  it("clips a square overlapping the rectangle", () => {
    const out = clipPolygon(
      [
        [5, 5],
        [15, 5],
        [15, 15],
        [5, 15],
      ],
      rect,
    );
    const xs = out.map((p) => p[0]);
    const zs = out.map((p) => p[1]);
    expect(Math.max(...xs)).toBe(10);
    expect(Math.max(...zs)).toBe(10);
    expect(out.length).toBe(4);
  });
});

describe("resampleAlong", () => {
  it("places points every `spacing` metres including both ends", () => {
    const pts = resampleAlong(
      [
        [0, 0],
        [21, 0],
      ],
      7,
    );
    expect(pts.map((p) => p[0])).toEqual([0, 7, 14, 21]);
  });

  it("follows bends", () => {
    const pts = resampleAlong(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      5,
    );
    expect(pts).toHaveLength(5);
    expect(pts[2]).toEqual([10, 0]);
  });
});
