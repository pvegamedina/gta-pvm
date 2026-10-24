// The single source of ground height for every gameplay system (player on
// foot, vehicles, pedestrians, camera, bullets, shell casings…). The campus
// world installs its terrain (+ bridge decks) sampler once the map is loaded;
// until then the ground is the flat y = 0 plane so early frames and unit tests
// keep working. Also holds the playable world rectangle and the visual
// surface lift (kerbs, sidewalks, asphalt drawn above the terrain) that foot
// IK stands on.

import type { MapBounds } from "../map/types";

/** Ground height at (x, z); `yHint` (the caller's current height) lets things under a bridge deck stay below it. */
export type HeightFn = (x: number, z: number, yHint?: number) => number;

const FLAT: HeightFn = () => 0;
let sampler: HeightFn = FLAT;
/** Height of the drawn surface above the terrain (roads, kerbs, paving); visual only. */
let lift: (x: number, z: number) => number = FLAT;

/** Installs the ground height function (metres, y up) used by `groundY`. */
export function setGroundSampler(fn: HeightFn): void {
  sampler = fn;
}

/** Installs the visual surface lift (campus/surfaceLift.ts) used by `surfaceY`. */
export function setSurfaceLift(fn: (x: number, z: number) => number): void {
  lift = fn;
}

/** Back to the flat ground and default bounds (tests, world disposal). */
export function resetGround(): void {
  sampler = FLAT;
  lift = FLAT;
  bounds = { ...DEFAULT_BOUNDS };
}

/** Ground height (m) at (x, z); pass the current height as `yHint` when known (underpasses). */
export function groundY(x: number, z: number, yHint?: number): number {
  return sampler(x, z, yHint);
}

/**
 * Height (m) of the visible walking surface at (x, z): the terrain plus the
 * drawn road / sidewalk / paving layer on top of it. For visuals only (foot
 * IK); gameplay, physics and cameras use `groundY`.
 */
export function surfaceY(x: number, z: number, yHint?: number): number {
  return sampler(x, z, yHint) + lift(x, z);
}

/** Half the finite-difference span used for normals (≈ half a terrain cell). */
const NORMAL_EPS = 1;

/** Unit ground normal at (x, z) from central differences of `groundY`. */
export function groundNormal(x: number, z: number, out = { x: 0, y: 1, z: 0 }): { x: number; y: number; z: number } {
  const dhdx = (sampler(x + NORMAL_EPS, z) - sampler(x - NORMAL_EPS, z)) / (2 * NORMAL_EPS);
  const dhdz = (sampler(x, z + NORMAL_EPS) - sampler(x, z - NORMAL_EPS)) / (2 * NORMAL_EPS);
  const len = Math.hypot(dhdx, 1, dhdz);
  out.x = -dhdx / len;
  out.y = 1 / len;
  out.z = -dhdz / len;
  return out;
}

// ---------------------------------------------------------------------------
// Playable rectangle

const DEFAULT_BOUNDS: MapBounds = { minX: -600, minZ: -650, maxX: 600, maxZ: 660 };
let bounds: MapBounds = { ...DEFAULT_BOUNDS };

export function setWorldBounds(b: MapBounds): void {
  bounds = { ...b };
}

export function worldBounds(): Readonly<MapBounds> {
  return bounds;
}

/** Clamps `p` into the playable rectangle; true when it had to be moved. */
export function clampToWorld(p: { x: number; z: number }): boolean {
  let moved = false;
  if (p.x < bounds.minX) {
    p.x = bounds.minX;
    moved = true;
  } else if (p.x > bounds.maxX) {
    p.x = bounds.maxX;
    moved = true;
  }
  if (p.z < bounds.minZ) {
    p.z = bounds.minZ;
    moved = true;
  } else if (p.z > bounds.maxZ) {
    p.z = bounds.maxZ;
    moved = true;
  }
  return moved;
}
