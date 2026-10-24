import { describe, expect, it } from "vitest";
import { createProjection, project, unproject } from "../projection";

// Campus El Carmen sits around 37.27 N, -6.92 E.
const proj = createProjection(37.27055, -6.9233);

describe("projection", () => {
  it("maps the origin to (0, 0)", () => {
    const [x, z] = project(proj, 37.27055, -6.9233);
    expect(x).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it("puts east at +x and north at -z (three.js seen from above, north up)", () => {
    const [xEast, zEast] = project(proj, 37.27055, -6.92);
    expect(xEast).toBeGreaterThan(0);
    expect(Math.abs(zEast)).toBeLessThan(1e-6);

    const [xNorth, zNorth] = project(proj, 37.275, -6.9233);
    expect(zNorth).toBeLessThan(0);
    expect(Math.abs(xNorth)).toBeLessThan(1e-6);
  });

  it("uses a realistic scale: 1° latitude ≈ 111 km, 1° longitude ≈ 88.7 km at 37.27°", () => {
    expect(proj.metresPerDegLat).toBeGreaterThan(110_800);
    expect(proj.metresPerDegLat).toBeLessThan(111_100);
    expect(proj.metresPerDegLon).toBeGreaterThan(88_500);
    expect(proj.metresPerDegLon).toBeLessThan(88_900);
    // 0.001° north is ≈ 111 m.
    const [, z] = project(proj, 37.27155, -6.9233);
    expect(z).toBeCloseTo(-proj.metresPerDegLat / 1000, 6);
  });

  it("round-trips through unproject", () => {
    const [x, z] = project(proj, 37.2661, -6.9282);
    const back = unproject(proj, x, z);
    expect(back.lat).toBeCloseTo(37.2661, 9);
    expect(back.lon).toBeCloseTo(-6.9282, 9);
  });
});
