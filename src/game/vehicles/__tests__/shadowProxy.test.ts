import { describe, expect, it } from "vitest";
import { VEHICLE_CATALOG, VEHICLE_TYPE_KEYS } from "../catalog";
import { shadowProxyBoxes } from "../shadowProxy";

describe("shadowProxyBoxes", () => {
  it("stays within the vehicle's footprint and height for every type", () => {
    for (const k of VEHICLE_TYPE_KEYS) {
      const s = VEHICLE_CATALOG[k];
      const boxes = shadowProxyBoxes(s);
      expect(boxes.length, k).toBeGreaterThan(0);
      for (const b of boxes) {
        expect(b.w, k).toBeLessThanOrEqual(s.W + 1e-9);
        expect(b.y - b.h / 2, k).toBeGreaterThanOrEqual(0);
        expect(b.y + b.h / 2, k).toBeLessThanOrEqual(s.H + 1e-9);
        expect(b.z - b.l / 2, k).toBeGreaterThanOrEqual(s.zc - s.L / 2 - 1e-9);
        expect(b.z + b.l / 2, k).toBeLessThanOrEqual(s.zc + s.L / 2 + 1e-9);
      }
    }
  });

  it("covers the full length near the ground (wheels included) and reaches the roof", () => {
    for (const k of VEHICLE_TYPE_KEYS) {
      const s = VEHICLE_CATALOG[k];
      const boxes = shadowProxyBoxes(s);
      const bottom = Math.min(...boxes.map((b) => b.y - b.h / 2));
      const top = Math.max(...boxes.map((b) => b.y + b.h / 2));
      const longest = Math.max(...boxes.map((b) => b.l));
      expect(bottom, k).toBeLessThan(0.15);
      expect(top, k).toBeCloseTo(s.H, 5);
      expect(longest, k).toBeGreaterThan(s.L * 0.9);
    }
  });

  it("gives cars a narrower cabin on top of the body, buses one tall box", () => {
    expect(shadowProxyBoxes(VEHICLE_CATALOG.sedan)).toHaveLength(2);
    const [, cabin] = shadowProxyBoxes(VEHICLE_CATALOG.sedan);
    expect(cabin.l).toBeLessThan(VEHICLE_CATALOG.sedan.L * 0.7);
    expect(shadowProxyBoxes(VEHICLE_CATALOG.bus)).toHaveLength(1);
  });
});
