import { describe, it, expect } from "vitest";
import { TurnInPlace, TURN_TUNING } from "../turnInPlace";
import { angDiff } from "../../core/math";

const DT = 1 / 60;
const deg = (d: number) => (d * Math.PI) / 180;

function run(t: TurnInPlace, target: number, speed: number, seconds: number, each?: (t: TurnInPlace) => void): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    t.update(DT, target, speed);
    each?.(t);
  }
}

describe("TurnInPlace", () => {
  it("absorbs small facing changes with upper-body twist while the feet stay put", () => {
    const t = new TurnInPlace(0);
    run(t, deg(40), 0, 0.5);
    expect(t.bodyYaw).toBeCloseTo(0, 9);
    expect(t.twist).toBeCloseTo(deg(40), 9);
    expect(t.turnRate).toBe(0);
    expect(t.turning).toBe(false);
  });

  it("steps the lower body round once the twist passes the trigger angle", () => {
    const t = new TurnInPlace(0);
    let sawTurning = false;
    let maxRate = 0;
    run(t, deg(100), 0, 1.2, (s) => {
      sawTurning ||= s.turning;
      maxRate = Math.max(maxRate, Math.abs(s.turnRate));
      expect(Math.abs(s.twist)).toBeLessThanOrEqual(TURN_TUNING.maxTwist + 1e-9);
    });
    expect(sawTurning).toBe(true);
    expect(maxRate).toBeGreaterThan(1);
    expect(Math.abs(t.twist)).toBeLessThanOrEqual(TURN_TUNING.settleAngle + 1e-9);
    expect(t.turning).toBe(false);
    expect(t.turnRate).toBe(0);
  });

  it("turns the shorter way across the ±π seam", () => {
    const t = new TurnInPlace(deg(170));
    run(t, deg(-110), 0, 1.5);
    expect(Math.abs(angDiff(t.bodyYaw, deg(-110)))).toBeLessThan(TURN_TUNING.settleAngle + 1e-9);
  });

  it("never lets the upper body twist past the limit, even for an instant 180° flick", () => {
    const t = new TurnInPlace(0);
    t.update(DT, Math.PI - 0.01, 0);
    expect(Math.abs(t.twist)).toBeLessThanOrEqual(TURN_TUNING.maxTwist + 1e-9);
  });

  it("follows the facing quickly (hips lagging slightly) while moving", () => {
    const t = new TurnInPlace(0);
    t.update(DT, deg(60), 3);
    expect(t.twist).toBeGreaterThan(deg(30));
    run(t, deg(60), 3, 0.35);
    expect(Math.abs(t.twist)).toBeLessThan(deg(3));
  });

  it("slowly realigns a moderate twist held for a while", () => {
    const t = new TurnInPlace(0);
    run(t, deg(40), 0, TURN_TUNING.relaxDelay * 0.8);
    expect(t.bodyYaw).toBeCloseTo(0, 9);
    run(t, deg(40), 0, TURN_TUNING.relaxDelay + 1);
    expect(Math.abs(t.twist)).toBeLessThan(TURN_TUNING.settleAngle + 1e-9);
  });

  it("is roughly framerate independent", () => {
    const a = new TurnInPlace(0);
    const b = new TurnInPlace(0);
    for (let i = 0; i < 60; i++) a.update(1 / 60, deg(120), 0);
    for (let i = 0; i < 144; i++) b.update(1 / 144, deg(120), 0);
    expect(Math.abs(a.bodyYaw - b.bodyYaw)).toBeLessThan(deg(4));
  });

  it("reset() snaps the lower body to a yaw with no twist", () => {
    const t = new TurnInPlace(0);
    run(t, deg(50), 0, 0.2);
    t.reset(deg(50));
    expect(t.twist).toBe(0);
    expect(t.turning).toBe(false);
  });
});
