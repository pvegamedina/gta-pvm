import { describe, it, expect } from "vitest";
import { boxSegments, capsuleSegments, sphereSegments, strengthColor, formatRagdollLine } from "../ragdollDebug";

/** Max |coordinate| per axis over a segment list (xyz pairs). */
function extent(seg: Float32Array): [number, number, number] {
  const e: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < seg.length; i += 3) for (let k = 0; k < 3; k++) e[k] = Math.max(e[k], Math.abs(seg[i + k]));
  return e;
}

describe("debug wireframe segments", () => {
  it("draws a box as its 12 edges", () => {
    const s = boxSegments(0.1, 0.2, 0.3);
    expect(s.length).toBe(12 * 2 * 3);
    const e = extent(s);
    expect(e[0]).toBeCloseTo(0.1, 6);
    expect(e[1]).toBeCloseTo(0.2, 6);
    expect(e[2]).toBeCloseTo(0.3, 6);
  });

  it("draws a capsule along Y spanning halfHeight + radius", () => {
    const s = capsuleSegments(0.2, 0.05, 12);
    expect(s.length % 6).toBe(0);
    const e = extent(s);
    expect(e[1]).toBeCloseTo(0.25, 3);
    expect(e[0]).toBeCloseTo(0.05, 3);
    expect(e[2]).toBeCloseTo(0.05, 3);
  });

  it("draws a sphere within its radius", () => {
    const s = sphereSegments(0.11, 12);
    expect(s.length).toBeGreaterThan(0);
    for (let i = 0; i < s.length; i += 3) expect(Math.hypot(s[i], s[i + 1], s[i + 2])).toBeCloseTo(0.11, 5);
  });
});

describe("strengthColor", () => {
  it("is green at full strength, red near zero and grey when limp", () => {
    const strong = strengthColor(1, "death");
    expect(strong[1]).toBeGreaterThan(strong[0]);
    const weak = strengthColor(0.05, "death");
    expect(weak[0]).toBeGreaterThan(weak[1]);
    const limp = strengthColor(0, "limp");
    expect(limp[0]).toBeCloseTo(limp[1], 1);
  });
});

describe("formatRagdollLine", () => {
  it("lists mode, strength, max motor error (deg), pelvis speed and sleep state in Spanish", () => {
    const line = formatRagdollLine(3, { mode: "death", strength: 0.426, maxError: 0.11, speed: 1.234, sleeping: false });
    expect(line).toContain("#3");
    expect(line).toContain("muriendo");
    expect(line).toContain("0.43");
    expect(line).toContain("6.3°");
    expect(line).toContain("1.2 m/s");
    expect(formatRagdollLine(1, { mode: "limp", strength: 0, maxError: 0, speed: 0, sleeping: true })).toContain("dormido");
  });
});
