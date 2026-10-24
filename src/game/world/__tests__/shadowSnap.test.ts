import { describe, expect, it } from "vitest";
import { lightBasis, snapShadowCentre } from "../shadowSnap";

const norm = (x: number, y: number, z: number) => {
  const l = Math.hypot(x, y, z);
  return { x: x / l, y: y / l, z: z / l };
};
const dot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => a.x * b.x + a.y * b.y + a.z * b.z;

describe("lightBasis", () => {
  it("is orthonormal with z along the light direction", () => {
    const d = norm(0.6, 0.7, 0.3);
    const b = lightBasis(d);
    expect(dot(b.x, b.x)).toBeCloseTo(1);
    expect(dot(b.y, b.y)).toBeCloseTo(1);
    expect(dot(b.x, b.y)).toBeCloseTo(0);
    expect(dot(b.x, d)).toBeCloseTo(0);
    expect(dot(b.y, d)).toBeCloseTo(0);
  });

  it("handles a light straight overhead", () => {
    const b = lightBasis({ x: 0, y: 1, z: 0 });
    expect(dot(b.x, b.x)).toBeCloseTo(1);
    expect(dot(b.x, b.y)).toBeCloseTo(0);
  });
});

describe("snapShadowCentre", () => {
  const dir = norm(0.5, 0.8, 0.35);
  const texel = 0.07;

  it("moves the centre by less than a texel diagonal, only across the light (not along it)", () => {
    const p = { x: 123.456, y: 7.89, z: -45.678 };
    const out = { x: 0, y: 0, z: 0 };
    snapShadowCentre(p, dir, texel, out);
    const d = { x: out.x - p.x, y: out.y - p.y, z: out.z - p.z };
    expect(Math.hypot(d.x, d.y, d.z)).toBeLessThanOrEqual(texel * Math.SQRT2 + 1e-9);
    expect(dot(d, dir)).toBeCloseTo(0, 9);
  });

  it("lands on the texel grid in light space", () => {
    const b = lightBasis(dir);
    const out = { x: 0, y: 0, z: 0 };
    snapShadowCentre({ x: 10.01, y: 2, z: 3.3 }, dir, texel, out);
    for (const axis of [b.x, b.y]) {
      const k = dot(out, axis) / texel;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-6);
    }
  });

  it("is stable: small moves within a texel give the same snapped centre", () => {
    const a = snapShadowCentre({ x: 50, y: 0, z: 50 }, dir, 1, { x: 0, y: 0, z: 0 });
    const b = snapShadowCentre({ x: 50.01, y: 0, z: 50.005 }, dir, 1, { x: 0, y: 0, z: 0 });
    // Across the light (what the shadow map rasterizes) they are whole texels apart (0 or 1 per axis).
    const basis = lightBasis(dir);
    const d = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
    for (const axis of [basis.x, basis.y]) {
      const k = Math.abs(dot(d, axis));
      expect(k < 1e-6 || Math.abs(k - 1) < 1e-6).toBe(true);
    }
    // And many tiny moves produce at most a couple of distinct light-plane centres.
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const s = snapShadowCentre({ x: 50 + i * 0.001, y: 0, z: 50 }, dir, 1, { x: 0, y: 0, z: 0 });
      seen.add(`${dot(s, basis.x).toFixed(6)},${dot(s, basis.y).toFixed(6)}`);
    }
    expect(seen.size).toBeLessThanOrEqual(2);
  });
});
