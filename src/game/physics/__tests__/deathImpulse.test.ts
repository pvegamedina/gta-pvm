import { describe, it, expect } from "vitest";
import { shotImpulse, ramVelocity, nearestIndex, SHOT_IMPULSE, findKillingShot } from "../deathImpulse";

describe("shotImpulse", () => {
  it("pushes along the (normalized) shot direction with the weapon's strength", () => {
    const imp = shotImpulse({ x: 0, y: 0, z: 10 }, "pistol");
    expect(imp.z).toBeGreaterThan(0);
    const horiz = Math.hypot(imp.x, imp.z);
    expect(horiz).toBeCloseTo(SHOT_IMPULSE.pistol, 0);
  });

  it("adds a little lift so bodies fold instead of sliding", () => {
    const imp = shotImpulse({ x: 1, y: 0, z: 0 }, "m4");
    expect(imp.y).toBeGreaterThan(0);
  });

  it("returns zero for a degenerate direction", () => {
    expect(shotImpulse({ x: 0, y: 0, z: 0 }, "pistol")).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("ramVelocity", () => {
  it("throws the body along the car's velocity with some lift", () => {
    const v = ramVelocity({ x: 12, y: 0, z: 0 });
    expect(v.x).toBeGreaterThan(8);
    expect(v.y).toBeGreaterThan(0.5);
    expect(v.z).toBeCloseTo(0, 6);
  });
});

describe("nearestIndex", () => {
  it("picks the closest point", () => {
    const pts = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1.5, z: 0 },
      { x: 2, y: 0, z: 0 },
    ];
    expect(nearestIndex(pts, { x: 0.1, y: 1.3, z: 0 })).toBe(1);
  });
});

describe("findKillingShot", () => {
  const shots = [
    { origin: { x: 0, y: 1.5, z: 0 }, end: { x: 0, y: 1.2, z: 10 }, time: 9.9 },
    { origin: { x: 0, y: 1.5, z: 0 }, end: { x: 30, y: 1, z: 0 }, time: 9.95 },
  ];

  it("returns the most recent shot that landed near the victim", () => {
    const s = findKillingShot(shots, { x: 0.2, y: 0, z: 10.1 }, 10, 0.6, 2);
    expect(s?.end.z).toBe(10);
  });

  it("ignores stale shots", () => {
    expect(findKillingShot(shots, { x: 0, y: 0, z: 10 }, 12, 0.6, 2)).toBeNull();
  });
});
