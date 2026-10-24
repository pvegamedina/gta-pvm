// Pure foot-IK decisions for the skinned characters (characters/locomotionPose.ts
// applies them to the bones): how far to move the pelvis so the lower foot
// reaches the ground (slopes, kerbs, the visual road / sidewalk lift), how to
// tilt a planted foot onto the ground normal, how "planted" a foot is from its
// animated height, and a foot-lock state machine that pins a planted foot in
// world space (no skating when the clip's stride doesn't match the speed) and
// releases it with a short blend when it lifts. No THREE, unit-tested.

import { clamp } from "../core/math";

/** Tunables (m, rad, s). */
export const FOOT_IK = {
  /** Pelvis may drop this much to reach a lower foothold, and rise this much onto raised ground. */
  maxPelvisDrop: 0.45,
  maxPelvisRaise: 0.25,
  /** Max foot tilt onto the ground normal (≈26°). */
  maxFootTilt: 0.45,
  /** Animated foot height (above the character's floor) below which a foot plants / above which it lifts. */
  contactEnter: 0.045,
  contactExit: 0.075,
  /** Heights over which a foot goes from fully planted (tilted, locked) to fully swinging. */
  stanceLow: 0.04,
  stanceHigh: 0.16,
  /** A locked foot lets go once the animated foot is this far from the pin. */
  maxLockDrift: 0.3,
  /** Pins farther than this from the animation (teleports) are dropped at once. */
  lockTeleport: 1.5,
  /** Time to blend a released foot back onto the animation. */
  lockRelease: 0.12,
} as const;

/**
 * Pelvis height offset (m) for the ground deltas under each foot (ground
 * height minus the character's root height): the lower foot must reach its
 * ground, so the pelvis takes the smaller delta, clamped. Both feet above the
 * root raise the body.
 */
export function pelvisOffset(deltaL: number, deltaR: number): number {
  return clamp(Math.min(deltaL, deltaR), -FOOT_IK.maxPelvisDrop, FOOT_IK.maxPelvisRaise);
}

export interface FootTilt {
  /** Horizontal rotation axis (unit, world XZ). */
  ax: number;
  az: number;
  /** Rotation angle (rad) about it, capped. */
  angle: number;
}

/**
 * World rotation that tilts a foot from flat onto the ground with unit
 * normal (nx, ny, nz): about up x n, by the slope angle (capped at maxFootTilt).
 */
export function footTilt(nx: number, ny: number, nz: number, out: FootTilt = { ax: 1, az: 0, angle: 0 }): FootTilt {
  const len = Math.hypot(nz, nx);
  if (len < 1e-9) {
    out.ax = 1;
    out.az = 0;
    out.angle = 0;
    return out;
  }
  out.ax = nz / len;
  out.az = -nx / len;
  out.angle = Math.min(Math.acos(clamp(ny, -1, 1)), FOOT_IK.maxFootTilt);
  return out;
}

/** 1 while a foot is planted, 0 high in its swing (smooth in between), from its animated height. */
export function stanceWeight(height: number): number {
  const t = clamp((height - FOOT_IK.stanceLow) / (FOOT_IK.stanceHigh - FOOT_IK.stanceLow), 0, 1);
  return 1 - t * t * (3 - 2 * t);
}

/**
 * Pins a planted foot's world XZ position: locks when the animated foot comes
 * down (height below contactEnter), holds while it stays down (hysteresis up
 * to contactExit) and the animation stays within maxLockDrift of the pin,
 * then releases, blending from the pin back to the animation over lockRelease.
 */
export class FootLock {
  locked = false;
  private x = 0;
  private z = 0;
  /** Weight of the pin in the output (1 locked, fading to 0 after a release). */
  private weight = 0;
  /** Released by drift while still planted: no new pin until the foot lifts. */
  private needsLift = false;

  /**
   * Feeds this frame's animated foot (world XZ, height above the character's
   * floor) and writes the foot position to use into `out`.
   */
  update(dt: number, animX: number, animZ: number, height: number, enabled: boolean, out: { x: number; z: number }): { x: number; z: number } {
    const drift = Math.hypot(animX - this.x, animZ - this.z);
    if (this.locked && (!enabled || height > FOOT_IK.contactExit || drift > FOOT_IK.maxLockDrift)) {
      this.locked = false;
      // Dragged off its pin while still down: wait for the next step to plant again.
      if (drift > FOOT_IK.maxLockDrift && height <= FOOT_IK.contactExit) this.needsLift = true;
    }
    if (height > FOOT_IK.contactExit) this.needsLift = false;
    if (!this.locked && enabled && !this.needsLift && height < FOOT_IK.contactEnter) {
      // Pin where the foot is shown right now (mid-release too), so nothing pops.
      const w = drift > FOOT_IK.lockTeleport ? 0 : this.weight;
      this.x = animX + (this.x - animX) * w;
      this.z = animZ + (this.z - animZ) * w;
      this.weight = 1;
      this.locked = true;
    }
    if (!this.locked) {
      this.weight = !enabled || drift > FOOT_IK.lockTeleport ? 0 : Math.max(0, this.weight - dt / FOOT_IK.lockRelease);
    }
    const w = this.weight;
    out.x = animX + (this.x - animX) * w;
    out.z = animZ + (this.z - animZ) * w;
    return out;
  }

  /** Forgets any pin (teleport, death, IK switched off). */
  reset(): void {
    this.locked = false;
    this.weight = 0;
    this.needsLift = false;
  }
}
