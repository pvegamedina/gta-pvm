import { describe, it, expect } from "vitest";
import { directionalWeights, localDirection, gaitRate, STRAFE_STRIDE, WALK_STRIDE } from "../animationBlend";

const sum = (w: { fwd: number; back: number; left: number; right: number }) => w.fwd + w.back + w.left + w.right;

describe("directionalWeights", () => {
  it("is pure forward / back / left / right on the axes (left = +X local)", () => {
    expect(directionalWeights(0, 1).fwd).toBeCloseTo(1, 9);
    expect(directionalWeights(0, -1).back).toBeCloseTo(1, 9);
    expect(directionalWeights(1, 0).left).toBeCloseTo(1, 9);
    expect(directionalWeights(-1, 0).right).toBeCloseTo(1, 9);
  });

  it("splits diagonals evenly and always sums to 1", () => {
    const d = directionalWeights(Math.SQRT1_2, Math.SQRT1_2);
    expect(d.fwd).toBeCloseTo(0.5, 9);
    expect(d.left).toBeCloseTo(0.5, 9);
    for (let a = -Math.PI; a <= Math.PI; a += 0.13) expect(sum(directionalWeights(Math.sin(a) * 3, Math.cos(a) * 3))).toBeCloseTo(1, 9);
  });

  it("is continuous around the circle (8-way blend without pops)", () => {
    let prev = directionalWeights(0, 1);
    for (let a = 0; a <= Math.PI * 2; a += 0.01) {
      const w = directionalWeights(Math.sin(a), Math.cos(a));
      expect(Math.abs(w.fwd - prev.fwd) + Math.abs(w.back - prev.back) + Math.abs(w.left - prev.left) + Math.abs(w.right - prev.right)).toBeLessThan(0.05);
      prev = w;
    }
  });

  it("falls back to forward for a (near) zero vector", () => {
    const d = directionalWeights(0, 0);
    expect(d.fwd).toBe(1);
    expect(sum(d)).toBe(1);
  });
});

describe("localDirection", () => {
  it("rotates a world velocity into the frame of a character facing `yaw` (forward = (sin, cos))", () => {
    const out = { x: 0, z: 0 };
    // Facing +X (yaw 90°), moving +X: straight ahead.
    localDirection(3, 0, Math.PI / 2, out);
    expect(out.x).toBeCloseTo(0, 9);
    expect(out.z).toBeCloseTo(3, 9);
    // Facing +Z, moving +X: that is the character's left (+X local).
    localDirection(2, 0, 0, out);
    expect(out.x).toBeCloseTo(2, 9);
    expect(out.z).toBeCloseTo(0, 9);
    // Facing +Z, moving -Z: backwards.
    localDirection(0, -1, 0, out);
    expect(out.z).toBeCloseTo(-1, 9);
  });
});

describe("gaitRate with a strafe share", () => {
  it("defaults to the forward behaviour", () => {
    expect(gaitRate(1.4)).toBeCloseTo(gaitRate(1.4, 1), 12);
  });

  it("is stride matched to the strafe / back-pedal clips when moving sideways", () => {
    // 2.3 m/s strafe (aim walk) is inside the clips' tempo range: exact stride match.
    expect(gaitRate(2.3, 0) * STRAFE_STRIDE).toBeCloseTo(2.3, 6);
    // Half and half: the stride itself is blended.
    const blended = (WALK_STRIDE + STRAFE_STRIDE) / 2;
    expect(gaitRate(1.9, 0.5) * blended).toBeCloseTo(1.9, 6);
  });

  it("stays continuous as the forward share changes", () => {
    for (let f = 0; f < 1; f += 0.01) expect(Math.abs(gaitRate(2.3, f + 0.01) - gaitRate(2.3, f))).toBeLessThan(0.02);
  });
});
