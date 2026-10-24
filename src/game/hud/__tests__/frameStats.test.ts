import { describe, expect, it } from "vitest";
import { FrameStats } from "../frameStats";

describe("FrameStats", () => {
  it("averages frame times and reports fps", () => {
    const s = new FrameStats(8);
    for (let i = 0; i < 8; i++) s.push(20);
    expect(s.averageMs()).toBeCloseTo(20);
    expect(s.fps()).toBeCloseTo(50);
    expect(s.maxMs()).toBe(20);
  });

  it("keeps only the last `capacity` samples (ring buffer)", () => {
    const s = new FrameStats(4);
    for (const ms of [100, 100, 100, 100, 10, 10, 10, 10]) s.push(ms);
    expect(s.count).toBe(4);
    expect(s.averageMs()).toBeCloseTo(10);
    expect(s.maxMs()).toBe(10);
  });

  it("returns samples oldest -> newest", () => {
    const s = new FrameStats(3);
    for (const ms of [1, 2, 3, 4]) s.push(ms);
    const out: number[] = [];
    s.forEach((ms) => out.push(ms));
    expect(out).toEqual([2, 3, 4]);
  });

  it("is safe when empty and ignores invalid samples", () => {
    const s = new FrameStats(4);
    expect(s.averageMs()).toBe(0);
    expect(s.fps()).toBe(0);
    s.push(Number.NaN);
    s.push(-5);
    expect(s.count).toBe(0);
  });

  it("reports a high percentile (stutter indicator)", () => {
    const s = new FrameStats(100);
    for (let i = 0; i < 95; i++) s.push(16);
    for (let i = 0; i < 5; i++) s.push(50);
    expect(s.percentileMs(0.99)).toBe(50);
    expect(s.percentileMs(0.5)).toBe(16);
  });
});
