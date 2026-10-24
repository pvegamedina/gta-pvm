import { describe, expect, it } from "vitest";
import {
  HEADLIGHTS_ON_NIGHT,
  SIREN_FLASH_PERIOD,
  advanceWheelSpin,
  sirenFlash,
  vehicleLightState,
  type LightInputs,
} from "../animation";

const TAU = Math.PI * 2;

describe("advanceWheelSpin", () => {
  it("rolls the wheel by distance / radius", () => {
    expect(advanceWheelSpin(0, 10, 0.1, 0.5)).toBeCloseTo(2);
  });

  it("spins backwards when reversing", () => {
    expect(advanceWheelSpin(1, -5, 0.1, 0.25)).toBeCloseTo(1 - 2 + TAU);
  });

  it("stays wrapped to [0, 2π) so long drives do not lose float precision", () => {
    let a = 0;
    for (let i = 0; i < 100000; i++) a = advanceWheelSpin(a, 50, 1 / 60, 0.3);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(TAU);
  });

  it("does not move a parked wheel or break on a zero radius", () => {
    expect(advanceWheelSpin(0.5, 0, 0.1, 0.3)).toBeCloseTo(0.5);
    expect(advanceWheelSpin(0.5, 10, 0.1, 0)).toBeCloseTo(0.5);
  });
});

describe("vehicleLightState", () => {
  const base: LightInputs = { nightF: 0, braking: false, speed: 10, mode: "ai" };

  it("is all off by day while cruising", () => {
    expect(vehicleLightState(base)).toEqual({ head: false, tail: "off", reverse: false });
  });

  it("turns head and tail (running) lights on at night", () => {
    expect(vehicleLightState({ ...base, nightF: 1 })).toEqual({ head: true, tail: "run", reverse: false });
    expect(vehicleLightState({ ...base, nightF: HEADLIGHTS_ON_NIGHT - 0.01 }).head).toBe(false);
    expect(vehicleLightState({ ...base, nightF: HEADLIGHTS_ON_NIGHT }).head).toBe(true);
  });

  it("brightens the brake lights when braking, day or night", () => {
    expect(vehicleLightState({ ...base, braking: true }).tail).toBe("brake");
    expect(vehicleLightState({ ...base, braking: true, nightF: 1 }).tail).toBe("brake");
  });

  it("lights the reverse lamps while moving backwards", () => {
    expect(vehicleLightState({ ...base, speed: -2 }).reverse).toBe(true);
    expect(vehicleLightState({ ...base, speed: -0.1 }).reverse).toBe(false);
  });

  it("keeps a parked car dark", () => {
    expect(vehicleLightState({ nightF: 1, braking: true, speed: -3, mode: "parked" })).toEqual({ head: false, tail: "off", reverse: false });
  });
});

describe("sirenFlash", () => {
  it("alternates red and blue halves of the period, never both at once", () => {
    let red = 0;
    let blue = 0;
    for (let i = 0; i < 600; i++) {
      const f = sirenFlash((i / 600) * SIREN_FLASH_PERIOD);
      expect(f.red && f.blue).toBe(false);
      if (f.red) red++;
      if (f.blue) blue++;
      if (f.red) expect(i).toBeLessThan(300);
      if (f.blue) expect(i).toBeGreaterThanOrEqual(300);
    }
    expect(red).toBeGreaterThan(100);
    // Same duty cycle for both colours (±1 sample of float rounding at the edges).
    expect(Math.abs(red - blue)).toBeLessThanOrEqual(1);
  });

  it("double-flashes each colour (two separate on pulses per half)", () => {
    let pulses = 0;
    let prev = false;
    for (let i = 0; i < 300; i++) {
      const on = sirenFlash((i / 600) * SIREN_FLASH_PERIOD).red;
      if (on && !prev) pulses++;
      prev = on;
    }
    expect(pulses).toBe(2);
  });

  it("repeats every period", () => {
    for (const t of [0.01, 0.1, 0.37, 0.55]) expect(sirenFlash(t + 3 * SIREN_FLASH_PERIOD)).toEqual(sirenFlash(t));
  });
});
