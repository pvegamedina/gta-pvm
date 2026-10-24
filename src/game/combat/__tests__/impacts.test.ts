import { describe, it, expect } from "vitest";
import { DecalRing, decalFade, rayTerrainHit } from "../impacts";

describe("DecalRing", () => {
  it("hands out free slots first", () => {
    const r = new DecalRing(3);
    expect([r.push(0), r.push(1), r.push(2)]).toEqual([0, 1, 2]);
  });

  it("recycles the oldest decal once the pool is full", () => {
    const r = new DecalRing(3);
    r.push(0);
    r.push(1);
    r.push(2);
    expect(r.push(3)).toBe(0);
    expect(r.push(4)).toBe(1);
    expect(r.bornAt(0)).toBe(3);
  });

  it("clear() frees every slot", () => {
    const r = new DecalRing(2);
    r.push(0);
    r.push(1);
    r.clear();
    expect(r.push(5)).toBe(0);
    expect(r.count).toBe(1);
  });
});

describe("decalFade", () => {
  it("stays fully visible for most of its life, then fades to zero", () => {
    expect(decalFade(1, 30, 2)).toBe(1);
    expect(decalFade(29, 30, 2)).toBeCloseTo(0.5, 6);
    expect(decalFade(31, 30, 2)).toBe(0);
  });
});


describe("rayTerrainHit", () => {
  it("hits flat ground at the plane height", () => {
    const d = rayTerrainHit({ x: 0, y: 11.75, z: 0 }, { x: 0, y: -1, z: 0 }, 50, () => 10);
    expect(d).toBeCloseTo(1.75, 3);
  });

  it("finds the hit point on a slope to within a few centimetres", () => {
    const h = (x: number) => 0.3 * x;
    const dir = { x: Math.SQRT1_2, y: -Math.SQRT1_2, z: 0 };
    const d = rayTerrainHit({ x: 0, y: 20, z: 0 }, dir, 200, h)!;
    const px = dir.x * d;
    const py = 20 + dir.y * d;
    expect(Math.abs(py - h(px))).toBeLessThan(0.03);
  });

  it("stops at a hill between the shooter and a far target (shooting uphill)", () => {
    // A 6 m bump centred at x = 30.
    const h = (x: number) => 6 * Math.exp(-((x - 30) ** 2) / 50);
    const dir = { x: 1, y: 0, z: 0 };
    const d = rayTerrainHit({ x: 0, y: 3, z: 0 }, dir, 100, h);
    expect(d).not.toBeNull();
    expect(d!).toBeGreaterThan(20);
    expect(d!).toBeLessThan(30);
  });

  it("returns null when the ray stays above the ground within range", () => {
    expect(rayTerrainHit({ x: 0, y: 2, z: 0 }, { x: 0, y: 1, z: 0 }, 50, () => 0)).toBeNull();
    expect(rayTerrainHit({ x: 0, y: 200, z: 0 }, { x: 0, y: -1, z: 0 }, 50, () => 0)).toBeNull();
  });

  it("ignores ground behind or at the origin when starting below it (inside a hill)", () => {
    expect(rayTerrainHit({ x: 0, y: -1, z: 0 }, { x: 1, y: 0, z: 0 }, 50, () => 0)).toBe(0);
  });
});
