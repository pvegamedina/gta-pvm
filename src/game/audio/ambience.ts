// Pure decisions behind the ambient sound (synthesized in ambienceSynth.ts):
// footstep cadence from the on-foot speed (the same speeds the locomotion
// clips are tuned to), a timbre per ground surface, the day/night bed
// crossfade driven by the environment's night factor, wind from altitude and
// speed, and bird-call spacing. No WebAudio, tested.

import type { GroundSurface } from "../world/campus/groundMaterial";

/** Below this speed (m/s) there are no footsteps (idle shuffles are silent). */
const STEP_MIN_SPEED = 0.4;
/** Steps per second = STEP_BASE + STEP_PER_MS * speed (≈1.8/s walking, ≈2.9/s sprinting), capped. */
const STEP_BASE = 1.15;
const STEP_PER_MS = 0.27;
const STEP_MAX_RATE = 3.2;

export function footstepRate(speed: number): number {
  if (!(speed >= STEP_MIN_SPEED)) return 0;
  return Math.min(STEP_MAX_RATE, STEP_BASE + STEP_PER_MS * speed);
}

export type FootstepEvent = "none" | "step" | "land";

/**
 * Footstep scheduler: a phase advancing at footstepRate(speed) fires a step
 * at each wrap. Starting from standstill the phase is primed so the first
 * step lands quickly; airborne it pauses, and touching down reports "land".
 */
export class FootstepClock {
  private phase = 0.6;
  private wasGrounded: boolean | null = null;

  step(dt: number, speed: number, grounded: boolean): FootstepEvent {
    const prev = this.wasGrounded;
    this.wasGrounded = grounded;
    if (!grounded) return "none";
    if (prev === false) {
      // Landing restarts the gait half a step in.
      this.phase = 0.5;
      return "land";
    }
    const rate = footstepRate(speed);
    if (rate === 0) {
      this.phase = 0.6;
      return "none";
    }
    this.phase += rate * dt;
    if (this.phase >= 1) {
      this.phase -= Math.floor(this.phase);
      return "step";
    }
    return "none";
  }
}

/** How one footstep on a surface is synthesized (ambienceSynth.ts). */
export interface FootstepProfile {
  /** Filtered-noise "scuff": filter type, centre/cutoff (Hz), Q, gain and decay (s). */
  filter: BiquadFilterType;
  noiseHz: number;
  q: number;
  gain: number;
  decay: number;
  /** Low heel "thump" (sine) frequency (Hz) and relative gain. */
  thumpHz: number;
  thumpGain: number;
  /** Extra short high clicks for loose stones (gravel crunch); 0 = none. */
  grains: number;
}

export const FOOTSTEP_PROFILES: Record<GroundSurface, FootstepProfile> = {
  // Hard, slightly gritty scuff with a firm heel.
  asphalt: { filter: "bandpass", noiseHz: 1800, q: 0.9, gain: 0.22, decay: 0.07, thumpHz: 95, thumpGain: 0.16, grains: 0 },
  // Paving: brighter, clickier, shorter.
  pavement: { filter: "bandpass", noiseHz: 2600, q: 1.4, gain: 0.2, decay: 0.05, thumpHz: 120, thumpGain: 0.14, grains: 0 },
  // Grass: soft, dull swish, almost no heel.
  grass: { filter: "lowpass", noiseHz: 900, q: 0.6, gain: 0.12, decay: 0.12, thumpHz: 70, thumpGain: 0.05, grains: 0 },
  // Gravel: broadband crunch made of several tiny grains.
  gravel: { filter: "bandpass", noiseHz: 3200, q: 0.7, gain: 0.18, decay: 0.1, thumpHz: 80, thumpGain: 0.08, grains: 5 },
};

/** Overall step loudness: louder when running, landings the loudest. */
export function footstepGain(speed: number, landing: boolean): number {
  if (landing) return 1.6;
  return 0.65 + Math.min(1, Math.max(0, speed / 6.6)) * 0.55;
}

/** Ambient bed weights (0..1). */
export interface AmbienceMix {
  /** Distant city hum + birds. */
  day: number;
  /** Crickets. */
  night: number;
  wind: number;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * `nightF` from the environment (0 day .. 1 night), `altitude` (m above the
 * lowest ground of the map) and `speed` (m/s of the listener). Day/night use
 * an equal-power crossfade across dusk/dawn; wind has a gentle floor and
 * grows with height and speed.
 */
export function ambienceMix(nightF: number, altitude: number, speed: number): AmbienceMix {
  const n = smoothstep(0.15, 0.85, nightF);
  const wind = Math.min(1, 0.12 + Math.max(0, altitude) / 45 + Math.max(0, speed) / 45);
  return { day: Math.cos((n * Math.PI) / 2), night: Math.sin((n * Math.PI) / 2), wind };
}

/** Seconds until the next bird call (r uniform in [0, 1)). */
export function nextBirdDelay(r: number): number {
  return 1.5 + r * 7;
}
