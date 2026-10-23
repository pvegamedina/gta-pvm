import { describe, it, expect } from "vitest";
import { bulletFlightTime, bulletStreak, type Vec3 } from "../bullets";

const origin: Vec3 = { x: 0, y: 1, z: 0 };
const end: Vec3 = { x: 0, y: 1, z: 100 };
const SPEED = 250;
const LEN = 2;

const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe("bulletFlightTime", () => {
  it("is distance / speed", () => {
    expect(bulletFlightTime(origin, end, SPEED)).toBeCloseTo(0.4, 9);
    expect(bulletFlightTime(origin, origin, SPEED)).toBe(0);
  });
});

describe("bulletStreak", () => {
  it("moves the head along the line at the given speed", () => {
    const s = bulletStreak(origin, end, SPEED, 0.2, LEN);
    expect(s.head.z).toBeCloseTo(50, 6);
    expect(s.head.y).toBeCloseTo(1, 9);
    expect(s.arrived).toBe(false);
  });

  it("never draws the tail behind the muzzle", () => {
    const s = bulletStreak(origin, end, SPEED, 0.002, LEN);
    expect(s.tail).toEqual(origin);
    expect(dist(s.head, s.tail)).toBeCloseTo(0.5, 6);
  });

  it("keeps a constant streak length in mid-flight", () => {
    const s = bulletStreak(origin, end, SPEED, 0.1, LEN);
    expect(dist(s.head, s.tail)).toBeCloseTo(LEN, 6);
  });

  it("stops at the impact point and reports arrival", () => {
    const s = bulletStreak(origin, end, SPEED, 0.5, LEN);
    expect(s.arrived).toBe(true);
    expect(s.head).toEqual(end);
  });

  it("arrives immediately for a zero-length shot", () => {
    expect(bulletStreak(origin, origin, SPEED, 0, LEN).arrived).toBe(true);
  });
});
