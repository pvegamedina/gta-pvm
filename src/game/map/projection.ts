// Local tangent-plane projection between WGS84 lat/lon and map metres.
//
// Over the ~1.3 km campus an equirectangular projection scaled with the WGS84
// radii of curvature at the origin is accurate to a few centimetres, which is
// far below the 0.1 m quantization of the map file.
//
// Axes: x = east, z = SOUTH (so north is -z), matching three.js seen from above.

import type { MapProjection, Vec2 } from "./types";

const WGS84_A = 6_378_137; // semi-major axis (m)
const WGS84_E2 = 6.69437999014e-3; // first eccentricity squared
const DEG = Math.PI / 180;

/** Builds the projection parameters for a local plane centred at (lat, lon). */
export function createProjection(originLat: number, originLon: number): MapProjection {
  const s = Math.sin(originLat * DEG);
  const w = 1 - WGS84_E2 * s * s;
  // Meridional (M) and prime-vertical (N) radii of curvature.
  const m = (WGS84_A * (1 - WGS84_E2)) / Math.pow(w, 1.5);
  const n = WGS84_A / Math.sqrt(w);
  return {
    originLat,
    originLon,
    metresPerDegLat: m * DEG,
    metresPerDegLon: n * Math.cos(originLat * DEG) * DEG,
  };
}

/** lat/lon (degrees) → [x, z] metres. Not quantized. */
export function project(p: MapProjection, lat: number, lon: number): Vec2 {
  return [(lon - p.originLon) * p.metresPerDegLon, -(lat - p.originLat) * p.metresPerDegLat];
}

/** [x, z] metres → lat/lon (degrees). */
export function unproject(p: MapProjection, x: number, z: number): { lat: number; lon: number } {
  return { lat: p.originLat - z / p.metresPerDegLat, lon: p.originLon + x / p.metresPerDegLon };
}
