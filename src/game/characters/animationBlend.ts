// Pure blending math for character animation: framerate-independent damping,
// speed-driven Idle/Walk/Run weights, the shared gait cycle rate, one-shot
// fade envelopes and a minimum-dwell boolean filter. No THREE, unit-tested.

/**
 * Exponential smoothing towards `target` with time constant `tau` (s).
 * Framerate-independent: n steps of dt equal one step of n*dt.
 */
export function damp(current: number, target: number, tau: number, dt: number): number {
  if (tau <= 0) return target;
  return target + (current - target) * Math.exp(-dt / tau);
}

/** Hermite smoothstep of x between e0 and e1 (C1-continuous 0..1 ramp). */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Speed (m/s) where idle starts giving way to walk / walk is full. */
export const WALK_START_SPEED = 0.1;
export const WALK_FULL_SPEED = 1.3;
/** Speed range of the walk -> run crossfade. Wide on purpose so decelerating
 * through it never changes weights faster than a few % per frame. */
export const RUN_START_SPEED = 1.7;
export const RUN_FULL_SPEED = 3.6;

export interface LocomotionWeights {
  idle: number;
  walk: number;
  run: number;
}

/** Idle/Walk/Run weights for a (smoothed) speed. Always sums to 1 and is continuous. */
export function locomotionWeights(speed: number): LocomotionWeights {
  const moving = smoothstep(WALK_START_SPEED, WALK_FULL_SPEED, speed);
  const running = smoothstep(RUN_START_SPEED, RUN_FULL_SPEED, speed);
  return { idle: 1 - moving, walk: moving * (1 - running), run: moving * running };
}

/** Authored cycle lengths (s) and the speed (m/s) each cycle matches at 1x. */
const WALK_CYCLE = 1.33;
const WALK_REF_SPEED = 1.4;
const RUN_CYCLE = 0.8;
const RUN_REF_SPEED = 3.8;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Gait cycles per second for a (smoothed) speed. Walk and Run share one
 * normalised phase advanced at this rate, so blending them never pops the feet.
 */
export function gaitRate(speed: number): number {
  const walk = clamp(speed / WALK_REF_SPEED, 0.6, 1.8) / WALK_CYCLE;
  const run = clamp(speed / RUN_REF_SPEED, 0.7, 1.8) / RUN_CYCLE;
  const r = smoothstep(RUN_START_SPEED, RUN_FULL_SPEED, speed);
  return walk * (1 - r) + run * r;
}

/**
 * Weight of a one-shot clip `elapsed` seconds into its `duration`: linear
 * fade-in, hold, linear fade-out ending exactly at `duration`. `fadeOut = 0`
 * holds full weight past the end (clamped clips such as Death).
 */
export function oneShotWeight(elapsed: number, duration: number, fadeIn: number, fadeOut: number): number {
  if (elapsed <= 0) return 0;
  const fin = fadeIn > 0 ? elapsed / fadeIn : 1;
  const fout = fadeOut > 0 ? (duration - elapsed) / fadeOut : 1;
  return Math.max(0, Math.min(1, fin, fout));
}

/**
 * Boolean filter with a minimum dwell time: after switching, the output holds
 * for at least `minDwell` seconds, so noisy inputs (remote snapshots, quick
 * clicks) can't make the animation flicker. The first change is immediate.
 */
export class DwellFlag {
  private sinceChange: number;

  constructor(
    private state: boolean,
    private readonly minDwell: number,
  ) {
    this.sinceChange = minDwell;
  }

  update(input: boolean, dt: number): boolean {
    this.sinceChange += dt;
    if (input !== this.state && this.sinceChange >= this.minDwell) {
      this.state = input;
      this.sinceChange = 0;
    }
    return this.state;
  }

  get value(): boolean {
    return this.state;
  }
}
