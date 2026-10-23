import { describe, it, expect } from "vitest";
import type { PlayerMotion } from "@shared/protocol";
import { InterpolationBuffer, INTERP_DELAY_MS } from "../interpolation";

function motion(x: number, yaw = 0): PlayerMotion {
  return { p: [x, 0, 0], yaw, speed: 0, ground: true, weapon: "fists", aiming: false, car: null };
}

describe("InterpolationBuffer", () => {
  it("returns null before any sample is pushed", () => {
    const buf = new InterpolationBuffer();
    expect(buf.sample(0)).toBeNull();
  });

  it("returns the single sample when only one exists", () => {
    const buf = new InterpolationBuffer();
    buf.push(motion(5), 1000);
    expect(buf.sample(1000)?.p[0]).toBe(5);
    expect(buf.sample(5000)?.p[0]).toBe(5);
  });

  it("interpolates position linearly between two samples at the render delay", () => {
    const buf = new InterpolationBuffer();
    buf.push(motion(0), 0);
    buf.push(motion(100), 100);
    // Rendering at t=100+INTERP_DELAY_MS looks back INTERP_DELAY_MS, landing exactly on t=100.
    const sOnSecond = buf.sample(100 + INTERP_DELAY_MS);
    expect(sOnSecond?.p[0]).toBeCloseTo(100);
    // Rendering at t=50+INTERP_DELAY_MS looks back to t=50, the midpoint between the two samples.
    const sMid = buf.sample(50 + INTERP_DELAY_MS);
    expect(sMid?.p[0]).toBeCloseTo(50);
  });

  it("clamps to the earliest sample when the render time is before it", () => {
    const buf = new InterpolationBuffer();
    buf.push(motion(0), 1000);
    buf.push(motion(10), 1100);
    expect(buf.sample(0)?.p[0]).toBe(0);
  });

  it("clamps to the latest sample when the render time is after it", () => {
    const buf = new InterpolationBuffer();
    buf.push(motion(0), 0);
    buf.push(motion(10), 100);
    expect(buf.sample(100000)?.p[0]).toBe(10);
  });

  it("drops samples older than the retention window", () => {
    const buf = new InterpolationBuffer();
    buf.push(motion(0), 0);
    buf.push(motion(1), 2000);
    buf.push(motion(2), 2100);
    expect(buf.size()).toBe(2);
  });

  it("interpolates yaw along the shortest angular path", () => {
    const buf = new InterpolationBuffer();
    const almostFullCircle = Math.PI * 2 - 0.2;
    buf.push(motion(0, almostFullCircle), 0);
    buf.push(motion(0, 0.2), 100);
    const s = buf.sample(50 + INTERP_DELAY_MS);
    // Should wrap through 2π rather than going the long way through π; normalize
    // the raw (possibly > 2π) result back into [-π, π] before checking the gap.
    const twoPi = Math.PI * 2;
    let normalized = ((s!.yaw % twoPi) + twoPi) % twoPi;
    if (normalized > Math.PI) normalized -= twoPi;
    expect(Math.abs(normalized)).toBeLessThan(0.3);
  });
});
