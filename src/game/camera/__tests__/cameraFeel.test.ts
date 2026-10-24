import { describe, it, expect } from "vitest";
import { CameraFollow, LandingDip, sprintFovFactor, CAMERA_FEEL } from "../cameraFeel";

const DT = 1 / 60;

/** Follows a point moving at `v` m/s along x for `seconds`; returns the steady lag. */
function lagAt(motion: number, v: number, aiming = false, seconds = 3): number {
  const f = new CameraFollow();
  f.snap(0, 0, 0);
  let x = 0;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    x += v * DT;
    f.update(DT, x, 0, 0, 16, motion, aiming);
  }
  return x - f.x;
}

describe("CameraFollow", () => {
  it("at 0 % camera motion is the legacy exponential follow", () => {
    const f = new CameraFollow();
    f.snap(0, 0, 0);
    let legacy = 0;
    for (let i = 0; i < 30; i++) {
      f.update(DT, 5, 1, -2, 16, 0, false);
      legacy += (5 - legacy) * (1 - Math.exp(-DT * 16));
    }
    expect(f.x).toBeCloseTo(legacy, 9);
  });

  it("lags a sprinting character a bit more at 100 %, but well under a metre", () => {
    const off = lagAt(0, 6.6);
    const on = lagAt(1, 6.6);
    expect(on).toBeGreaterThan(off + 0.1);
    expect(on).toBeLessThan(1);
  });

  it("stays tight while aiming (shoulder framing / precision)", () => {
    expect(lagAt(1, 2.3, true)).toBeLessThan(lagAt(1, 2.3, false));
    expect(lagAt(1, 2.3, true)).toBeLessThan(0.2);
  });

  it("settles exactly on a stopped target and snap() jumps there", () => {
    const f = new CameraFollow();
    f.snap(0, 0, 0);
    for (let i = 0; i < 300; i++) f.update(DT, 3, 2, 1, 16, 1, false);
    expect(f.x).toBeCloseTo(3, 4);
    expect(f.y).toBeCloseTo(2, 4);
    expect(f.z).toBeCloseTo(1, 4);
    f.snap(-4, 5, 6);
    expect([f.x, f.y, f.z]).toEqual([-4, 5, 6]);
  });
});

describe("sprintFovFactor", () => {
  it("is 0 up to a brisk walk, 1 at a full sprint and monotonic", () => {
    expect(sprintFovFactor(0)).toBe(0);
    expect(sprintFovFactor(2.3)).toBe(0);
    expect(sprintFovFactor(6.6)).toBeCloseTo(1, 6);
    let prev = 0;
    for (let s = 0; s < 8; s += 0.1) {
      const f = sprintFovFactor(s);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });
});

describe("LandingDip", () => {
  it("dips the camera on landing by more for bigger falls, capped, and recovers", () => {
    const peak = (fall: number) => {
      const d = new LandingDip();
      d.land(fall);
      let min = 0;
      for (let i = 0; i < 60; i++) min = Math.min(min, d.update(DT));
      for (let i = 0; i < 240; i++) d.update(DT);
      expect(Math.abs(d.update(DT))).toBeLessThan(1e-3);
      return min;
    };
    expect(peak(2)).toBe(0); // tiny drops (steps) do nothing
    const small = peak(5);
    const big = peak(10);
    expect(small).toBeLessThan(-0.02);
    expect(big).toBeLessThan(small);
    expect(peak(60)).toBeGreaterThanOrEqual(-CAMERA_FEEL.landMaxDip - 1e-6);
  });
});
