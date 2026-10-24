import { describe, it, expect } from "vitest";
import { stepFootVelocity, directionalSpeedScale, FOOT_TUNING, type FootMoveInput, type FootVelocity } from "../footMotion";

const DT = 1 / 60;
const fwd: FootMoveInput = { dirX: 0, dirZ: 1, run: false, ground: true };
const sprint: FootMoveInput = { ...fwd, run: true };
const none: FootMoveInput = { dirX: 0, dirZ: 0, run: false, ground: true };

const speedOf = (v: FootVelocity) => Math.hypot(v.x, v.z);
const headingOf = (v: FootVelocity) => Math.atan2(v.x, v.z);

/** Integrates `seconds` of motion, returning the velocity, distance and per-step speeds. */
function simulate(v0: FootVelocity, input: FootMoveInput, seconds: number, dt = DT) {
  let v = { ...v0 };
  let dist = 0;
  const speeds: number[] = [];
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    v = stepFootVelocity(v, input, dt);
    dist += speedOf(v) * dt;
    speeds.push(speedOf(v));
  }
  return { v, dist, speeds };
}

describe("stepFootVelocity", () => {
  it("ramps up monotonically to walking speed without overshooting", () => {
    const { v, speeds } = simulate({ x: 0, z: 0 }, fwd, 1.5);
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]).toBeGreaterThanOrEqual(speeds[i - 1] - 1e-12);
    expect(Math.max(...speeds)).toBeLessThanOrEqual(FOOT_TUNING.walkSpeed + 1e-9);
    expect(speedOf(v)).toBeCloseTo(FOOT_TUNING.walkSpeed, 6);
    // Reaches walking pace quickly (~walkAccel), but not instantly.
    expect(speeds[0]).toBeLessThan(0.2);
    const reach = speeds.findIndex((s) => s >= FOOT_TUNING.walkSpeed - 1e-6) * DT;
    expect(reach).toBeGreaterThan(0.25);
    expect(reach).toBeLessThan(0.6);
  });

  it("builds up from walk to sprint in about a second, monotonic and capped", () => {
    const start = { x: 0, z: FOOT_TUNING.walkSpeed };
    const { v, speeds } = simulate(start, sprint, 2);
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]).toBeGreaterThanOrEqual(speeds[i - 1] - 1e-12);
    expect(Math.max(...speeds)).toBeLessThanOrEqual(FOOT_TUNING.runSpeed + 1e-9);
    expect(speedOf(v)).toBeCloseTo(FOOT_TUNING.runSpeed, 6);
    const t95 = speeds.findIndex((s) => s >= 0.95 * FOOT_TUNING.runSpeed) * DT;
    expect(t95).toBeGreaterThan(0.7);
    expect(t95).toBeLessThan(1.3);
  });

  it("eases back down to walking pace when the run key is released", () => {
    const { speeds } = simulate({ x: 0, z: FOOT_TUNING.runSpeed }, fwd, 2);
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]).toBeLessThanOrEqual(speeds[i - 1] + 1e-12);
    expect(Math.min(...speeds)).toBeGreaterThanOrEqual(FOOT_TUNING.walkSpeed - 1e-9);
    // Not a snap: the first frame only sheds a little speed.
    expect(FOOT_TUNING.runSpeed - speeds[0]).toBeLessThan(0.15);
  });

  it("brakes to a full stop with a short slide-out and never reverses", () => {
    const start = { x: 0, z: FOOT_TUNING.runSpeed };
    const { v, dist, speeds } = simulate(start, none, 2);
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]).toBeLessThanOrEqual(speeds[i - 1] + 1e-12);
    expect(v).toEqual({ x: 0, z: 0 });
    // v^2 / 2a at 8 m/s^2 is ~2.7 m; the eased tail adds a little.
    expect(dist).toBeGreaterThan(2.2);
    expect(dist).toBeLessThan(3.6);
    const stopT = speeds.findIndex((s) => s === 0) * DT;
    expect(stopT).toBeGreaterThan(0.6);
    expect(stopT).toBeLessThan(1.3);
    // Walking stops are short.
    const walkStop = simulate({ x: 0, z: FOOT_TUNING.walkSpeed }, none, 1);
    expect(walkStop.dist).toBeGreaterThan(0.2);
    expect(walkStop.dist).toBeLessThan(0.7);
  });

  it("is framerate independent", () => {
    for (const [v0, input] of [
      [{ x: 0, z: 0 }, sprint],
      [{ x: 0, z: FOOT_TUNING.runSpeed }, none],
      [{ x: 0, z: FOOT_TUNING.runSpeed }, { ...fwd, dirX: 1, dirZ: 0, run: true }],
    ] as const) {
      const fine = simulate(v0, input, 1.2, 1 / 240);
      const coarse = simulate(v0, input, 1.2, 1 / 30);
      expect(Math.abs(fine.v.x - coarse.v.x)).toBeLessThan(0.08);
      expect(Math.abs(fine.v.z - coarse.v.z)).toBeLessThan(0.08);
      expect(Math.abs(fine.dist - coarse.dist)).toBeLessThan(0.05 * Math.max(1, fine.dist));
    }
  });

  it("arcs into a sideways turn instead of snapping, keeping most of its speed", () => {
    const right: FootMoveInput = { dirX: 1, dirZ: 0, run: true, ground: true };
    let v: FootVelocity = { x: 0, z: FOOT_TUNING.runSpeed };
    v = stepFootVelocity(v, right, DT);
    // One frame turns only a few degrees.
    expect(headingOf(v)).toBeGreaterThan(0);
    expect(headingOf(v)).toBeLessThan(0.1);
    let minSpeed = Infinity;
    let t = DT;
    while (Math.abs(headingOf(v) - Math.PI / 2) > 1e-3 && t < 3) {
      v = stepFootVelocity(v, right, DT);
      minSpeed = Math.min(minSpeed, speedOf(v));
      t += DT;
    }
    expect(t).toBeGreaterThan(0.35);
    expect(t).toBeLessThan(1.2);
    expect(minSpeed).toBeGreaterThan(0.5 * FOOT_TUNING.runSpeed);
  });

  it("turns faster when slower (tighter radius while walking)", () => {
    const right: FootMoveInput = { dirX: 1, dirZ: 0, run: false, ground: true };
    const walk = stepFootVelocity({ x: 0, z: FOOT_TUNING.walkSpeed }, right, DT);
    const run = stepFootVelocity({ x: 0, z: FOOT_TUNING.runSpeed }, { ...right, run: true }, DT);
    expect(headingOf(walk)).toBeGreaterThan(headingOf(run) * 2);
  });

  it("brakes through a reversal rather than sliding sideways", () => {
    const back: FootMoveInput = { dirX: 0, dirZ: -1, run: true, ground: true };
    let v: FootVelocity = { x: 0, z: FOOT_TUNING.runSpeed };
    let prevZ = v.z;
    let reversedAt = -1;
    for (let i = 0; i < 180; i++) {
      v = stepFootVelocity(v, back, DT);
      expect(Math.abs(v.x)).toBeLessThan(1e-9);
      if (reversedAt < 0) {
        expect(v.z).toBeLessThanOrEqual(prevZ + 1e-12);
        if (v.z < 0) reversedAt = i * DT;
      }
      prevZ = v.z;
    }
    expect(reversedAt).toBeGreaterThan(0.5);
    expect(v.z).toBeLessThan(-FOOT_TUNING.walkSpeed);
  });

  it("starts moving straight away in any direction from rest", () => {
    const diag: FootMoveInput = { dirX: Math.SQRT1_2, dirZ: -Math.SQRT1_2, run: false, ground: true };
    const v = stepFootVelocity({ x: 0, z: 0 }, diag, DT);
    expect(speedOf(v)).toBeGreaterThan(0);
    expect(headingOf(v)).toBeCloseTo(Math.atan2(diag.dirX, diag.dirZ), 9);
  });

  it("has little air control and keeps momentum while airborne", () => {
    const air = simulate({ x: 0, z: 0 }, { ...sprint, ground: false }, 0.5);
    expect(speedOf(air.v)).toBeLessThan(0.8);
    expect(speedOf(air.v)).toBeGreaterThan(0);
    const coast = simulate({ x: 0, z: FOOT_TUNING.runSpeed }, { ...none, ground: false }, 0.5);
    expect(speedOf(coast.v)).toBeGreaterThan(0.9 * FOOT_TUNING.runSpeed);
  });

  it("writes into `out` when given and does not mutate the input", () => {
    const v0 = { x: 0, z: 1 };
    const out = { x: 9, z: 9 };
    const r = stepFootVelocity(v0, fwd, DT, out);
    expect(r).toBe(out);
    expect(v0).toEqual({ x: 0, z: 1 });
  });
});

