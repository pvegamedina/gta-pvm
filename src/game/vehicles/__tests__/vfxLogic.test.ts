import { describe, expect, it } from "vitest";
import { EmissionAccumulator, SkidEmitter, dustAmount, exhaustRate, tyreSlip, SKID_THRESHOLD } from "../vfxLogic";

describe("tyreSlip", () => {
  it("is zero cruising straight", () => {
    expect(tyreSlip({ lateral: 0.3, speed: 15, handbrake: false, hardBrake: 0 })).toBe(0);
  });

  it("rises with lateral sliding", () => {
    expect(tyreSlip({ lateral: 3, speed: 15, handbrake: false, hardBrake: 0 })).toBeGreaterThan(0.3);
    expect(tyreSlip({ lateral: 50, speed: 15, handbrake: false, hardBrake: 0 })).toBeLessThanOrEqual(1);
  });

  it("handbraking at speed skids; at a crawl it does not", () => {
    expect(tyreSlip({ lateral: 0, speed: 12, handbrake: true, hardBrake: 0 })).toBeGreaterThan(SKID_THRESHOLD);
    expect(tyreSlip({ lateral: 0, speed: 2, handbrake: true, hardBrake: 0 })).toBe(0);
  });

  it("hard service braking at speed leaves marks", () => {
    expect(tyreSlip({ lateral: 0, speed: 20, handbrake: false, hardBrake: 1 })).toBeGreaterThan(SKID_THRESHOLD);
    expect(tyreSlip({ lateral: 0, speed: 5, handbrake: false, hardBrake: 1 })).toBeLessThan(SKID_THRESHOLD);
  });
});

describe("exhaustRate", () => {
  it("idles gently and puffs much more under throttle from low speed", () => {
    const idle = exhaustRate(0, 0, 40);
    const launch = exhaustRate(1, 2, 40);
    const cruise = exhaustRate(1, 38, 40);
    expect(idle).toBeGreaterThan(0);
    expect(launch).toBeGreaterThan(idle * 4);
    expect(cruise).toBeLessThan(launch);
  });
});

describe("dustAmount", () => {
  it("only raises dust on loose ground when braking/sliding at speed", () => {
    expect(dustAmount("asphalt", 15, true, 0.8)).toBe(0);
    expect(dustAmount("pavement", 15, true, 0.8)).toBe(0);
    expect(dustAmount("grass", 15, true, 0)).toBeGreaterThan(0);
    expect(dustAmount("gravel", 15, false, 0.6)).toBeGreaterThan(0);
    expect(dustAmount("gravel", 1, true, 1)).toBe(0);
    expect(dustAmount("gravel", 15, false, 0)).toBe(0);
  });
});

describe("EmissionAccumulator", () => {
  it("turns a rate into whole particles with the fraction carried over", () => {
    const acc = new EmissionAccumulator();
    let n = 0;
    for (let i = 0; i < 60; i++) n += acc.take(10, 1 / 60);
    expect(n).toBeGreaterThanOrEqual(9);
    expect(n).toBeLessThanOrEqual(10);
  });

  it("caps the burst per call", () => {
    const acc = new EmissionAccumulator();
    expect(acc.take(1000, 1, 8)).toBe(8);
  });
});

describe("SkidEmitter", () => {
  it("emits a segment once the wheel moved a minimum distance while skidding", () => {
    const e = new SkidEmitter(0.4);
    expect(e.update(0, 0, true)).toBeNull();
    expect(e.update(0.2, 0, true)).toBeNull();
    const s = e.update(0.5, 0, true);
    expect(s).not.toBeNull();
    expect(s!.ax).toBe(0);
    expect(s!.bx).toBe(0.5);
    // Continues from the end of the last segment (a connected trail).
    const s2 = e.update(1, 0, true);
    expect(s2!.ax).toBe(0.5);
  });

  it("breaks the trail when the skid stops", () => {
    const e = new SkidEmitter(0.4);
    e.update(0, 0, true);
    e.update(1, 0, true);
    expect(e.update(2, 0, false)).toBeNull();
    expect(e.update(3, 0, true)).toBeNull();
    const s = e.update(3.5, 0, true);
    expect(s!.ax).toBe(3);
  });

  it("drops a teleport-sized jump instead of drawing a huge streak", () => {
    const e = new SkidEmitter(0.4);
    e.update(0, 0, true);
    expect(e.update(50, 0, true)).toBeNull();
    expect(e.update(50.5, 0, true)!.ax).toBe(50);
  });
});
