import { describe, it, expect, afterEach } from "vitest";
import { groundY, groundNormal, setGroundSampler, resetGround, clampToWorld, setWorldBounds, setSurfaceLift, surfaceY } from "../ground";

afterEach(() => resetGround());

describe("ground sampler", () => {
  it("is flat at y = 0 until a map provides its terrain", () => {
    expect(groundY(123, -45)).toBe(0);
    const n = groundNormal(5, 5);
    expect(n.y).toBeCloseTo(1, 6);
  });

  it("delegates to the installed sampler", () => {
    setGroundSampler((x, z) => 0.5 * x - 0.25 * z + 3);
    expect(groundY(2, 4)).toBeCloseTo(3, 6);
  });

  it("derives a unit normal leaning away from the uphill direction", () => {
    // Rises 1 m per metre towards +x (a 45 degree slope).
    setGroundSampler((x) => x);
    const n = groundNormal(0, 0);
    expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 6);
    expect(n.x).toBeCloseTo(-Math.SQRT1_2, 4);
    expect(n.y).toBeCloseTo(Math.SQRT1_2, 4);
    expect(n.z).toBeCloseTo(0, 6);
  });
});

describe("visual surface height", () => {
  it("is the terrain until a surface lift is installed, then terrain + lift (gameplay height unchanged)", () => {
    setGroundSampler((x) => x * 0.1);
    expect(surfaceY(10, 0)).toBeCloseTo(1, 9);
    setSurfaceLift((x) => (x > 5 ? 0.16 : 0.06));
    expect(surfaceY(10, 0)).toBeCloseTo(1.16, 9);
    expect(surfaceY(2, 0)).toBeCloseTo(0.26, 9);
    expect(groundY(10, 0)).toBeCloseTo(1, 9);
    resetGround();
    expect(surfaceY(10, 0)).toBe(0);
  });
});

describe("world bounds", () => {
  it("clamps positions to the playable rectangle", () => {
    setWorldBounds({ minX: -10, minZ: -20, maxX: 30, maxZ: 40 });
    const p = { x: -50, z: 99 };
    clampToWorld(p);
    expect(p).toEqual({ x: -10, z: 40 });
    const q = { x: 5, z: 5 };
    expect(clampToWorld(q)).toBe(false);
    expect(clampToWorld({ x: 31, z: 0 })).toBe(true);
  });
});