describe("aimed (facing-locked) movement speed by direction", () => {
  it("scales 1 forward, strafeSpeedScale sideways and backSpeedScale backwards, continuously", () => {
    expect(directionalSpeedScale(0, 1, 0, 1)).toBeCloseTo(1, 9);
    expect(directionalSpeedScale(1, 0, 0, 1)).toBeCloseTo(FOOT_TUNING.strafeSpeedScale, 9);
    expect(directionalSpeedScale(0, -1, 0, 1)).toBeCloseTo(FOOT_TUNING.backSpeedScale, 9);
    let prev = directionalSpeedScale(0, 1, 0, 1);
    for (let a = 0; a < Math.PI * 2; a += 0.02) {
      const k = directionalSpeedScale(Math.sin(a), Math.cos(a), 0, 1);
      expect(Math.abs(k - prev)).toBeLessThan(0.02);
      prev = k;
    }
  });

  it("caps back-pedalling while facing is locked (aiming) but not free running", () => {
    const back: FootMoveInput = { dirX: 0, dirZ: -1, run: false, ground: true, facingX: 0, facingZ: 1 };
    const { v } = simulate({ x: 0, z: 0 }, back, 2);
    expect(speedOf(v)).toBeCloseTo(FOOT_TUNING.walkSpeed * FOOT_TUNING.backSpeedScale, 6);
    const free = simulate({ x: 0, z: 0 }, { ...back, facingX: undefined, facingZ: undefined }, 2);
    expect(speedOf(free.v)).toBeCloseTo(FOOT_TUNING.walkSpeed, 6);
  });
});
