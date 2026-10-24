import { describe, expect, it } from "vitest";
import { FOOTSTEP_PROFILES, FootstepClock, ambienceMix, footstepGain, footstepRate, nextBirdDelay } from "../ambience";

describe("footstepRate", () => {
  it("is silent when (almost) standing still", () => {
    expect(footstepRate(0)).toBe(0);
    expect(footstepRate(0.2)).toBe(0);
  });

  it("walks at ~1.8 steps/s and sprints at ~2.9 steps/s, never above the cap", () => {
    expect(footstepRate(2.3)).toBeGreaterThan(1.6);
    expect(footstepRate(2.3)).toBeLessThan(2);
    expect(footstepRate(6.6)).toBeGreaterThan(2.7);
    expect(footstepRate(6.6)).toBeLessThan(3.1);
    expect(footstepRate(40)).toBeLessThanOrEqual(3.3);
  });
});

describe("FootstepClock", () => {
  it("fires at the walking cadence over time (independent of dt)", () => {
    for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
      const c = new FootstepClock();
      let steps = 0;
      for (let t = 0; t < 10; t += dt) if (c.step(dt, 2.3, true) === "step") steps++;
      expect(steps).toBeGreaterThanOrEqual(Math.floor(footstepRate(2.3) * 10) - 1);
      expect(steps).toBeLessThanOrEqual(Math.ceil(footstepRate(2.3) * 10) + 1);
    }
  });

  it("puts the first step soon after starting to move", () => {
    const c = new FootstepClock();
    let t = 0;
    while (c.step(1 / 60, 2.3, true) !== "step") t += 1 / 60;
    expect(t).toBeLessThan(0.4);
  });

  it("stays silent in the air and reports a landing", () => {
    const c = new FootstepClock();
    c.step(1 / 60, 3, true);
    let fired = 0;
    for (let i = 0; i < 60; i++) if (c.step(1 / 60, 3, false) !== "none") fired++;
    expect(fired).toBe(0);
    expect(c.step(1 / 60, 3, true)).toBe("land");
  });

  it("does not report a landing on the very first grounded frame", () => {
    expect(new FootstepClock().step(1 / 60, 0, true)).toBe("none");
  });
});

describe("footstep profiles", () => {
  it("covers every surface; grass is softer and duller than asphalt; gravel crunches", () => {
    for (const k of ["asphalt", "pavement", "grass", "gravel"] as const) expect(FOOTSTEP_PROFILES[k]).toBeDefined();
    expect(FOOTSTEP_PROFILES.grass.gain).toBeLessThan(FOOTSTEP_PROFILES.asphalt.gain);
    expect(FOOTSTEP_PROFILES.grass.noiseHz).toBeLessThan(FOOTSTEP_PROFILES.asphalt.noiseHz);
    expect(FOOTSTEP_PROFILES.gravel.grains).toBeGreaterThan(0);
    expect(FOOTSTEP_PROFILES.asphalt.grains).toBe(0);
  });

  it("running steps are louder than walking ones; landings louder still", () => {
    expect(footstepGain(6.6, false)).toBeGreaterThan(footstepGain(2.3, false));
    expect(footstepGain(2.3, true)).toBeGreaterThan(footstepGain(6.6, false));
  });
});

describe("ambienceMix", () => {
  it("is all day at noon and all night at midnight (equal-power crossfade)", () => {
    const day = ambienceMix(0, 0, 0);
    expect(day.day).toBeCloseTo(1);
    expect(day.night).toBeCloseTo(0);
    const night = ambienceMix(1, 0, 0);
    expect(night.day).toBeCloseTo(0);
    expect(night.night).toBeCloseTo(1);
    const dusk = ambienceMix(0.5, 0, 0);
    expect(dusk.day ** 2 + dusk.night ** 2).toBeCloseTo(1);
  });

  it("wind grows with altitude and speed, within 0..1", () => {
    const calm = ambienceMix(0, 0, 0).wind;
    expect(ambienceMix(0, 25, 0).wind).toBeGreaterThan(calm);
    expect(ambienceMix(0, 0, 30).wind).toBeGreaterThan(calm);
    expect(ambienceMix(0, 1000, 1000).wind).toBeLessThanOrEqual(1);
    expect(calm).toBeGreaterThan(0);
  });
});

describe("nextBirdDelay", () => {
  it("spaces bird calls a few seconds apart", () => {
    expect(nextBirdDelay(0)).toBeGreaterThanOrEqual(1.5);
    expect(nextBirdDelay(0.999)).toBeLessThanOrEqual(9);
  });
});
