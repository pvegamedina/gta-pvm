import { describe, it, expect } from "vitest";
import { solveTwoBoneIK, type Vec3 } from "../ik";

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const sub = (a: Vec3, b: Vec3) => v(a.x - b.x, a.y - b.y, a.z - b.z);
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3) => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const dist = (a: Vec3, b: Vec3) => len(sub(a, b));

/** Component of `p - root` perpendicular to the root->target axis. */
function perp(p: Vec3, root: Vec3, target: Vec3): Vec3 {
  const axis = sub(target, root);
  const l = len(axis);
  const n = v(axis.x / l, axis.y / l, axis.z / l);
  const d = sub(p, root);
  const k = dot(d, n);
  return v(d.x - n.x * k, d.y - n.y * k, d.z - n.z * k);
}

// Upper arm / forearm of the Quaternius characters (m).
const A = 0.18;
const B = 0.235;
const shoulder = v(-0.15, 1.4, 0.09);

describe("solveTwoBoneIK", () => {
  it("reaches reachable targets exactly with both bone lengths preserved", () => {
    const targets = [v(0, 1.38, 0.42), v(-0.3, 1.1, 0.25), v(-0.05, 1.55, 0.3), v(-0.45, 1.3, 0.2)];
    for (const t of targets) {
      const s = solveTwoBoneIK(shoulder, A, B, t, v(-1, 0, 0));
      expect(s.reached).toBe(true);
      expect(dist(s.end, t)).toBeLessThan(1e-9);
      expect(dist(s.mid, shoulder)).toBeCloseTo(A, 9);
      expect(dist(s.end, s.mid)).toBeCloseTo(B, 9);
    }
  });

  it("bends the middle joint towards the pole hint, in the root/target/pole plane", () => {
    const t = v(0, 1.35, 0.4);
    for (const pole of [v(-1, 0.2, 0), v(-0.3, -1, 0.1), v(0.2, 1, 0.3)]) {
      const s = solveTwoBoneIK(shoulder, A, B, t, pole);
      const bend = perp(s.mid, shoulder, t);
      const want = perp(pole, shoulder, t);
      expect(dot(bend, want)).toBeGreaterThan(0);
      // Coplanar: (mid - root) . ((target - root) x (pole - root)) == 0
      const normal = cross(sub(t, shoulder), sub(pole, shoulder));
      expect(Math.abs(dot(sub(s.mid, shoulder), normal))).toBeLessThan(1e-9);
    }
  });

  it("flips the bend when the pole flips", () => {
    const t = v(0, 1.35, 0.4);
    const down = solveTwoBoneIK(shoulder, A, B, t, v(shoulder.x, 0, shoulder.z + 0.2));
    const up = solveTwoBoneIK(shoulder, A, B, t, v(shoulder.x, 3, shoulder.z + 0.2));
    expect(down.mid.y).toBeLessThan(up.mid.y);
  });

  it("clamps unreachable targets: fully extended towards them", () => {
    const t = v(-0.15, 1.4, 1.5);
    const s = solveTwoBoneIK(shoulder, A, B, t, v(-1, 0, 0));
    expect(s.reached).toBe(false);
    expect(dist(s.mid, shoulder)).toBeCloseTo(A, 9);
    expect(dist(s.end, s.mid)).toBeCloseTo(B, 9);
    // On the root -> target ray, (almost) straight.
    expect(len(perp(s.end, shoulder, t))).toBeLessThan(1e-9);
    expect(dist(s.end, shoulder)).toBeGreaterThan(0.999 * (A + B));
    expect(dot(sub(s.end, shoulder), sub(t, shoulder))).toBeGreaterThan(0);
  });

  it("clamps targets closer than the bones can fold", () => {
    const t = v(shoulder.x, shoulder.y, shoulder.z + 0.01);
    const s = solveTwoBoneIK(shoulder, A, B, t, v(-1, 0, 0));
    expect(s.reached).toBe(false);
    expect(dist(s.mid, shoulder)).toBeCloseTo(A, 9);
    expect(dist(s.end, s.mid)).toBeCloseTo(B, 9);
    expect(dist(s.end, shoulder)).toBeGreaterThanOrEqual(Math.abs(B - A) - 1e-9);
  });

  it("stays finite with a pole on the axis or a target at the root", () => {
    const t = v(-0.15, 1.4, 0.4);
    for (const s of [solveTwoBoneIK(shoulder, A, B, t, v(-0.15, 1.4, 2)), solveTwoBoneIK(shoulder, A, B, shoulder, v(-1, 0, 0))]) {
      for (const p of [s.mid, s.end]) for (const c of [p.x, p.y, p.z]) expect(Number.isFinite(c)).toBe(true);
      expect(dist(s.mid, shoulder)).toBeCloseTo(A, 9);
      expect(dist(s.end, s.mid)).toBeCloseTo(B, 9);
    }
  });
});
