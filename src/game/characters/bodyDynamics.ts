// Body-level procedural layers that give the animated characters weight,
// driven by how the character actually moves (velocity, its derivative and
// the vertical speed), all through framerate-independent springs
// (core/spring.ts):
//  - forward / back lean from the acceleration along the facing, on an
//    underdamped spring so a hard stop rocks back, then settles forward;
//  - banking into turns from the sideways (centripetal) acceleration;
//  - pelvis: a landing squash (velocity kick proportional to the fall speed)
//    plus a slight extra bob with the gait;
//  - breathing on the chest, deeper and faster after sprinting.
// WeaponSway is the held gun's inertia when the view turns or the body moves.
// Pure (no THREE): characters/locomotionPose.ts puts the numbers on bones.

import { SpringDamper } from "../core/spring";
import { clamp, smooth } from "../core/math";
import { damp } from "./animationBlend";

/** Tunables (rad, m, s, Hz). */
export const BODY_TUNING = {
  /** Velocity smoothing before differentiating (s): tames per-frame steps. */
  velocityTau: 0.08,
  /** Lean per m/s² of forward acceleration and its soft cap (≈11°). */
  leanPerAccel: 0.03,
  leanMax: 0.2,
  /** Lean spring: underdamped, so stops overshoot and settle. */
  leanFrequency: 2,
  leanDamping: 0.4,
  /** Bank = atan(a_lat / g) * bankGain, capped (≈11°), faded in with speed. */
  bankGain: 0.7,
  bankMax: 0.2,
  bankFrequency: 2.5,
  /** Pelvis squash spring and the landing kick (m/s of pelvis speed per m/s of fall). */
  pelvisFrequency: 3.2,
  pelvisDamping: 0.5,
  landKick: 0.6,
  landMaxDip: 0.2,
  /** Extra gait bob depth (m) at full speed. */
  bobDepth: 0.012,
  /** Breathing: chest pitch amplitude (rad) and rate (Hz), at rest and fully winded. */
  breathAmp: 0.01,
  breathAmpWinded: 0.028,
  breathRate: 0.25,
  breathRateWinded: 0.6,
  /** Speed (m/s) above which the character gets winded, and the build-up / recovery times. */
  sprintSpeed: 4.5,
  windedRise: 3,
  windedRecover: 5,
} as const;

const B = BODY_TUNING;
const G = 9.81;
const TWO_PI = Math.PI * 2;

export interface BodyInput {
  /** World horizontal velocity (m/s). */
  vx: number;
  vz: number;
  /** Facing yaw (rad; forward = (sin, cos)). */
  yaw: number;
  grounded: boolean;
  /** Vertical velocity (m/s, + = up). */
  vy: number;
  /** Normalised gait phase (0..1) of the locomotion clips. */
  gaitPhase: number;
  alive: boolean;
}

/** Extra pelvis drop (≤ 0) over a gait cycle: lowest just after each foot plants. */
function gaitBob(phase: number, speed: number): number {
  return -B.bobDepth * smooth(0.5, 3, speed) * (0.5 + 0.5 * Math.cos(2 * TWO_PI * (phase - 0.12)));
}

export class BodyDynamics {
  /** Spine pitch (rad, + = forward). */
  pitch = 0;
  /** Whole-body roll (rad, + = leaning to the character's left). */
  roll = 0;
  /** Pelvis height offset (m). */
  pelvisY = 0;
  /** Chest breathing pitch (rad). */
  breath = 0;

  private readonly lean = new SpringDamper(B.leanFrequency, B.leanDamping);
  private readonly bank = new SpringDamper(B.bankFrequency, 1);
  private readonly squash = new SpringDamper(B.pelvisFrequency, B.pelvisDamping);
  private fvx = 0;
  private fvz = 0;
  private wasGrounded = true;
  private airVy = 0;
  private winded = 0;
  private breathPhase = 0;
  private aliveW = 1;

