import { describe, it, expect } from "vitest";
import {
  CharacterAnimState,
  AttackTimers,
  PUNCH_DURATION,
  SHOT_HOLD,
  ANIM_CLIPS,
  GAIT_PHASE_OFFSET,
  type BlendInput,
  type ClipName,
} from "../animationState";

const DT = 1 / 60;
// Real clip lengths of the Quaternius characters (seconds).
const DURATIONS: Record<ClipName, number> = {
  Idle: 1.67,
  Idle_Gun: 1.67,
  Idle_Gun_Pointing: 1.67,
  Idle_Gun_Shoot: 0.67,
  Walk: 1.33,
  Run: 0.8,
  Run_Shoot: 0.83,
  Death: 1.07,
  Punch_Left: 0.83,
  Punch_Right: 0.83,
};
const still: BlendInput = { speed: 0, armed: false, aiming: false, alive: true };

function sumWeights(s: CharacterAnimState): number {
  return ANIM_CLIPS.reduce((acc, c) => acc + s.weight(c), 0);
}

/**
 * Runs updates with `input`, asserting the blend stays normalised and never
 * pops: no clip weight may change by more than `maxStep` in one 60 fps frame
 * (a hard switch would be a step of 1), even for instant input changes.
 */
function run(s: CharacterAnimState, input: BlendInput, seconds: number, maxStep = 0.3): void {
  const frames = Math.round(seconds / DT);
  for (let i = 0; i < frames; i++) {
    const before = ANIM_CLIPS.map((c) => s.weight(c));
    s.update(DT, input);
    ANIM_CLIPS.forEach((c, k) => expect(Math.abs(s.weight(c) - before[k])).toBeLessThan(maxStep));
    expect(sumWeights(s)).toBeCloseTo(1, 6);
  }
}

