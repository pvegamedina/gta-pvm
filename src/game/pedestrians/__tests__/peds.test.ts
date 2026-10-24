import { describe, it, expect } from "vitest";
import { pedPosition, pedVelocity, spookPedsNear, hitPed, type Ped } from "../peds";

function makePed(overrides: Partial<Ped> = {}): Ped {
  return {
    walker: null as unknown as Ped["walker"],
    speed: 1,
    ox: 0,
    oz: 0,
    x: 10,
    z: -4,
    mesh: null as unknown as Ped["mesh"],
    yaw: 0,
    state: "walk",
    downT: 0,
    fleeT: 0,
    ...overrides,
  };
}

describe("pedPosition", () => {
  it("adds the dodge offset to the walking-line position", () => {
    const base = pedPosition(makePed());
    const offset = pedPosition(makePed({ ox: 1.5, oz: -0.5 }));
    expect(offset.x).toBeCloseTo(base.x + 1.5);
    expect(offset.z).toBeCloseTo(base.z - 0.5);
  });

  it("is deterministic for the same state", () => {
    expect(pedPosition(makePed({ x: 3, z: 4 }))).toEqual(pedPosition(makePed({ x: 3, z: 4 })));
  });
});

describe("pedVelocity", () => {
  it("walks along its heading and runs while fleeing", () => {
    const walking = pedVelocity(makePed({ yaw: Math.PI / 2, speed: 1.2 }));
    expect(walking.x).toBeCloseTo(1.2);
    expect(walking.z).toBeCloseTo(0);
    const fleeing = pedVelocity(makePed({ yaw: 0, speed: 1, fleeT: 1 }));
    expect(fleeing.z).toBeCloseTo(2.1);
  });

  it("is zero once down", () => {
    const p = makePed();
    hitPed(p);
    expect(pedVelocity(p)).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("spookPedsNear", () => {
  it("makes living peds within the radius flee", () => {
    const near = makePed({ x: 1, z: 1 });
    const far = makePed({ x: 40, z: 0 });
    const dead = makePed({ x: 0, z: 0 });
    hitPed(dead);
    spookPedsNear([near, far, dead], 0, 0, 10);
    expect(near.fleeT).toBeGreaterThan(0);
    expect(far.fleeT).toBe(0);
    expect(dead.fleeT).toBe(0);
  });
});