  update(dt: number, s: BodyInput): void {
    if (!(dt > 0)) return;
    // Acceleration from the smoothed velocity, split along the facing.
    const k = 1 - Math.exp(-dt / B.velocityTau);
    const ax = ((s.vx - this.fvx) * k) / dt;
    const az = ((s.vz - this.fvz) * k) / dt;
    this.fvx += (s.vx - this.fvx) * k;
    this.fvz += (s.vz - this.fvz) * k;
    const sin = Math.sin(s.yaw);
    const cos = Math.cos(s.yaw);
    const aFwd = ax * sin + az * cos;
    const aLat = ax * cos - az * sin;
    const speed = Math.hypot(this.fvx, this.fvz);
    const live = s.alive;

    const leanTarget = live && s.grounded ? B.leanMax * Math.tanh((aFwd * B.leanPerAccel) / B.leanMax) : 0;
    this.pitch = this.lean.update(dt, leanTarget);
    const bankTarget = live && s.grounded ? clamp(Math.atan(aLat / G) * B.bankGain, -B.bankMax, B.bankMax) * smooth(0.5, 2, speed) : 0;
    this.roll = clamp(this.bank.update(dt, bankTarget), -B.bankMax, B.bankMax);

    // Landing squash: kick the pelvis spring down by the speed of the fall.
    if (!s.grounded) this.airVy = Math.min(this.airVy, s.vy);
    if (s.grounded && !this.wasGrounded && live) {
      const fall = Math.max(0, -this.airVy);
      this.squash.kick(-Math.min(fall * B.landKick, (B.landMaxDip * TWO_PI * B.pelvisFrequency) / 0.55));
    }
    if (s.grounded) this.airVy = 0;
    this.wasGrounded = s.grounded;
    this.squash.update(dt, 0);
    const bob = live && s.grounded ? gaitBob(s.gaitPhase, speed) : 0;
    this.pelvisY = Math.max(-B.landMaxDip, this.squash.value + bob);

    // Breathing, winded after sprinting.
    this.aliveW = damp(this.aliveW, live ? 1 : 0, 0.3, dt);
    this.winded = damp(this.winded, live && speed > B.sprintSpeed ? 1 : 0, speed > B.sprintSpeed ? B.windedRise : B.windedRecover, dt);
    this.breathPhase = (this.breathPhase + dt * (B.breathRate + (B.breathRateWinded - B.breathRate) * this.winded)) % 1;
    const amp = B.breathAmp + (B.breathAmpWinded - B.breathAmp) * this.winded;
    this.breath = amp * Math.sin(TWO_PI * this.breathPhase) * this.aliveW;
  }
}

export interface SwayInput {
  /** Facing (view) yaw rate (rad/s, + = turning left). */
  yawRate: number;
  /** Aim pitch rate (rad/s, + = looking up). */
  pitchRate: number;
  /** Velocity towards the character's left (m/s). */
  lateral: number;
  speed: number;
  gaitPhase: number;
}

/** Tunables (rad, m, Hz). */
export const SWAY_TUNING = {
  yawPerRate: 0.02,
  yawMax: 0.07,
  pitchPerRate: 0.015,
  pitchMax: 0.04,
  sidePerSpeed: 0.006,
  sideMax: 0.02,
  bobDepth: 0.006,
  angleFrequency: 2.4,
  angleDamping: 0.55,
  offsetFrequency: 3,
  offsetDamping: 0.7,
} as const;

const S = SWAY_TUNING;

/** Held-weapon inertia: the gun lags behind view turns and body motion and bobs with the gait. */
export class WeaponSway {
  /** Barrel yaw / pitch offsets (rad). */
  yaw = 0;
  pitch = 0;
  /** Grip offset towards the character's left / up (m). */
  x = 0;
  y = 0;
  private readonly yawS = new SpringDamper(S.angleFrequency, S.angleDamping);
  private readonly pitchS = new SpringDamper(S.angleFrequency, S.angleDamping);
  private readonly xS = new SpringDamper(S.offsetFrequency, S.offsetDamping);
  private readonly yS = new SpringDamper(S.offsetFrequency, S.offsetDamping);

  update(dt: number, s: SwayInput): void {
    this.yaw = this.yawS.update(dt, clamp(-s.yawRate * S.yawPerRate, -S.yawMax, S.yawMax));
    this.pitch = this.pitchS.update(dt, clamp(-s.pitchRate * S.pitchPerRate, -S.pitchMax, S.pitchMax));
    this.x = this.xS.update(dt, clamp(-s.lateral * S.sidePerSpeed, -S.sideMax, S.sideMax));
    const bob = -S.bobDepth * smooth(0.3, 2.5, s.speed) * (0.5 + 0.5 * Math.cos(2 * TWO_PI * (s.gaitPhase - 0.12)));
    this.y = this.yS.update(dt, bob);
  }
}
