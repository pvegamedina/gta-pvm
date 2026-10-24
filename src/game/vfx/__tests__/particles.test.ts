import { describe, expect, it } from "vitest";
import { ParticleBuffer } from "../particles";

const puff = { life: 1, size0: 0.2, size1: 1.2, alpha: 0.6, r: 0.5, g: 0.5, b: 0.5 };

describe("ParticleBuffer", () => {
  it("is bounded: spawning past capacity recycles the oldest", () => {
    const p = new ParticleBuffer(4);
    for (let i = 0; i < 10; i++) p.spawn(i, 0, 0, 0, 0, 0, puff);
    expect(p.alive()).toBe(4);
    // The survivors are the four newest (x = 6..9).
    const xs = [];
    for (let i = 0; i < 4; i++) xs.push(p.position[i * 3]);
    expect(xs.sort((a, b) => a - b)).toEqual([6, 7, 8, 9]);
  });

  it("moves particles with their velocity, slows them with drag and lifts them with buoyancy", () => {
    const p = new ParticleBuffer(2);
    p.spawn(0, 0, 0, 4, 0, 0, puff);
    p.step(0.1, 2, 1);
    expect(p.position[0]).toBeGreaterThan(0.3);
    expect(p.position[0]).toBeLessThan(0.4);
    expect(p.velocity[0]).toBeLessThan(4);
    expect(p.velocity[1]).toBeGreaterThan(0);
  });

  it("grows and fades over its life, then dies", () => {
    const p = new ParticleBuffer(1);
    p.spawn(0, 0, 0, 0, 0, 0, puff);
    p.step(0.01, 0, 0);
    const s0 = p.size[0];
    p.step(0.5, 0, 0);
    expect(p.size[0]).toBeGreaterThan(s0);
    expect(p.alpha[0]).toBeLessThan(0.6);
    expect(p.alpha[0]).toBeGreaterThan(0);
    p.step(0.6, 0, 0);
    expect(p.alpha[0]).toBe(0);
    expect(p.alive()).toBe(0);
  });

  it("clear() kills everything", () => {
    const p = new ParticleBuffer(3);
    p.spawn(0, 0, 0, 0, 0, 0, puff);
    p.clear();
    expect(p.alive()).toBe(0);
    expect(p.alpha[0]).toBe(0);
  });
});
