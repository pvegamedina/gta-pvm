// Pure inertial on-foot locomotion: the horizontal velocity chases the
// desired one with human-like limits instead of snapping to it. Speed changes
// along the current heading (accelerate / ease off / brake with a short
// slide-out) and the heading turns with a bounded lateral acceleration, so
// direction changes arc (tighter when walking than when sprinting) and a full
// reversal brakes through zero instead of sliding sideways. Airborne, only a
// small fraction of the control remains. No THREE, unit-tested.

import { angDiff, clamp } from "../core/math";

export interface FootVelocity {
  x: number;
  z: number;
}

export interface FootMoveInput {
  /** Desired move direction (unit XZ vector), or (0, 0) for no input. */
  dirX: number;
  dirZ: number;
  run: boolean;
  /** Full control on the ground; AIR_CONTROL of it while airborne. */
  ground: boolean;
}

/** Tunables (m/s, m/s², rad). Exported so the animation thresholds can follow them. */
export const FOOT_TUNING = {
  /** Cruising speed without Shift: a brisk walk (the walk clip, not a jog). */
  walkSpeed: 2.3,
  /** Sprint speed with Shift. */
  runSpeed: 6.6,
  /** Acceleration from standstill up to walking pace. */
  walkAccel: 6,
  /** Acceleration above walking pace: walk -> sprint takes about one second. */
  runAccel: 4.4,
  /** Deceleration with no input (stopping). */
  brake: 8,
  /** Deceleration when the desired speed is lower but non-zero (Shift released, sharp turn). */
  slowDown: 5,
  /** The last bit of a stop eases off (short slide-out): braking scales by
   * clamp(STOP_EASE_MIN + speed / STOP_EASE_SPEED, ..., 1). */
  stopEaseMin: 0.4,
  stopEaseSpeed: 1.5,
  /** Max sideways acceleration while turning: turn rate = lateralAccel / speed. */
  lateralAccel: 14,
  /** Below this speed the body simply pivots to face any new direction. */
  pivotSpeed: 0.5,
  /** Inputs more than this far behind the heading brake first, then pivot (~137°). */
  reverseAngle: 2.4,
  /** Speed kept (fraction) while carving a 90°+ turn. */
  turnSpeedKeep: 0.65,
  /** Share of acceleration/turning available while airborne (no braking at all). */
  airControl: 0.15,
} as const;

const T = FOOT_TUNING;

/** Moves `v` towards `target` by at most `maxDelta`. */
function approach(v: number, target: number, maxDelta: number): number {
  return v < target ? Math.min(target, v + maxDelta) : Math.max(target, v - maxDelta);
}

/** Braking deceleration at speed `s`, easing off over the last metre per second or so. */
function brakeAt(s: number): number {
  return T.brake * clamp(T.stopEaseMin + s / T.stopEaseSpeed, T.stopEaseMin, 1);
}

/**
 * Advances the horizontal velocity `v` by `dt` seconds towards the input's
 * desired velocity. Returns `out` (a new object by default); `v` is not mutated.
 */
export function stepFootVelocity(v: FootVelocity, input: FootMoveInput, dt: number, out: FootVelocity = { x: 0, z: 0 }): FootVelocity {
  const control = input.ground ? 1 : T.airControl;
  let s = Math.hypot(v.x, v.z);
  let heading = s > 1e-9 ? Math.atan2(v.x, v.z) : 0;
  const wants = input.dirX !== 0 || input.dirZ !== 0;

  if (!wants) {
    // No input: brake on the ground, keep momentum in the air.
    if (input.ground) s = Math.max(0, s - brakeAt(s) * dt);
  } else {
    const targetHeading = Math.atan2(input.dirX, input.dirZ);
    const maxSpeed = input.run ? T.runSpeed : T.walkSpeed;
    let delta = s < T.pivotSpeed ? 0 : angDiff(heading, targetHeading);
    if (s < T.pivotSpeed) heading = targetHeading;

    let targetSpeed: number;
    if (Math.abs(delta) > T.reverseAngle) {
      // Turning around: plant and brake along the current heading first.
      targetSpeed = 0;
    } else {
      // Carve towards the input with bounded lateral acceleration.
      const maxTurn = ((T.lateralAccel * control) / Math.max(s, T.pivotSpeed)) * dt;
      const turn = clamp(delta, -maxTurn, maxTurn);
      heading += turn;
      delta -= turn;
      // Sharp turns shed some speed (people slow down to change direction).
      const sharp = Math.min(1, Math.abs(delta) / (Math.PI / 2));
      targetSpeed = maxSpeed * (1 - (1 - T.turnSpeedKeep) * sharp);
    }

    let rate: number;
    if (s < targetSpeed) rate = (s < T.walkSpeed ? T.walkAccel : T.runAccel) * control;
    else rate = input.ground ? (targetSpeed === 0 ? brakeAt(s) : T.slowDown) : 0;
    // Accelerating across walking pace: split the step so the result doesn't depend on dt.
    if (s < T.walkSpeed && targetSpeed > T.walkSpeed && rate > 0) {
      const toWalk = (T.walkSpeed - s) / rate;
      s = toWalk >= dt ? s + rate * dt : Math.min(targetSpeed, T.walkSpeed + T.runAccel * control * (dt - toWalk));
    } else {
      s = approach(s, targetSpeed, rate * dt);
    }
    // Once a reversal has bled off its speed, pivot and go.
    if (targetSpeed === 0 && s < T.pivotSpeed) {
      heading = targetHeading;
      s = Math.min(maxSpeed, T.walkAccel * control * dt);
    }
  }

  if (s <= 0) {
    out.x = 0;
    out.z = 0;
  } else {
    out.x = Math.sin(heading) * s;
    out.z = Math.cos(heading) * s;
  }
  return out;
}
