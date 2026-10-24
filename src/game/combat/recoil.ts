// Pure "gun feel" math: critically-damped recoil springs (held gun kick and
// camera kick/climb/FOV punch), the crosshair gap that mirrors the real shot
// cone, and the tracer cadence. Visual only — damage, fire rate and spread
// (combat/weapons.ts, shared WEAPONS) are untouched. No THREE/DOM.

import type { WeaponId } from "@shared/protocol";

/**
 * Critically damped spring towards 0, integrated analytically so it is
 * framerate independent. kick(a) makes it peak at ≈ a after 1/ω seconds and
 * settle back without overshoot (~5/ω to rest).
 */
export class RecoilSpring {
  value = 0;
  private velocity = 0;

  constructor(private readonly omega: number) {}

  /** Adds a kick whose peak displacement is ≈ `amount` (when starting from rest). */
  kick(amount: number): void {
    this.velocity += amount * this.omega * Math.E;
  }

  update(dt: number): void {
    const w = this.omega;
    const x0 = this.value;
    const v0 = this.velocity;
    const e = Math.exp(-w * dt);
    const c = v0 + w * x0;
    this.value = (x0 + c * dt) * e;
    this.velocity = (v0 - w * c * dt) * e;
  }

  reset(): void {
    this.value = 0;
    this.velocity = 0;
  }
}

export interface WeaponFeel {
  /** Held-gun kick strength (1 = full pistol snap; see characters/modelRig.ts). */
  gunKick: number;
  /** Camera pitch kick per shot (rad, view goes up). */
  camPitch: number;
  /** Max random camera yaw kick per shot (rad, either side). */
  camYaw: number;
  /** FOV punch per shot (degrees, widens briefly). */
  fovPunch: number;
  /** Sustained-fire climb added per shot (rad), recovered once fire stops. */
  climb: number;
  /** Camera-shake (positional jitter) added per shot. */
  shake: number;
}

/** Per-weapon tunables: pistol = one strong snap, M4 = small rapid kicks that climb. */
export const WEAPON_FEEL: Record<WeaponId, WeaponFeel> = {
  fists: { gunKick: 0, camPitch: 0, camYaw: 0, fovPunch: 0, climb: 0, shake: 0 },
  pistol: { gunKick: 1, camPitch: 0.032, camYaw: 0.009, fovPunch: 2.2, climb: 0, shake: 0.05 },
  m4: { gunKick: 0.5, camPitch: 0.011, camYaw: 0.006, fovPunch: 0.9, climb: 0.0042, shake: 0.03 },
};

/** Spring rates (rad/s): camera recovers a bit slower than the held gun. */
export const GUN_KICK_OMEGA = 34;
const CAM_OMEGA = 22;
const FOV_OMEGA = 26;
const MAX_CLIMB = 0.07;
/** Climb starts recovering this long after the last shot, at CLIMB_RECOVER rad/s. */
const CLIMB_DELAY = 0.12;
const CLIMB_RECOVER = 0.09;

/** Camera recoil state: pitch kick + sustained climb, random yaw, FOV punch. */
export class CameraRecoil {
  private readonly pitchSpring = new RecoilSpring(CAM_OMEGA);
  private readonly yawSpring = new RecoilSpring(CAM_OMEGA);
  private readonly fovSpring = new RecoilSpring(FOV_OMEGA);
  private climb = 0;
  private sinceShot = Infinity;

  fire(weapon: WeaponId, random: () => number = Math.random): void {
    const f = WEAPON_FEEL[weapon];
    this.pitchSpring.kick(f.camPitch);
    this.yawSpring.kick((random() * 2 - 1) * f.camYaw);
    this.fovSpring.kick(f.fovPunch);
    this.climb = Math.min(MAX_CLIMB, this.climb + f.climb);
    this.sinceShot = 0;
  }

  update(dt: number): void {
    this.pitchSpring.update(dt);
    this.yawSpring.update(dt);
    this.fovSpring.update(dt);
    this.sinceShot += dt;
    if (this.sinceShot > CLIMB_DELAY) this.climb = Math.max(0, this.climb - CLIMB_RECOVER * dt);
  }

  /** View pitch offset (rad, + = up). */
  get pitch(): number {
    return this.pitchSpring.value + this.climb;
  }

  /** View yaw offset (rad). */
  get yaw(): number {
    return this.yawSpring.value;
  }

  /** FOV offset (degrees). */
  get fov(): number {
    return this.fovSpring.value;
  }

  reset(): void {
    this.pitchSpring.reset();
    this.yawSpring.reset();
    this.fovSpring.reset();
    this.climb = 0;
  }
}

/**
 * Crosshair arm offset (px) that matches the shot cone: game.ts perturbs the
 * aim direction by up to ±spread/2 per axis, i.e. an angular radius of
 * ~spread/2, projected with the camera's vertical FOV onto `viewportH` pixels.
 */
export function spreadToCrosshairGap(spread: number, fovDeg: number, viewportH: number, minGap = 4): number {
  const half = Math.tan((fovDeg * Math.PI) / 360);
  const px = (Math.tan(Math.max(0, spread) / 2) / half) * (viewportH / 2);
  return Math.max(minGap, px);
}

/** Every Nth round is drawn as a visible tracer (real tracer belts aren't 1:1). */
export const TRACER_EVERY: Record<WeaponId, number> = { fists: 1, pistol: 1, m4: 2 };

/** Whether the `shotIndex`-th consecutive round (0-based) of `weapon` shows a tracer. */
export function shouldTrace(shotIndex: number, weapon: WeaponId): boolean {
  return shotIndex % TRACER_EVERY[weapon] === 0;
}
