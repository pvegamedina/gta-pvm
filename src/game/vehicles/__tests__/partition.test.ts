import { describe, expect, it } from "vitest";
import { partitionTriangles } from "../partition";

// Two wheels in one mesh (the Public Transport Pack's "FrontWheels"): one triangle at x = -0.8, one at x = +0.8.
const xs = [-0.9, -0.8, -0.7, 0.7, 0.8, 0.9];
const index = [0, 1, 2, 3, 4, 5];

describe("partitionTriangles", () => {
  it("splits a wheel pair by the side of the centre line each triangle lies on", () => {
    const [left, right] = partitionTriangles(index, (v) => xs[v], 0);
    expect(left).toEqual([0]);
    expect(right).toEqual([1]);
  });

  it("decides by the triangle centroid (a triangle straddling the line goes where most of it is)", () => {
    const straddle = [-0.1, 0.5, 0.6];
    const [below, above] = partitionTriangles([0, 1, 2], (v) => straddle[v], 0);
    expect(below).toEqual([]);
    expect(above).toEqual([0]);
  });

  it("returns triangle indices into the index buffer, in order", () => {
    const zs = [1, 1, 1, -1, -1, -1, 2, 2, 2];
    const [rear, front] = partitionTriangles([0, 1, 2, 3, 4, 5, 6, 7, 8], (v) => zs[v], 0);
    expect(rear).toEqual([1]);
    expect(front).toEqual([0, 2]);
  });
});
