// Pure decisions behind the vehicle VFX (vehicleVfx.ts) and the tyre screech:
// how much the tyres slip (sideways sliding, handbrake, hard braking), when a
// wheel lays a skid-mark segment, how fast the exhaust puffs, when braking
// raises dust on loose ground, and turning rates into whole particles. No
// THREE, tested.

import type { GroundSurface } from "../world/campus/groundMaterial";

/** Slip above which a wheel leaves skid marks. */
export const SKID_THRESHOLD = 0.3;

export interface SlipInput {
  /** Sideways speed in the car frame (m/s, absolute). */
  lateral: number;
  /** Forward speed (m/s, absolute). */
  speed: number;
  handbrake: boolean;
  /** 0..1: how hard the service brake is biting (1 = full brake pedal). */
  hardBrake: number;
}

/** Tyre slip 0..1 (drives the screech voice and the skid marks). */
export function tyreSlip(s: SlipInput): number {
  let slip = Math.min(1, Math.max(0, (s.lateral - 1.2) / 4));
  if (s.handbrake && s.speed > 4) slip = Math.max(slip, Math.min(0.9, Math.max(0.35, s.speed / 15)));
  // A full brake pedal from above ~10 m/s locks up briefly (no ABS in this game).
  if (s.hardBrake > 0 && s.speed > 10) slip = Math.max(slip, Math.min(0.75, ((s.speed - 10) / 12 + 0.35) * s.hardBrake));
  return slip;
}

/** Exhaust puffs per second for a throttle 0..1 at `speed` of a car with top speed `max`. */
export function exhaustRate(throttle: number, speed: number, max: number): number {
  const low = 1 - Math.min(1, Math.abs(speed) / Math.max(1, max));
  return 3 + 26 * Math.min(1, Math.max(0, throttle)) * low;
}

/** Dust 0..1 kicked up by braking/sliding on loose ground (none on hard surfaces). */
export function dustAmount(surface: GroundSurface, speed: number, braking: boolean, slip: number): number {
  if (surface === "asphalt" || surface === "pavement") return 0;
  if (Math.abs(speed) < 3 || (!braking && slip < 0.2)) return 0;
  return Math.min(1, Math.abs(speed) / 14) * (surface === "gravel" ? 1 : 0.7);
}

/** Integrates a rate (per second) into whole emissions, carrying the fraction. */
export class EmissionAccumulator {
  private carry = 0;

  take(rate: number, dt: number, maxPerCall = 16): number {
    this.carry += Math.max(0, rate) * dt;
    const n = Math.min(maxPerCall, Math.floor(this.carry));
    this.carry = n === maxPerCall ? 0 : this.carry - n;
    return n;
  }
}

/** One skid-mark segment from (ax, az) to (bx, bz) (reused object). */
export interface SkidSegment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

/** Jumps longer than this (m) in one update are teleports, not skids. */
const MAX_JUMP = 6;

/**
 * Turns one wheel's positions into connected skid segments: while skidding,
 * a segment is emitted each time the wheel has moved `minSegment` metres
 * from the end of the last one; stopping the skid breaks the trail.
 */
export class SkidEmitter {
  private has = false;
  private lx = 0;
  private lz = 0;
  private readonly seg: SkidSegment = { ax: 0, az: 0, bx: 0, bz: 0 };

  constructor(private readonly minSegment = 0.4) {}

  update(x: number, z: number, skidding: boolean): SkidSegment | null {
    if (!skidding) {
      this.has = false;
      return null;
    }
    if (!this.has) {
      this.has = true;
      this.lx = x;
      this.lz = z;
      return null;
    }
    const d = Math.hypot(x - this.lx, z - this.lz);
    if (d > MAX_JUMP) {
      this.lx = x;
      this.lz = z;
      return null;
    }
    if (d < this.minSegment) return null;
    this.seg.ax = this.lx;
    this.seg.az = this.lz;
    this.seg.bx = x;
    this.seg.bz = z;
    this.lx = x;
    this.lz = z;
    return this.seg;
  }

  reset(): void {
    this.has = false;
  }
}
