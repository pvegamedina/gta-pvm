import { describe, it, expect } from "vitest";
import { parseMotion } from "./validation";

const base = { p: [1, 0, 2], yaw: 0, speed: 1, ground: true, weapon: "m4", aiming: true, car: null };

describe("parseMotion aimPitch", () => {
  it("keeps a sane aim pitch, clamped to straight up/down", () => {
    expect(parseMotion({ ...base, aimPitch: 0.3 })?.aimPitch).toBe(0.3);
    expect(parseMotion({ ...base, aimPitch: 9 })?.aimPitch).toBeCloseTo(Math.PI / 2, 9);
    expect(parseMotion({ ...base, aimPitch: -9 })?.aimPitch).toBeCloseTo(-Math.PI / 2, 9);
  });

  it("drops a missing or garbage aim pitch without rejecting the motion (old clients)", () => {
    const m = parseMotion(base);
    expect(m).not.toBeNull();
    expect(m && "aimPitch" in m).toBe(false);
    expect(parseMotion({ ...base, aimPitch: "up" })?.aimPitch).toBeUndefined();
    expect(parseMotion({ ...base, aimPitch: Number.NaN })?.aimPitch).toBeUndefined();
  });
});

describe("parseMotion car flags", () => {
  const car = { type: "police", color: 0xffffff, yaw: 0.5, speed: 12, steer: 0.1 };

  it("keeps the optional siren and brake booleans", () => {
    const m = parseMotion({ ...base, car: { ...car, siren: true, brake: false } });
    expect(m?.car).toEqual({ ...car, siren: true, brake: false });
  });

  it("drops non-boolean flags and accepts cars without them (old clients)", () => {
    expect(parseMotion({ ...base, car: { ...car, siren: "yes", brake: 1 } })?.car).toEqual(car);
    expect(parseMotion({ ...base, car })?.car).toEqual(car);
  });
});
