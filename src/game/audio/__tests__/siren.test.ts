import { describe, expect, it } from "vitest";
import { SIREN_HIGH_HZ, SIREN_LOW_HZ, SIREN_MAX_DISTANCE, SIREN_PERIOD, nearestSirens, sirenFrequency, sirenGain } from "../siren";

describe("sirenFrequency (two-tone hi-lo)", () => {
  it("holds the high tone for the first half of the cycle and the low tone for the second", () => {
    expect(sirenFrequency(0)).toBe(SIREN_HIGH_HZ);
    expect(sirenFrequency(SIREN_PERIOD * 0.49)).toBe(SIREN_HIGH_HZ);
    expect(sirenFrequency(SIREN_PERIOD * 0.51)).toBe(SIREN_LOW_HZ);
    expect(sirenFrequency(SIREN_PERIOD * 0.99)).toBe(SIREN_LOW_HZ);
  });

  it("repeats every period", () => {
    expect(sirenFrequency(SIREN_PERIOD * 5 + 0.1)).toBe(sirenFrequency(0.1));
  });

  it("uses a musical-ish interval (low tone a fourth-ish below the high one)", () => {
    expect(SIREN_HIGH_HZ / SIREN_LOW_HZ).toBeGreaterThan(1.2);
    expect(SIREN_HIGH_HZ / SIREN_LOW_HZ).toBeLessThan(1.45);
  });
});

describe("sirenGain", () => {
  it("is full at the listener and silent at the max distance", () => {
    expect(sirenGain(0)).toBe(1);
    expect(sirenGain(SIREN_MAX_DISTANCE)).toBe(0);
    expect(sirenGain(SIREN_MAX_DISTANCE * 2)).toBe(0);
  });

  it("falls off monotonically (quadratically)", () => {
    expect(sirenGain(SIREN_MAX_DISTANCE / 2)).toBeCloseTo(0.25);
    expect(sirenGain(10)).toBeGreaterThan(sirenGain(20));
  });
});

describe("nearestSirens", () => {
  it("keeps the closest audible sirens up to the voice budget", () => {
    const list = [
      { id: "a", distance: 50, pan: 0 },
      { id: "b", distance: 5, pan: 0 },
      { id: "c", distance: SIREN_MAX_DISTANCE + 1, pan: 0 },
      { id: "d", distance: 20, pan: 0 },
    ];
    expect(nearestSirens(list, 2).map((s) => s.id)).toEqual(["b", "d"]);
  });
});
