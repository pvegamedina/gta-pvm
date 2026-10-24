// Pure terrain mesh generation: one vertex per heightfield sample, two
// triangles per cell, smooth normals, world-normalised UVs (for the baked
// ground texture that paints landuse/roads under everything) and a
// slope-based vertex tint (steep banks turn earthy). No THREE dependency so
// it is unit-testable; world/campus/terrain.ts wraps it in a BufferGeometry.

import type { Terrain } from "../../map/terrain";

export interface TerrainArrays {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

/** Earth tone the tint fades towards on steep slopes (multiplied with the ground texture). */
const STEEP_TINT: [number, number, number] = [0.86, 0.72, 0.56];

/**
 * Vertex tint (multiplier) for a surface whose normal has vertical component
 * `ny` (1 = flat). Flat ground keeps the texture colour; from ~10 degrees on
 * it blends towards a darker earth tone.
 */
export function slopeShade(ny: number): [number, number, number] {
  const slope = Math.sqrt(Math.max(0, 1 - ny * ny)) / Math.max(ny, 1e-3); // tan(angle)
  const k = Math.min(1, Math.max(0, (slope - 0.18) / 0.5));
  return [1 + (STEEP_TINT[0] - 1) * k, 1 + (STEEP_TINT[1] - 1) * k, 1 + (STEEP_TINT[2] - 1) * k];
}

export function buildTerrainArrays(t: Terrain): TerrainArrays {
  const { width: w, height: h, cellSize: cs, originX, originZ, heights } = t;
  const n = w * h;
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const uvs = new Float32Array(n * 2);
  const colors = new Float32Array(n * 3);
  const at = (i: number, j: number) => heights[Math.min(h - 1, Math.max(0, j)) * w + Math.min(w - 1, Math.max(0, i))];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      positions[k * 3] = originX + i * cs;
      positions[k * 3 + 1] = heights[k];
      positions[k * 3 + 2] = originZ + j * cs;
      // Central differences (one-sided at the borders).
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(w - 1, i + 1);
      const j0 = Math.max(0, j - 1);
      const j1 = Math.min(h - 1, j + 1);
      const dhdx = (at(i1, j) - at(i0, j)) / ((i1 - i0) * cs || 1);
      const dhdz = (at(i, j1) - at(i, j0)) / ((j1 - j0) * cs || 1);
      const len = Math.hypot(dhdx, 1, dhdz);
      const ny = 1 / len;
      normals[k * 3] = -dhdx / len;
      normals[k * 3 + 1] = ny;
      normals[k * 3 + 2] = -dhdz / len;
      // Rows run north -> south, so v = 1 at the north edge (texture top).
      uvs[k * 2] = w > 1 ? i / (w - 1) : 0;
      uvs[k * 2 + 1] = h > 1 ? 1 - j / (h - 1) : 0;
      const c = slopeShade(ny);
      colors[k * 3] = c[0];
      colors[k * 3 + 1] = c[1];
      colors[k * 3 + 2] = c[2];
    }
  }
  const indices = new Uint32Array(Math.max(0, (w - 1) * (h - 1) * 6));
  let f = 0;
  for (let j = 0; j + 1 < h; j++) {
    for (let i = 0; i + 1 < w; i++) {
      const a = j * w + i; // north-west
      const b = a + 1; // north-east
      const c = a + w; // south-west
      const d = c + 1; // south-east
      // x east, z south: (a, c, b) is counter-clockwise seen from above.
      indices[f++] = a;
      indices[f++] = c;
      indices[f++] = b;
      indices[f++] = b;
      indices[f++] = c;
      indices[f++] = d;
    }
  }
  return { positions, normals, uvs, colors, indices };
}

/**
 * Height (m) of the RENDERED terrain at (x, z): linear interpolation over the
 * same two triangles per cell that buildTerrainArrays emits (split along the
 * north-east / south-west diagonal). Unlike the bilinear `heightAt`, objects
 * placed with this sit exactly on the visible surface. Clamps outside the grid.
 */
export function meshHeightAt(t: Terrain, x: number, z: number): number {
  const maxI = t.width - 1;
  const maxJ = t.height - 1;
  let gx = (x - t.originX) / t.cellSize;
  let gz = (z - t.originZ) / t.cellSize;
  gx = gx < 0 ? 0 : gx > maxI ? maxI : gx;
  gz = gz < 0 ? 0 : gz > maxJ ? maxJ : gz;
  const i = Math.min(Math.floor(gx), Math.max(0, maxI - 1));
  const j = Math.min(Math.floor(gz), Math.max(0, maxJ - 1));
  const fx = gx - i;
  const fz = gz - j;
  const w = t.width;
  const h = t.heights;
  const a = h[j * w + i]; // north-west
  const b = h[j * w + Math.min(i + 1, maxI)]; // north-east
  const c = h[Math.min(j + 1, maxJ) * w + i]; // south-west
  const d = h[Math.min(j + 1, maxJ) * w + Math.min(i + 1, maxI)]; // south-east
  if (fx + fz <= 1) return a + (b - a) * fx + (c - a) * fz;
  return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
}
