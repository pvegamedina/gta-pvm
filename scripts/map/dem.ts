// IGN MDT05 GeoTIFF → smoothed raster → regular terrain grid in map metres.

import { fromArrayBuffer } from "geotiff";
import { unproject } from "../../src/game/map/projection";
import type { MapBounds, MapProjection } from "../../src/game/map/types";

/** Geographic raster; row 0 is the northern edge, pixel-is-area convention. */
export interface DemRaster {
  width: number;
  height: number;
  /** Longitude of the western edge / latitude of the northern edge (degrees). */
  west: number;
  north: number;
  /** Pixel size in degrees (both positive). */
  resLon: number;
  resLat: number;
  values: Float32Array;
}

/** Decodes a single-band north-up GeoTIFF (EPSG:4258/4326). */
export async function readDem(bytes: Uint8Array): Promise<DemRaster> {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const tiff = await fromArrayBuffer(buf);
  const image = await tiff.getImage();
  const [west, north] = image.getOrigin();
  const [resLon, resLatSigned] = image.getResolution();
  if (resLatSigned >= 0) throw new Error("DEM: expected a north-up raster (negative y resolution)");
  const raster = (await image.readRasters({ interleave: true })) as unknown as ArrayLike<number>;
  const values = Float32Array.from(raster);
  return { width: image.getWidth(), height: image.getHeight(), west, north, resLon, resLat: -resLatSigned, values };
}

/**
 * Separable binomial [1 4 6 4 1]/16 blur applied `passes` times with clamped
 * edges. The MDT05 export is integer metres, so without smoothing gentle
 * slopes turn into 1 m terraces; each pass is a Gaussian with σ ≈ 1 px.
 */
export function smoothRaster(r: DemRaster, passes: number): DemRaster {
  const { width: w, height: h } = r;
  const k = [1, 4, 6, 4, 1].map((v) => v / 16);
  // Horizontal pass src → tmp, vertical pass tmp → src.
  const src = Float32Array.from(r.values);
  const tmp = new Float32Array(src.length);
  const clamp = (v: number, max: number) => (v < 0 ? 0 : v > max ? max : v);
  for (let pass = 0; pass < passes; pass++) {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        let s = 0;
        for (let o = -2; o <= 2; o++) s += k[o + 2] * src[j * w + clamp(i + o, w - 1)];
        tmp[j * w + i] = s;
      }
    }
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        let s = 0;
        for (let o = -2; o <= 2; o++) s += k[o + 2] * tmp[clamp(j + o, h - 1) * w + i];
        src[j * w + i] = s;
      }
    }
  }
  return { ...r, values: src };
}

/** Bilinear sample between pixel centres; clamps outside the raster. */
export function sampleDem(r: DemRaster, lat: number, lon: number): number {
  let gx = (lon - r.west) / r.resLon - 0.5;
  let gy = (r.north - lat) / r.resLat - 0.5;
  gx = Math.max(0, Math.min(r.width - 1, gx));
  gy = Math.max(0, Math.min(r.height - 1, gy));
  const i0 = Math.min(Math.floor(gx), r.width - 2);
  const j0 = Math.min(Math.floor(gy), r.height - 2);
  const fx = gx - i0;
  const fy = gy - j0;
  const v = r.values;
  const w = r.width;
  const top = v[j0 * w + i0] * (1 - fx) + v[j0 * w + i0 + 1] * fx;
  const bottom = v[(j0 + 1) * w + i0] * (1 - fx) + v[(j0 + 1) * w + i0 + 1] * fx;
  return top * (1 - fy) + bottom * fy;
}

export interface GeoBBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * Playable bounds: the projected bbox shrunk by `inset` metres (so every grid
 * sample has DEM data around it), snapped to integer metres and to a whole
 * number of terrain cells.
 */
export function computeBounds(p: MapProjection, bbox: GeoBBox, cellSize: number, inset = 3): MapBounds {
  const minX = Math.ceil((bbox.west - p.originLon) * p.metresPerDegLon + inset);
  const maxXRaw = (bbox.east - p.originLon) * p.metresPerDegLon - inset;
  const minZ = Math.ceil(-(bbox.north - p.originLat) * p.metresPerDegLat + inset);
  const maxZRaw = -(bbox.south - p.originLat) * p.metresPerDegLat - inset;
  const cellsX = Math.floor((maxXRaw - minX) / cellSize);
  const cellsZ = Math.floor((maxZRaw - minZ) / cellSize);
  return { minX, minZ, maxX: minX + cellsX * cellSize, maxZ: minZ + cellsZ * cellSize };
}

export interface TerrainGrid {
  originX: number;
  originZ: number;
  cellSize: number;
  width: number;
  height: number;
  heights: Float32Array;
}

/** Samples the raster on a regular grid covering `bounds` (corners included). */
export function buildTerrainGrid(r: DemRaster, p: MapProjection, bounds: MapBounds, cellSize: number): TerrainGrid {
  const width = Math.round((bounds.maxX - bounds.minX) / cellSize) + 1;
  const height = Math.round((bounds.maxZ - bounds.minZ) / cellSize) + 1;
  const heights = new Float32Array(width * height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const { lat, lon } = unproject(p, bounds.minX + i * cellSize, bounds.minZ + j * cellSize);
      heights[j * width + i] = sampleDem(r, lat, lon);
    }
  }
  return { originX: bounds.minX, originZ: bounds.minZ, cellSize, width, height, heights };
}
