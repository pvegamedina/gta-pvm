import { describe, it, expect } from "vitest";
import { SpringDamper } from "../spring";

describe("SpringDamper", () => {
  for (const damping of [0.35, 1, 1.8]) {
    it(`is framerate independent for a constant target (zeta ${damping})`, () => {
      const a = new SpringDamper(3, damping, 0.4);
      const b = new SpringDamper(3, damping, 0.4);
      a.velocity = b.velocity = -1.2;
      for (let i = 0; i < 12; i++) a.update(1 / 120, 1);
      b.update(12 / 120, 1);
      expect(a.value).toBeCloseTo(b.value, 9);
      expect(a.velocity).toBeCloseTo(b.velocity, 9);
    });

    it(`settles on the target (zeta ${damping})`, () => {
      const s = new SpringDamper(2.5, damping);
      for (let i = 0; i < 600; i++) s.update(1 / 60, -0.7);
      expect(s.value).toBeCloseTo(-0.7, 5);
      expect(Math.abs(s.velocity)).toBeLessThan(1e-4);
    });
  }

  it("never overshoots when critically damped", () => {
    const s = new SpringDamper(4, 1);
    let max = 0;
    for (let i = 0; i < 240; i++) max = Math.max(max, s.update(1 / 60, 1));
    expect(max).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("overshoots (settle) when underdamped", () => {
    const s = new SpringDamper(4, 0.4);
    let max = 0;
    for (let i = 0; i < 240; i++) max = Math.max(max, s.update(1 / 60, 1));
    expect(max).toBeGreaterThan(1.1);
  });

  it("a velocity kick displaces it and it comes back to rest", () => {
    const s = new SpringDamper(3, 0.6);
    s.kick(-2);
    let min = 0;
    for (let i = 0; i < 30; i++) min = Math.min(min, s.update(1 / 60, 0));
    expect(min).toBeLessThan(-0.05);
    for (let i = 0; i < 400; i++) s.update(1 / 60, 0);
    expect(Math.abs(s.value)).toBeLessThan(1e-4);
  });

  it("does nothing for dt <= 0 and resets cleanly", () => {
    const s = new SpringDamper(3, 1, 0.5);
    s.velocity = 2;
    s.update(0, 1);
    expect(s.value).toBe(0.5);
    expect(s.velocity).toBe(2);
    s.reset(0.2);
    expect(s.value).toBe(0.2);
    expect(s.velocity).toBe(0);
  });

  it("stays finite for huge steps (stiff spring, long frame)", () => {
    const s = new SpringDamper(12, 0.5, 3);
    s.update(5, 0);
    expect(Number.isFinite(s.value)).toBe(true);
    expect(Math.abs(s.value)).toBeLessThan(1e-6);
  });
});
