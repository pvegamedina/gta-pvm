// Pure blending math for character animation: framerate-independent damping,
// speed-driven Idle/Walk/Run weights, the shared (stride-matched) gait cycle
// rate, the start/stop body lean, one-shot fade envelopes and a minimum-dwell
// boolean filter. No THREE, unit-tested.

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
/** Speed range of the walk -> run crossfade. Starts just above the player's
 * cruising walk (2.3 m/s, player/footMotion.ts) so walking shows the walk
 * clip, and is wide on purpose: the ~1 s sprint build-up (and any slow-down)
 * morphs through it progressively, a few % per frame. */
export const RUN_START_SPEED = 2.5;
export const RUN_FULL_SPEED = 5.2;

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
/** Ground covered (m) by one full gait cycle (two steps) of each clip. */
export const WALK_STRIDE = WALK_REF_SPEED * WALK_CYCLE;
export const RUN_STRIDE = RUN_REF_SPEED * RUN_CYCLE;
/** Playback-speed limits per clip: beyond them a clip looks sped up/slowed down
 * more than the sliding it would hide (standing still, or faster than a sprint). */
const WALK_RATE_MIN = 0.6;
const WALK_RATE_MAX = 1.8;
const RUN_RATE_MIN = 0.7;
const RUN_RATE_MAX = 2.0;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Ground covered (m) per cycle by the strafe / back-pedal clips (Run_Left,
 * Run_Right, Run_Back: ~0.8 s cycles whose planted foot moves at ~3.1 m/s at 1x,
 * measured from the foot bones). Their tempo range is wider at the slow end:
 * aim-walking strafes play them at ~0.75x. */
export const STRAFE_STRIDE = 2.5;
const STRAFE_CYCLE = 0.8;
const STRAFE_RATE_MIN = 0.5;
const STRAFE_RATE_MAX = 2.0;

/**
 * Gait cycles per second for a (smoothed) speed. Every locomotion clip shares
 * one normalised phase advanced at this rate, so blending them never pops the
 * feet. The rate is stride-matched (speed / stride, with the stride itself
 * blended between the clips) so planted feet stay planted on the ground;
 * only outside each clip's believable tempo range is it clamped.
 * `forward` is the share (0..1) of the forward clips (Walk/Run) in the
 * directional blend; the rest are the strafe / back-pedal clips.
 */
export function gaitRate(speed: number, forward = 1): number {
  const r = smoothstep(RUN_START_SPEED, RUN_FULL_SPEED, speed);
  const f = clamp(forward, 0, 1);
  const stride = mix(STRAFE_STRIDE, mix(WALK_STRIDE, RUN_STRIDE, r), f);
  const lo = mix(STRAFE_RATE_MIN / STRAFE_CYCLE, mix(WALK_RATE_MIN / WALK_CYCLE, RUN_RATE_MIN / RUN_CYCLE, r), f);
  const hi = mix(STRAFE_RATE_MAX / STRAFE_CYCLE, mix(WALK_RATE_MAX / WALK_CYCLE, RUN_RATE_MAX / RUN_CYCLE, r), f);
  return clamp(speed / stride, lo, hi);
}

export interface DirectionalWeights {
  fwd: number;
  back: number;
  left: number;
  right: number;
}

/**
 * Forward / back / left / right shares of a local move direction (x = the
 * character's left, z = its forward; any length). Squared direction cosines,
 * so they always sum to 1, diagonals split evenly and sweeping the direction
 * round the circle crossfades continuously (an 8-way blend from 4 clips).
 * A (near) zero vector counts as forward.
 */
export function directionalWeights(x: number, z: number, out: DirectionalWeights = { fwd: 1, back: 0, left: 0, right: 0 }): DirectionalWeights {
  const l2 = x * x + z * z;
  if (l2 < 1e-12) {
    out.fwd = 1;
    out.back = out.left = out.right = 0;
    return out;
  }
  const cz = (z * z) / l2;
  const cx = (x * x) / l2;
  out.fwd = z > 0 ? cz : 0;
  out.back = z < 0 ? cz : 0;
  out.left = x > 0 ? cx : 0;
  out.right = x < 0 ? cx : 0;
  return out;
}

/**
 * World XZ velocity (vx, vz) in the frame of a character facing `yaw`
 * (forward = (sin yaw, cos yaw)): out.z along its forward, out.x towards its
 * left (+X of the rig).
 */
export function localDirection(vx: number, vz: number, yaw: number, out: { x: number; z: number }): { x: number; z: number } {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  out.x = vx * c - vz * s;
  out.z = vx * s + vz * c;
  return out;
}

/** Body lean (rad) per m/s² of acceleration, and its cap (~8°: subtle). */
const LEAN_PER_ACCEL = 0.03;
export const MAX_LEAN = 0.14;

/**
 * Upper-body pitch for a horizontal acceleration (m/s², + = speeding up):
 * people lean into a start and rock back while braking. Odd, monotonic and
 * soft-saturating (tanh) at ±MAX_LEAN.
 */
export function leanFromAccel(accel: number): number {
  return MAX_LEAN * Math.tanh((accel * LEAN_PER_ACCEL) / MAX_LEAN);
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
