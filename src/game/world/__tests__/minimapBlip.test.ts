import { describe, expect, it } from "vitest";
import { blipScreenPos } from "../minimap";

describe("blipScreenPos", () => {
  it("puts the camera focus at the centre", () => {
    expect(blipScreenPos(10, 20, 0.7, 10, 20, 9)).toEqual({ sx: 90, sy: 90, edge: false });
  });

  it("draws what is in front of the camera above the centre", () => {
    // yaw 0 faces +z.
    const p = blipScreenPos(0, 30, 0, 0, 0, 9);
    expect(p.sx).toBeCloseTo(90);
    expect(p.sy).toBeLessThan(90);
    expect(p.edge).toBe(false);
  });

  it("draws what is to the camera's right on the right", () => {
    // Facing +z, the right is -x.
    const p = blipScreenPos(-30, 0, 0, 0, 0, 9);
    expect(p.sx).toBeGreaterThan(90);
    expect(p.sy).toBeCloseTo(90);
  });

  it("pins far targets to the rim, in their direction", () => {
    const p = blipScreenPos(0, 5000, 0, 0, 0, 9);
    expect(p.edge).toBe(true);
    expect(p.sx).toBeCloseTo(90);
    expect(90 - p.sy).toBeCloseTo(88 - 9);
  });
});
