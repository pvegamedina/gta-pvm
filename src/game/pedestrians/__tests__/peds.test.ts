import { describe, it, expect } from "vitest";
import { pedPosition, type Ped } from "../peds";

function makePed(overrides: Partial<Ped> = {}): Ped {
  return {
    bi: 0,
    bj: 0,
    s: 0,
    dir: 1,
    speed: 1,
    ox: 0,
    oz: 0,
    phase: 0,
    mesh: null as unknown as Ped["mesh"],
    yaw: 0,
    state: "walk",
    downT: 0,
    fleeT: 0,
    ...overrides,
  };
}

describe("pedPosition", () => {
  it("adds the dodge offset to the ring position", () => {
    const base = pedPosition(makePed());
    const offset = pedPosition(makePed({ ox: 1.5, oz: -0.5 }));
    expect(offset.x).toBeCloseTo(base.x + 1.5);
    expect(offset.z).toBeCloseTo(base.z - 0.5);
  });

  it("is deterministic for the same ring state", () => {
    const a = pedPosition(makePed({ bi: 2, bj: 3, s: 40 }));
    const b = pedPosition(makePed({ bi: 2, bj: 3, s: 40 }));
    expect(a).toEqual(b);
  });
});
