// Turn-in-place yaw controller: separates where a character faces (gameplay
// yaw: aim / movement heading) from where its feet and hips point. Small
// facing changes are absorbed by twisting the upper body (the spine leads,
// the hips stay); past a trigger angle the lower body steps round to catch up
// (the rig plays a short shuffle while `turnRate` is non-zero), a moderate
// twist held for a while relaxes back, and while moving the hips simply
// follow with a small lag. Pure (no THREE), unit-tested.

import { angDiff, clamp } from "../core/math";

/** Tunables (rad, rad/s, s, m/s). */
export const TURN_TUNING = {
  /** Twist (≈66°) that makes an idle character step its feet round. */
  triggerAngle: 1.15,
  /** A catch-up turn stops once the twist is this small (≈4.5°). */
  settleAngle: 0.08,
  /** Hard limit of the upper-body twist (≈80°): beyond it the hips are dragged along. */
  maxTwist: 1.4,
  /** Catch-up turn speed: gain on the remaining angle, clamped to [min, max]. */
  turnGain: 7,
  turnSpeedMin: 2.6,
  turnSpeedMax: 7.5,
  /** Above this speed the hips follow the facing continuously (exponential rate, 1/s). */
  movingSpeed: 0.4,
  moveFollowRate: 11,
  /** A twist above this (≈23°) held for relaxDelay seconds is realigned. */
  relaxAngle: 0.4,
  relaxDelay: 1.6,
} as const;

const T = TURN_TUNING;

export class TurnInPlace {
  /** Yaw (rad) of the lower body (feet / hips). */
  bodyYaw: number;
  /** Facing minus lower-body yaw (rad, + = facing to the body's left): what the spine twists. */
  twist = 0;
  /** Lower-body yaw rate this step (rad/s; 0 while planted). */
  turnRate = 0;
  /** A catch-up step turn is in progress. */
  turning = false;
  private heldTwist = 0;

  constructor(yaw = 0) {
    this.bodyYaw = yaw;
  }

  /** Advances `dt` seconds towards facing `targetYaw` at horizontal `speed` (m/s). */
  update(dt: number, targetYaw: number, speed: number): void {
    if (!(dt > 0)) return;
    const before = this.bodyYaw;
    let err = angDiff(this.bodyYaw, targetYaw);
    if (speed > T.movingSpeed) {
      // Moving: hips follow the facing with a short lag.
      this.turning = false;
      this.heldTwist = 0;
      err *= Math.exp(-T.moveFollowRate * dt);
    } else {
      const abs = Math.abs(err);
      this.heldTwist = abs > T.relaxAngle ? this.heldTwist + dt : 0;
      if (!this.turning && (abs > T.triggerAngle || this.heldTwist >= T.relaxDelay)) this.turning = true;
      if (this.turning) {
        const rate = clamp(abs * T.turnGain, T.turnSpeedMin, T.turnSpeedMax);
        const step = Math.min(abs, rate * dt);
        err -= Math.sign(err) * step;
        if (Math.abs(err) <= T.settleAngle) {
          this.turning = false;
          this.heldTwist = 0;
        }
      }
    }
    // Never twist past the limit: the hips get dragged round instead.
    err = clamp(err, -T.maxTwist, T.maxTwist);
    this.bodyYaw = targetYaw - err;
    this.twist = err;
    const moved = angDiff(before, this.bodyYaw);
    this.turnRate = Math.abs(moved) > 1e-9 ? moved / dt : 0;
  }

  /** Snaps the lower body to `yaw` (spawn, teleport, death). */
  reset(yaw: number): void {
    this.bodyYaw = yaw;
    this.twist = 0;
    this.turnRate = 0;
    this.turning = false;
    this.heldTwist = 0;
  }
}