describe("CharacterAnimState", () => {
  it("starts fully idle", () => {
    const s = new CharacterAnimState(DURATIONS);
    expect(s.weight("Idle")).toBe(1);
    expect(sumWeights(s)).toBeCloseTo(1, 9);
  });

  it("morphs idle -> walk -> run smoothly as speed changes", () => {
    const s = new CharacterAnimState(DURATIONS);
    run(s, { ...still, speed: 1.4 }, 1, 0.2);
    expect(s.weight("Walk")).toBeGreaterThan(0.9);
    run(s, { ...still, speed: 3.4 }, 0.5, 0.2);
    run(s, { ...still, speed: 7.2 }, 1, 0.2);
    expect(s.weight("Run")).toBeGreaterThan(0.9);
    run(s, still, 1.2, 0.2);
    expect(s.weight("Idle")).toBeGreaterThan(0.9);
  });

  it("keeps walk and run on the same (offset) gait phase so feet don't pop", () => {
    const s = new CharacterAnimState(DURATIONS);
    run(s, { ...still, speed: 2.5 }, 0.73);
    const walk = s.clipTime("Walk") / DURATIONS.Walk;
    const runN = s.clipTime("Run") / DURATIONS.Run;
    const expected = (walk + GAIT_PHASE_OFFSET.Run! - GAIT_PHASE_OFFSET.Walk! + 1) % 1;
    expect(runN).toBeCloseTo(expected, 6);
  });

  it("blends in the gun idle and the aiming pose without flicker", () => {
    const s = new CharacterAnimState(DURATIONS);
    run(s, { ...still, armed: true }, 1);
    expect(s.weight("Idle_Gun")).toBeGreaterThan(0.9);
    run(s, { ...still, armed: true, aiming: true }, 1);
    expect(s.weight("Idle_Gun_Pointing")).toBeGreaterThan(0.9);
    run(s, { ...still, armed: true, aiming: true, speed: 3.4 }, 1);
    expect(s.weight("Run_Shoot")).toBeGreaterThan(0.9);
  });

  it("smooths a noisy (remote-interpolated) speed", () => {
    const s = new CharacterAnimState(DURATIONS);
    run(s, { ...still, speed: 1 }, 1);
    for (let i = 0; i < 120; i++) {
      const before = s.weight("Walk");
      s.update(DT, { ...still, speed: i % 2 ? 0.4 : 1.6 });
      expect(Math.abs(s.weight("Walk") - before)).toBeLessThan(0.06);
    }
  });

  it("ignores aiming flicker shorter than the dwell time", () => {
    const s = new CharacterAnimState(DURATIONS);
    run(s, { ...still, armed: true }, 1);
    s.update(DT, { ...still, armed: true, aiming: true });
    for (let i = 0; i < 6; i++) s.update(DT, { ...still, armed: true, aiming: i % 2 === 0 ? false : true });
    run(s, { ...still, armed: true, aiming: true }, 0.5);
    expect(s.weight("Idle_Gun_Pointing")).toBeGreaterThan(0.8);
  });

  it("plays a punch as a soft one-shot and returns to the locomotion blend", () => {
    const s = new CharacterAnimState(DURATIONS);
    run(s, still, 0.5);
    s.trigger("fists");
    run(s, still, 0.2);
    expect(s.weight("Punch_Right")).toBeGreaterThan(0.8);
    run(s, still, 0.6);
    expect(s.weight("Punch_Right")).toBe(0);
    expect(s.weight("Idle")).toBeGreaterThan(0.99);
    s.trigger("fists");
    run(s, still, 0.2);
    expect(s.weight("Punch_Left")).toBeGreaterThan(0.8);
  });

  it("adds a recoil one-shot when firing while standing", () => {
    const s = new CharacterAnimState(DURATIONS);
    run(s, { ...still, armed: true, aiming: true }, 1);
    s.trigger("pistol");
    run(s, { ...still, armed: true, aiming: true }, 0.15);
    expect(s.weight("Idle_Gun_Shoot")).toBeGreaterThan(0.5);
    // Rapid automatic fire keeps blending instead of restarting with a pop.
    for (let i = 0; i < 20; i++) {
      s.trigger("m4");
      run(s, { ...still, armed: true, aiming: true }, 0.1);
    }
  });

  it("raises the gun for a moment when hip-firing", () => {
    const s = new CharacterAnimState(DURATIONS);
    run(s, { ...still, armed: true }, 1);
    for (let i = 0; i < 4; i++) {
      s.trigger("pistol");
      run(s, { ...still, armed: true }, 0.25);
    }
    expect(s.weight("Idle_Gun_Pointing") + s.weight("Idle_Gun_Shoot")).toBeGreaterThan(0.6);
  });

  it("fades into Death, clamps on its last frame, and fades back out on respawn", () => {
    const s = new CharacterAnimState(DURATIONS);
    run(s, { ...still, speed: 3.4 }, 1);
    run(s, { ...still, alive: false }, 0.3);
    expect(s.weight("Death")).toBeGreaterThan(0.99);
    run(s, { ...still, alive: false }, 2);
    expect(s.clipTime("Death")).toBeLessThan(DURATIONS.Death);
    expect(s.clipTime("Death")).toBeGreaterThan(DURATIONS.Death - 0.01);
    run(s, still, 1);
    expect(s.weight("Death")).toBe(0);
    expect(s.weight("Idle")).toBeGreaterThan(0.9);
  });
});

describe("AttackTimers (procedural fallback rig)", () => {
  it("alternates punching hands and expires the punch after its duration", () => {
    const t = new AttackTimers();
    expect(t.punch).toBeNull();
    t.trigger("fists");
    const first = t.punch;
    expect(first).not.toBeNull();
    t.tick(PUNCH_DURATION + 0.01);
    expect(t.punch).toBeNull();
    t.trigger("fists");
    expect(t.punch).not.toBe(first);
  });

  it("holds the shooting flag briefly after a gunshot", () => {
    const t = new AttackTimers();
    t.trigger("pistol");
    expect(t.shooting).toBe(true);
    t.tick(SHOT_HOLD + 0.01);
    expect(t.shooting).toBe(false);
  });
});
