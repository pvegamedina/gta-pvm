// Third-person camera "feel" layers (camera/camera.ts), scaled by the
// "Movimiento de cámara" setting (0..1): a spring-follow of the focus point
// (slight lag when sprinting, a soft settle when stopping; stays tight while
// aiming), the FOV widening of a sprint, and a dip when landing a jump. None
// of them touches the view's yaw / pitch, so aiming precision is unaffected.
// Pure (no THREE), unit-tested.

import { SpringDamper } from "../core/spring";
import { smooth } from "../core/math";
import { FOOT_TUNING } from "../player/footMotion";

/** Tunables (Hz, degrees, m, m/s). */
export const CAMERA_FEEL = {
  /** Focus spring while moving freely: lags ~0.75 m behind a sprint, settles with a hint of overshoot. */
  followFrequency: 2.4,
  followDamping: 0.85,
  /** Focus spring while aiming: tight (≈0.1 m behind an aimed walk). */
  aimFrequency: 6,
  /** Extra FOV (degrees) at a full sprint. */
  sprintFov: 6,
  /** Fall speeds below this don't dip the camera (kerbs, steps). */
  landMinFall: 2.5,
  /** Camera speed (m/s) kicked down per m/s of fall above landMinFall, and the max dip (m). */
  landKick: 0.5,
  landMaxDip: 0.15,
  landFrequency: 2.2,
  landDamping: 0.6,
} as const;

const C = CAMERA_FEEL;

/** Focus point follower: legacy exponential (motion 0) blended with a spring (motion 1). */
export class CameraFollow {
  x = 0;
  y = 0;
  z = 0;
  private ex = 0;
  private ey = 0;
  private ez = 0;
  private readonly sx = new SpringDamper(C.followFrequency, C.followDamping);
  private readonly sy = new SpringDamper(C.followFrequency, C.followDamping);
  private readonly sz = new SpringDamper(C.followFrequency, C.followDamping);

  /**
   * Advances towards the target point. `rate` is the legacy exponential
   * follow rate (1/s), `motion` the camera-motion setting (0..1).
   */
  update(dt: number, tx: number, ty: number, tz: number, rate: number, motion: number, aiming: boolean): void {
    const k = 1 - Math.exp(-dt * rate);
    this.ex += (tx - this.ex) * k;
    this.ey += (ty - this.ey) * k;
    this.ez += (tz - this.ez) * k;
    const f = aiming ? C.aimFrequency : C.followFrequency;
    const z = aiming ? 1 : C.followDamping;
    this.sx.frequency = this.sy.frequency = this.sz.frequency = f;
    this.sx.damping = this.sy.damping = this.sz.damping = z;
    const sx = this.sx.update(dt, tx);
    const sy = this.sy.update(dt, ty);
    const sz = this.sz.update(dt, tz);
    const m = motion < 0 ? 0 : motion > 1 ? 1 : motion;
    this.x = this.ex + (sx - this.ex) * m;
    this.y = this.ey + (sy - this.ey) * m;
    this.z = this.ez + (sz - this.ez) * m;
  }

  /** Jumps to a point at rest (spawn, teleport, leaving a car). */
  snap(x: number, y: number, z: number): void {
    this.x = this.ex = x;
    this.y = this.ey = y;
    this.z = this.ez = z;
    this.sx.reset(x);
    this.sy.reset(y);
    this.sz.reset(z);
  }
}

/** 0..1 sprint amount for the FOV widening: nothing up to a brisk walk, full at sprint speed. */
export function sprintFovFactor(speed: number): number {
  return smooth(FOOT_TUNING.walkSpeed + 0.4, FOOT_TUNING.runSpeed, speed);
}

/** Camera height dip after landing a jump or a fall. */
export class LandingDip {
  private readonly spring = new SpringDamper(C.landFrequency, C.landDamping);

  /** A landing at `fallSpeed` m/s (downwards, positive). */
  land(fallSpeed: number): void {
    const excess = fallSpeed - C.landMinFall;
    if (excess <= 0) return;
    const maxKick = (C.landMaxDip * 2 * Math.PI * C.landFrequency) / 0.5;
    this.spring.kick(-Math.min(excess * C.landKick, maxKick));
  }

  /** Advances and returns the height offset (m, ≤ 0 while dipping). */
  update(dt: number): number {
    return Math.max(-C.landMaxDip, this.spring.update(dt, 0));
  }

  reset(): void {
    this.spring.reset();
  }
}
