// Heightfield encoding/decoding and sampling.
//
// Heights travel as little-endian int16 DECIMETRES encoded in base64, which is
// compact (2 bytes per sample) and decodable with the `atob`/`btoa` globals
// available both in browsers and in Node ≥ 16 (no Buffer, no DOM).

import type { TerrainData } from "./types";

/** Decoded heightfield ready for sampling. Heights are in metres. */
export interface Terrain {
  originX: number;
  originZ: number;
  cellSize: number;
  width: number;
  height: number;
  heights: Float32Array;
}

const INT16_MIN = -32768;
const INT16_MAX = 32767;

/** Quantizes heights (metres) to int16 decimetres and encodes them as base64. */
export function encodeTerrainHeights(heights: ArrayLike<number>): string {
  const bytes = new Uint8Array(heights.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < heights.length; i++) {
    const dm = Math.max(INT16_MIN, Math.min(INT16_MAX, Math.round(heights[i] * 10)));
    view.setInt16(i * 2, dm, true);
  }
  // Build the binary string in chunks to stay clear of argument-count limits.
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Decodes the terrain payload; throws when its size does not match the grid. */
export function decodeTerrain(t: TerrainData): Terrain {
  let binary: string;
  try {
    binary = atob(t.data);
  } catch {
    throw new Error("terrain: data is not valid base64");
  }
  const count = t.width * t.height;
  if (!Number.isInteger(count) || count <= 0 || binary.length !== count * 2) {
    throw new Error(`terrain: expected ${count * 2} bytes for ${t.width}x${t.height} samples, got ${binary.length}`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const heights = new Float32Array(count);
  for (let i = 0; i < count; i++) heights[i] = view.getInt16(i * 2, true) / 10;
  return { originX: t.originX, originZ: t.originZ, cellSize: t.cellSize, width: t.width, height: t.height, heights };
}

/** Bilinear height (metres) at (x, z); clamps to the grid edges outside it. */
export function heightAt(t: Terrain, x: number, z: number): number {
  let gx = (x - t.originX) / t.cellSize;
  let gz = (z - t.originZ) / t.cellSize;
  const maxX = t.width - 1;
  const maxZ = t.height - 1;
  gx = gx < 0 ? 0 : gx > maxX ? maxX : gx;
  gz = gz < 0 ? 0 : gz > maxZ ? maxZ : gz;
  const i0 = Math.min(Math.floor(gx), maxX - 1 < 0 ? 0 : maxX - 1);
  const j0 = Math.min(Math.floor(gz), maxZ - 1 < 0 ? 0 : maxZ - 1);
  const i1 = Math.min(i0 + 1, maxX);
  const j1 = Math.min(j0 + 1, maxZ);
  const fx = gx - i0;
  const fz = gz - j0;
  const h = t.heights;
  const w = t.width;
  const top = h[j0 * w + i0] * (1 - fx) + h[j0 * w + i1] * fx;
  const bottom = h[j1 * w + i0] * (1 - fx) + h[j1 * w + i1] * fx;
  return top * (1 - fz) + bottom * fz;
}

/**
 * Unit surface normal [nx, ny, nz] (y up) from central differences of
 * `heightAt` over one cell.
 */
export function normalAt(t: Terrain, x: number, z: number): [number, number, number] {
  const e = t.cellSize * 0.5;
  const dhdx = (heightAt(t, x + e, z) - heightAt(t, x - e, z)) / (2 * e);
  const dhdz = (heightAt(t, x, z + e) - heightAt(t, x, z - e)) / (2 * e);
  const len = Math.hypot(dhdx, 1, dhdz);
  return [-dhdx / len, 1 / len, -dhdz / len];
}
