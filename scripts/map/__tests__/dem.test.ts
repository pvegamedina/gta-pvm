import { describe, expect, it } from "vitest";
import { buildTerrainGrid, computeBounds, sampleDem, smoothRaster, type DemRaster } from "../dem";
import { createProjection, unproject } from "../../../src/game/map/projection";

/** Raster whose value is a linear function of the pixel-centre lon/lat. */
function linearRaster(f: (lon: number, lat: number) => number): DemRaster {
  const width = 40;
  const height = 30;
  const west = -6.93;
  const north = 37.276;
  const resLon = 4.5e-5;
  const resLat = 4.5e-5;
  const values = new Float32Array(width * height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      values[j * width + i] = f(west + (i + 0.5) * resLon, north - (j + 0.5) * resLat);
    }
  }
  return { width, height, west, north, resLon, resLat, values };
}

describe("sampleDem", () => {
  // Height grows to the east and to the north.
  const f = (lon: number, lat: number) => (lon + 6.93) * 1e5 + (lat - 37.27) * 2e5;
  const r = linearRaster(f);

  it("reads pixel centres exactly (pixel-is-area convention)", () => {
    const lon = r.west + 10.5 * r.resLon;
    const lat = r.north - 7.5 * r.resLat;
    expect(sampleDem(r, lat, lon)).toBeCloseTo(f(lon, lat), 3);
  });

  it("interpolates bilinearly between pixel centres", () => {
    const lon = r.west + 12.1 * r.resLon;
    const lat = r.north - 9.8 * r.resLat;
    expect(sampleDem(r, lat, lon)).toBeCloseTo(f(lon, lat), 3);
  });
});

describe("smoothRaster", () => {
  it("keeps constant fields constant", () => {
    const r = linearRaster(() => 7);
    const s = smoothRaster(r, 2);
    for (const v of s.values) expect(v).toBeCloseTo(7, 5);
  });

  it("preserves linear slopes away from the edges and removes 1 m terraces", () => {
    const f = (lon: number) => (lon + 6.93) * 1e5; // ~0..18
    const stepped = linearRaster((lon) => Math.round(f(lon)));
    const s = smoothRaster(stepped, 3);
    // The smoothed profile is monotonic and much closer to the true slope.
    const row = 15;
    let maxErrRaw = 0;
    let maxErrSmooth = 0;
    for (let i = 8; i < 32; i++) {
      const lon = stepped.west + (i + 0.5) * stepped.resLon;
      maxErrRaw = Math.max(maxErrRaw, Math.abs(stepped.values[row * 40 + i] - f(lon)));
      maxErrSmooth = Math.max(maxErrSmooth, Math.abs(s.values[row * 40 + i] - f(lon)));
      expect(s.values[row * 40 + i + 1]).toBeGreaterThanOrEqual(s.values[row * 40 + i]);
    }
    expect(maxErrSmooth).toBeLessThan(maxErrRaw);
  });
});

describe("buildTerrainGrid", () => {
  it("covers the bounds with a regular grid sampled from the DEM", () => {
    const f = (lon: number, lat: number) => (lon + 6.93) * 1e5 + (lat - 37.27) * 2e5;
    const r = linearRaster(f);
    const proj = createProjection(37.2753, -6.9291);
    const bounds = computeBounds(proj, { south: 37.2748, west: -6.9298, north: 37.2758, east: -6.9284 }, 4);
    const grid = buildTerrainGrid(r, proj, bounds, 4);
    expect(grid.originX).toBe(bounds.minX);
    expect(grid.originZ).toBe(bounds.minZ);
    expect(grid.originX + (grid.width - 1) * 4).toBe(bounds.maxX);
    expect(grid.originZ + (grid.height - 1) * 4).toBe(bounds.maxZ);
    // Spot-check a sample against the analytic function.
    const i = 5;
    const j = 7;
    const { lat, lon } = unproject(proj, grid.originX + i * 4, grid.originZ + j * 4);
    expect(grid.heights[j * grid.width + i]).toBeCloseTo(f(lon, lat), 2);
  });

  it("computes integer-aligned bounds inside the bbox", () => {
    const proj = createProjection(37.2705, -6.9233);
    const b = computeBounds(proj, { south: 37.2647, west: -6.9299, north: 37.2763, east: -6.9167 }, 4);
    expect(Number.isInteger(b.minX) && Number.isInteger(b.minZ)).toBe(true);
    expect((b.maxX - b.minX) % 4).toBe(0);
    expect((b.maxZ - b.minZ) % 4).toBe(0);
    // ~1170 m wide (east-west) and ~1290 m deep (north-south).
    expect(b.maxX - b.minX).toBeGreaterThan(1150);
    expect(b.maxX - b.minX).toBeLessThan(1180);
    expect(b.maxZ - b.minZ).toBeGreaterThan(1270);
    expect(b.maxZ - b.minZ).toBeLessThan(1300);
  });
});
