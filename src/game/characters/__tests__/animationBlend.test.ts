import { describe, it, expect } from "vitest";
import {
  damp,
  locomotionWeights,
  gaitRate,
  oneShotWeight,
  leanFromAccel,
  DwellFlag,
  WALK_FULL_SPEED,
  RUN_FULL_SPEED,
  WALK_STRIDE,
  RUN_STRIDE,
  MAX_LEAN,
} from "../animationBlend";
import { FOOT_TUNING } from "../../player/footMotion";

describe("damp", () => {
  it("converges to the target", () => {
    let v = 0;
    for (let i = 0; i < 120; i++) v = damp(v, 5, 0.15, 1 / 60);
    expect(v).toBeCloseTo(5, 3);
  });

  it("is framerate-independent", () => {
    let fine = 0;
    for (let i = 0; i < 10; i++) fine = damp(fine, 1, 0.2, 0.01);
    const coarse = damp(0, 1, 0.2, 0.1);
    expect(fine).toBeCloseTo(coarse, 10);
  });

  it("does nothing for dt = 0 and snaps when tau is 0", () => {
    expect(damp(2, 9, 0.1, 0)).toBe(2);
    expect(damp(2, 9, 0, 0.016)).toBe(9);
  });
});

describe("locomotionWeights", () => {
  const sum = (w: { idle: number; walk: number; run: number }) => w.idle + w.walk + w.run;

  it("always sums to 1 with non-negative weights", () => {
    for (let s = 0; s <= 10; s += 0.05) {
      const w = locomotionWeights(s);
      expect(sum(w)).toBeCloseTo(1, 9);
      expect(Math.min(w.idle, w.walk, w.run)).toBeGreaterThanOrEqual(0);
    }
  });

  it("is pure idle when still, pure walk at walking pace, pure run when fast", () => {
    expect(locomotionWeights(0).idle).toBe(1);
    expect(locomotionWeights(WALK_FULL_SPEED).walk).toBeCloseTo(1, 9);
    expect(locomotionWeights(RUN_FULL_SPEED).run).toBeCloseTo(1, 9);
    expect(locomotionWeights(7.2).run).toBeCloseTo(1, 9);
  });

  it("is continuous (no pops) across the whole speed range", () => {
    const eps = 1e-3;
    for (let s = 0; s <= 8; s += 0.01) {
      const a = locomotionWeights(s);
      const b = locomotionWeights(s + eps);
      expect(Math.abs(a.idle - b.idle) + Math.abs(a.walk - b.walk) + Math.abs(a.run - b.run)).toBeLessThan(0.01);
    }
  });
});

describe("gaitRate", () => {
  it("cycles faster the faster the character moves", () => {
    expect(gaitRate(1.4)).toBeGreaterThan(gaitRate(0.8));
    expect(gaitRate(7.2)).toBeGreaterThan(gaitRate(3.4));
    expect(gaitRate(0)).toBeGreaterThan(0);
  });

  it("changes smoothly through the walk/run crossover", () => {
    for (let s = 0; s <= 8; s += 0.01) {
      expect(Math.abs(gaitRate(s + 1e-3) - gaitRate(s))).toBeLessThan(0.01);
    }
  });
});

describe("locomotion thresholds vs. the player's speeds", () => {
  it("shows a pure walk at cruising speed and a pure run when sprinting", () => {
    expect(locomotionWeights(FOOT_TUNING.walkSpeed).walk).toBeCloseTo(1, 9);
    expect(locomotionWeights(FOOT_TUNING.runSpeed).run).toBeCloseTo(1, 9);
  });

  it("spreads the walk -> run crossfade over the sprint build-up", () => {
    // Speeds strictly between walk and sprint are a mix of both clips.
    const mid = locomotionWeights((FOOT_TUNING.walkSpeed + FOOT_TUNING.runSpeed) / 2);
    expect(mid.walk).toBeGreaterThan(0.05);
    expect(mid.run).toBeGreaterThan(0.05);
  });
});

describe("gaitRate stride matching", () => {
  it("advances the cycle exactly one stride per stride length travelled (no foot sliding)", () => {
    expect(gaitRate(FOOT_TUNING.walkSpeed) * WALK_STRIDE).toBeCloseTo(FOOT_TUNING.walkSpeed, 6);
    expect(gaitRate(FOOT_TUNING.runSpeed) * RUN_STRIDE).toBeCloseTo(FOOT_TUNING.runSpeed, 6);
    expect(gaitRate(1.4) * WALK_STRIDE).toBeCloseTo(1.4, 6);
  });

  it("keeps playback within a believable tempo at the extremes", () => {
    expect(gaitRate(0)).toBeGreaterThan(0.3);
    expect(gaitRate(20)).toBeLessThan(3);
  });
});

describe("leanFromAccel", () => {
  it("leans forward when speeding up, back when braking, upright when steady", () => {
    expect(leanFromAccel(0)).toBe(0);
    expect(leanFromAccel(4)).toBeGreaterThan(0);
    expect(leanFromAccel(-4)).toBeLessThan(0);
    expect(leanFromAccel(-3)).toBeCloseTo(-leanFromAccel(3), 12);
  });

  it("is monotonic and saturates at MAX_LEAN (subtle)", () => {
    for (let a = -30; a < 30; a += 0.1) expect(leanFromAccel(a + 0.1)).toBeGreaterThanOrEqual(leanFromAccel(a));
    expect(leanFromAccel(100)).toBeCloseTo(MAX_LEAN, 9);
    expect(leanFromAccel(-100)).toBeCloseTo(-MAX_LEAN, 9);
    expect(MAX_LEAN).toBeLessThan(0.25);
  });
});

describe("oneShotWeight", () => {
  it("fades in, holds, then fades out to zero at the end", () => {
    expect(oneShotWeight(0, 1, 0.1, 0.15)).toBe(0);
    expect(oneShotWeight(0.05, 1, 0.1, 0.15)).toBeCloseTo(0.5, 5);
    expect(oneShotWeight(0.5, 1, 0.1, 0.15)).toBe(1);
    expect(oneShotWeight(1, 1, 0.1, 0.15)).toBe(0);
    expect(oneShotWeight(2, 1, 0.1, 0.15)).toBe(0);
  });

  it("never exceeds 1 even when the fades overlap (very short clips)", () => {
    for (let t = 0; t <= 0.2; t += 0.005) expect(oneShotWeight(t, 0.2, 0.15, 0.15)).toBeLessThanOrEqual(1);
  });

  it("is held at full weight when the clip clamps at its end (no fade-out)", () => {
    expect(oneShotWeight(5, 1, 0.2, 0)).toBe(1);
  });
});

describe("DwellFlag", () => {
  it("reacts immediately to the first change", () => {
    const f = new DwellFlag(false, 0.15);
    expect(f.update(true, 1 / 60)).toBe(true);
  });

  it("ignores flicker within the minimum dwell time", () => {
    const f = new DwellFlag(false, 0.15);
    f.update(true, 1 / 60);
    expect(f.update(false, 1 / 60)).toBe(true);
    expect(f.update(true, 1 / 60)).toBe(true);
    expect(f.update(false, 0.05)).toBe(true);
  });

  it("accepts a change once the state has dwelt long enough", () => {
    const f = new DwellFlag(false, 0.15);
    f.update(true, 1 / 60);
    f.update(true, 0.2);
    expect(f.update(false, 1 / 60)).toBe(false);
  });
});
