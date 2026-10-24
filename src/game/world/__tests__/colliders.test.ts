import { describe, it, expect } from "vitest";
import { CollisionGrid, circleVsCollider, makePolygonCollider, type HitInfo, type Collider } from "../colliders";

const square = makePolygonCollider(
  [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
  2,
  14,
);

// L-shaped footprint: the notch (x>5, z>5) is outside the building.
const ell = makePolygonCollider(
  [
    [0, 0],
    [10, 0],
    [10, 5],
    [5, 5],
    [5, 10],
    [0, 10],
  ],
  0,
  10,
);

const hit = (): HitInfo => ({ nx: 0, nz: 0, pen: 0 });

describe("polygon colliders", () => {
  it("precomputes the bbox and keeps the absolute base/top heights", () => {
    expect(square.minX).toBe(0);
    expect(square.maxZ).toBe(10);
    expect(square.y0).toBe(2);
    expect(square.h).toBe(14);
  });

  it("misses circles that are clear of every edge", () => {
    expect(circleVsCollider(square, -2, 5, 0.5, hit())).toBe(false);
    expect(circleVsCollider(square, 5, 12, 1, hit())).toBe(false);
  });

  it("pushes a circle overlapping an edge from outside straight away from that edge", () => {
    const h = hit();
    expect(circleVsCollider(square, -0.3, 5, 0.5, h)).toBe(true);
    expect(h.nx).toBeCloseTo(-1, 6);
    expect(h.nz).toBeCloseTo(0, 6);
    expect(h.pen).toBeCloseTo(0.2, 6);
  });

  it("pushes a circle that ended up inside out through the nearest edge", () => {
    const h = hit();
    expect(circleVsCollider(square, 9, 4, 0.5, h)).toBe(true);
    expect(h.nx).toBeCloseTo(1, 6);
    expect(h.nz).toBeCloseTo(0, 6);
    expect(h.pen).toBeCloseTo(1.5, 6);
  });

  it("treats the notch of a concave footprint as free space", () => {
    expect(circleVsCollider(ell, 8, 8, 0.5, hit())).toBe(false);
    const h = hit();
    // Close to the inner corner wall at x = 5 (from the notch side).
    expect(circleVsCollider(ell, 5.3, 8, 0.5, h)).toBe(true);
    expect(h.nx).toBeCloseTo(1, 6);
    expect(h.pen).toBeCloseTo(0.2, 6);
  });

  it("resolves corner contacts along the diagonal", () => {
    const h = hit();
    expect(circleVsCollider(square, 10.3, 10.3, 0.5, h)).toBe(true);
    expect(h.nx).toBeCloseTo(Math.SQRT1_2, 5);
    expect(h.nz).toBeCloseTo(Math.SQRT1_2, 5);
  });
});

describe("CollisionGrid", () => {
  it("returns each collider at most once per query even when it spans many cells", () => {
    const grid = new CollisionGrid();
    const big = makePolygonCollider(
      [
        [-100, -100],
        [100, -100],
        [100, 100],
        [-100, 100],
      ],
      0,
      20,
    );
    grid.add(big);
    grid.addCirc(3, 3, 0.4);
    const seen: Collider[] = [];
    grid.each(0, 0, 40, (c) => seen.push(c));
    expect(seen.filter((c) => c === big)).toHaveLength(1);
    expect(seen).toHaveLength(2);
    // A second query sees them again.
    const again: Collider[] = [];
    grid.each(0, 0, 40, (c) => again.push(c));
    expect(again).toHaveLength(2);
  });

  it("finds colliders far from the origin (the campus spans more than a kilometre)", () => {
    const grid = new CollisionGrid();
    grid.addCirc(560, -620, 0.5);
    const seen: Collider[] = [];
    grid.each(560, -620, 1, (c) => seen.push(c));
    expect(seen).toHaveLength(1);
  });

  it("keeps circle colliders' base height so they can sit on sloped terrain", () => {
    const grid = new CollisionGrid();
    grid.addCirc(1, 2, 0.3, 12.5, 6);
    const c = grid.all()[0];
    expect(c.t).toBe(1);
    expect(c.y0).toBe(12.5);
    expect(c.h).toBe(18.5);
  });
});
