import { describe, it, expect } from "vitest";
import { DecalRing, decalFade, rayGroundHit } from "../impacts";

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

describe("rayGroundHit", () => {
  // Roads (y=0) for |x| < 9, raised blocks (y=0.25) elsewhere.
  const groundY = (x: number) => (Math.abs(x) < 9 ? 0 : 0.25);

  it("hits a raised block at y=0.25", () => {
    const d = rayGroundHit({ x: 20, y: 1.75, z: 0 }, { x: 0, y: -1, z: 0 }, 50, groundY);
    expect(d).toBeCloseTo(1.5, 6);
  });

  it("hits the road at y=0 when the block plane is above the road there", () => {
    const d = rayGroundHit({ x: 0, y: 2, z: 0 }, { x: 0, y: -1, z: 0 }, 50, groundY);
    expect(d).toBeCloseTo(2, 6);
  });

  it("misses rays going up or beyond range", () => {
    expect(rayGroundHit({ x: 0, y: 2, z: 0 }, { x: 0, y: 1, z: 0 }, 50, groundY)).toBeNull();
    expect(rayGroundHit({ x: 0, y: 200, z: 0 }, { x: 0, y: -1, z: 0 }, 50, groundY)).toBeNull();
  });
});
