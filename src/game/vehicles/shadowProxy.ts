// Shadow proxy of a vehicle: instead of every body/wheel part casting into
// the sun's shadow map (~10 draw calls per car), one merged low-poly shape
// does — a full-length lower body (down to the tyres) plus a narrower cabin
// for cars, one tall box for buses and vans. Soft PCF shadows hide the
// simplification. This module is the pure box layout (metres, vehicle
// frame: +z forward, y up from the ground); meshes.ts builds the geometry.

import type { VehicleSpec } from "./types";

export interface ProxyBox {
  /** Size: width (x), height (y), length (z). */
  w: number;
  h: number;
  l: number;
  /** Centre height above the ground and position along z. */
  y: number;
  z: number;
}

/** Lower edge (m): low enough that the tyres' shadow is part of the body's. */
const GROUND_GAP = 0.06;
/** Vehicles at least this long (or tall) are boxes: buses, the ambulance. */
const BOXY_LENGTH = 5.6;
const BOXY_HEIGHT = 2;

export function shadowProxyBoxes(spec: VehicleSpec): ProxyBox[] {
  const { W, H, L, zc } = spec;
  if (L >= BOXY_LENGTH || H >= BOXY_HEIGHT) {
    const h = H - GROUND_GAP;
    return [{ w: W * 0.98, h, l: L * 0.98, y: GROUND_GAP + h / 2, z: zc }];
  }
  // Cars: body up to ~55% of the height, cabin (greenhouse) on top, set slightly back.
  const split = H * 0.55;
  const lowH = split - GROUND_GAP;
  const cabH = H - split;
  return [
    { w: W * 0.96, h: lowH, l: L * 0.97, y: GROUND_GAP + lowH / 2, z: zc },
    { w: W * 0.82, h: cabH, l: L * 0.5, y: split + cabH / 2, z: zc - L * 0.06 },
  ];
}
