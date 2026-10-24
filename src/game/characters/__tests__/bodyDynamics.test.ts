import { describe, it, expect } from "vitest";
import { BodyDynamics, BODY_TUNING, WeaponSway, type BodyInput } from "../bodyDynamics";

const DT = 1 / 60;

function input(over: Partial<BodyInput> = {}): BodyInput {
  return { vx: 0, vz: 0, yaw: 0, grounded: true, vy: 0, gaitPhase: 0, alive: true, ...over };
}

function run(b: BodyDynamics, seconds: number, fn: (t: number) => Partial<BodyInput>, each?: (b: BodyDynamics, t: number) => void): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    b.update(DT, input(fn(i * DT)));
    each?.(b, i * DT);
  }
}

describe("BodyDynamics lean", () => {
  it("leans forward when accelerating and back when braking, upright at a steady speed", () => {
    const b = new BodyDynamics();
    let maxFwd = 0;
    run(b, 0.6, (t) => ({ vz: Math.min(6, t * 8) }), (s) => (maxFwd = Math.max(maxFwd, s.pitch)));
    expect(maxFwd).toBeGreaterThan(0.05);
    run(b, 2, () => ({ vz: 6 }));
    expect(Math.abs(b.pitch)).toBeLessThan(0.01);
    let maxBack = 0;
    run(b, 0.5, (t) => ({ vz: Math.max(0, 6 - t * 12) }), (s) => (maxBack = Math.min(maxBack, s.pitch)));
    expect(maxBack).toBeLessThan(-0.05);
  });

  it("overshoots forward and settles after a hard stop", () => {
    const b = new BodyDynamics();
    run(b, 2, () => ({ vz: 6 }));
    run(b, 0.5, (t) => ({ vz: Math.max(0, 6 - t * 12) }));
    let maxAfter = 0;
    run(b, 1, () => ({ vz: 0 }), (s) => (maxAfter = Math.max(maxAfter, s.pitch)));
    expect(maxAfter).toBeGreaterThan(0.005);
    run(b, 2, () => ({ vz: 0 }));
    expect(Math.abs(b.pitch)).toBeLessThan(0.003);
  });

  it("ignores the facing direction: a sideways acceleration does not pitch the body", () => {
    const b = new BodyDynamics();
    let maxPitch = 0;
    run(b, 0.5, (t) => ({ vx: Math.min(2.3, t * 6) }), (s) => (maxPitch = Math.max(maxPitch, Math.abs(s.pitch))));
    expect(maxPitch).toBeLessThan(0.01);
  });
});

describe("BodyDynamics banking", () => {
  it("banks into a left turn (lean left > 0) and is capped", () => {
    const b = new BodyDynamics();
    const v = 6.5;
    const w = 2.5; // rad/s: a tight sprinting turn
    let max = 0;
    run(
      b,
      1.5,
      (t) => ({ vx: Math.sin(w * t) * v, vz: Math.cos(w * t) * v, yaw: w * t }),
      (s) => (max = Math.max(max, s.roll)),
    );
    expect(max).toBeGreaterThan(0.05);
    expect(max).toBeLessThanOrEqual(BODY_TUNING.bankMax + 1e-6);
  });

  it("banks the other way in a right turn and not at all on a straight line", () => {
    const b = new BodyDynamics();
    run(b, 1, (t) => ({ vx: -Math.sin(1.5 * t) * 4, vz: Math.cos(1.5 * t) * 4, yaw: -1.5 * t }));
    expect(b.roll).toBeLessThan(-0.02);
    const c = new BodyDynamics();
    run(c, 1.5, () => ({ vz: 4 }));
    expect(Math.abs(c.roll)).toBeLessThan(1e-3);
  });
});

describe("BodyDynamics pelvis", () => {
  it("dips on landing in proportion to the fall speed, capped, then recovers", () => {
    const dip = (fall: number) => {
      const b = new BodyDynamics();
      b.update(DT, input({ grounded: false, vy: -fall }));
      let min = 0;
      run(b, 0.6, () => ({}), (s) => (min = Math.min(min, s.pelvisY)));
      run(b, 2, () => ({}));
      expect(Math.abs(b.pelvisY)).toBeLessThan(0.002);
      return min;
    };
    const small = dip(3);
    const big = dip(8);
    expect(small).toBeLessThan(-0.01);
    expect(big).toBeLessThan(small);
    expect(dip(40)).toBeGreaterThanOrEqual(-BODY_TUNING.landMaxDip - 1e-6);
  });

  it("bobs with the gait only while moving", () => {
    const b = new BodyDynamics();
    run(b, 1, (t) => ({ gaitPhase: (t * 1.3) % 1 }));
    expect(Math.abs(b.pelvisY)).toBeLessThan(1e-4);
    let min = 0;
    run(b, 1, (t) => ({ vz: 6, gaitPhase: (t * 2) % 1 }), (s) => (min = Math.min(min, s.pelvisY)));
    expect(min).toBeLessThan(-0.003);
    expect(min).toBeGreaterThan(-0.05);
  });
});

describe("BodyDynamics breathing", () => {
  it("breathes gently at rest and harder after a sprint", () => {
    const b = new BodyDynamics();
    let calm = 0;
    run(b, 6, () => ({}), (s) => (calm = Math.max(calm, Math.abs(s.breath))));
    expect(calm).toBeGreaterThan(0.003);
    run(b, 8, () => ({ vz: 6.6 }));
    let winded = 0;
    run(b, 3, () => ({}), (s) => (winded = Math.max(winded, Math.abs(s.breath))));
    expect(winded).toBeGreaterThan(calm * 1.5);
  });
});

describe("BodyDynamics death", () => {
  it("relaxes every layer to zero once dead", () => {
    const b = new BodyDynamics();
    run(b, 0.4, (t) => ({ vz: t * 10, vx: Math.sin(t * 9) * 3 }));
    run(b, 3, () => ({ alive: false }));
    expect(Math.abs(b.pitch)).toBeLessThan(1e-3);
    expect(Math.abs(b.roll)).toBeLessThan(1e-3);
    expect(Math.abs(b.pelvisY)).toBeLessThan(1e-3);
    expect(Math.abs(b.breath)).toBeLessThan(1e-3);
  });
});

describe("WeaponSway", () => {
  it("lags behind camera turns (opposite sign), stays small and recovers", () => {
    const s = new WeaponSway();
    for (let i = 0; i < 20; i++) s.update(DT, { yawRate: 4, pitchRate: -2, lateral: 0, speed: 0, gaitPhase: 0 });
    expect(s.yaw).toBeLessThan(0);
    expect(s.pitch).toBeGreaterThan(0);
    expect(Math.abs(s.yaw)).toBeLessThan(0.1);
    for (let i = 0; i < 200; i++) s.update(DT, { yawRate: 0, pitchRate: 0, lateral: 0, speed: 0, gaitPhase: 0 });
    expect(Math.abs(s.yaw)).toBeLessThan(1e-3);
    expect(Math.abs(s.pitch)).toBeLessThan(1e-3);
  });

  it("drifts against sideways motion by at most a couple of centimetres", () => {
    const s = new WeaponSway();
    for (let i = 0; i < 120; i++) s.update(DT, { yawRate: 0, pitchRate: 0, lateral: 2.3, speed: 2.3, gaitPhase: (i / 60) % 1 });
    expect(s.x).toBeLessThan(0);
    expect(Math.abs(s.x)).toBeLessThanOrEqual(0.025);
  });
});
