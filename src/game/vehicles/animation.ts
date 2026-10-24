// Pure per-frame vehicle animation rules: wheel roll angle, which lamps are
// lit (head / tail / brake / reverse) and the police light-bar flash pattern.
// meshes.ts applies them to the scene graph.

import type { VehicleMode } from "./types";

const TAU = Math.PI * 2;

/** Night factor (environment nightF, 0 day .. 1 night) from which cars drive with lights on. */
export const HEADLIGHTS_ON_NIGHT = 0.35;
/** Below this backwards speed (m/s) the reverse lamps stay off. */
export const REVERSE_LAMP_SPEED = 0.3;
/** One full red + blue cycle of the light bar (s). */
export const SIREN_FLASH_PERIOD = 0.6;

/** Wheel roll angle after rolling `speed * dt` metres, wrapped to [0, 2π). */
export function advanceWheelSpin(angle: number, speed: number, dt: number, radius: number): number {
  if (radius <= 0) return angle;
  const a = (angle + (speed * dt) / radius) % TAU;
  return a < 0 ? a + TAU : a;
}

export interface LightInputs {
  nightF: number;
  braking: boolean;
  /** Forward speed (m/s, negative reversing). */
  speed: number;
  mode: VehicleMode;
}

export type TailLight = "off" | "run" | "brake";

export interface LightState {
  head: boolean;
  tail: TailLight;
  reverse: boolean;
}

/** Which lamps a vehicle shows. Parked cars are dark. */
export function vehicleLightState(i: LightInputs): LightState {
  if (i.mode === "parked") return { head: false, tail: "off", reverse: false };
  const head = i.nightF >= HEADLIGHTS_ON_NIGHT;
  return {
    head,
    tail: i.braking ? "brake" : head ? "run" : "off",
    reverse: i.speed < -REVERSE_LAMP_SPEED,
  };
}

/**
 * Light-bar pattern: red double flash in the first half of the period, blue
 * double flash in the second (each pulse 22% of a half, 8% gap between).
 */
export function sirenFlash(t: number): { red: boolean; blue: boolean } {
  const half = SIREN_FLASH_PERIOD / 2;
  const p = ((t % SIREN_FLASH_PERIOD) + SIREN_FLASH_PERIOD) % SIREN_FLASH_PERIOD;
  const inHalf = (p % half) / half;
  const on = inHalf < 0.22 || (inHalf >= 0.3 && inHalf < 0.52);
  const firstHalf = p < half;
  return { red: on && firstHalf, blue: on && !firstHalf };
}
