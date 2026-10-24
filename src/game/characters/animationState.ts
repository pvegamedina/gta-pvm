// Animation state for the character models, as a continuous blend rather than
// hard clip switches: damped speed drives Idle/Walk/Run weights (sharing one
// gait phase), damped "armed"/"aim" factors morph in the gun and aiming
// variants, and punches / recoil / death are soft-faded overlays. Pure (no
// THREE): modelRig.ts just copies weight(clip) and clipTime(clip) onto its
// AnimationActions every frame.

import type { WeaponId } from "@shared/protocol";
import { DwellFlag, RUN_FULL_SPEED, damp, gaitRate, leanFromAccel, locomotionWeights, oneShotWeight, smoothstep } from "./animationBlend";

/** Subset of the embedded clips (identical names in every character GLB) that gameplay uses. */
export type ClipName =
  | "Idle"
  | "Idle_Gun"
  | "Idle_Gun_Pointing"
  | "Idle_Gun_Shoot"
  | "Walk"
  | "Run"
  | "Run_Shoot"
  | "Death"
  | "Punch_Left"
  | "Punch_Right";

export const ANIM_CLIPS: readonly ClipName[] = [
  "Idle",
  "Idle_Gun",
  "Idle_Gun_Pointing",
  "Idle_Gun_Shoot",
  "Walk",
  "Run",
  "Run_Shoot",
  "Death",
  "Punch_Left",
  "Punch_Right",
];

/** Normalised gait-phase offset per cycle clip, measured so the left foot
 * plants at the same phase in Walk and Run (Run/Run_Shoot lag Walk by ~0.4). */
export const GAIT_PHASE_OFFSET: Partial<Record<ClipName, number>> = { Walk: 0, Run: 0.4, Run_Shoot: 0.4 };

export interface BlendInput {
  /** Raw horizontal speed (m/s); smoothed internally. */
  speed: number;
  /** Holding a gun (pistol/m4). */
  armed: boolean;
  aiming: boolean;
  alive: boolean;
  /** Pushes the blend towards the run cycle (fleeing pedestrians). */
  running?: boolean;
}

// ---- Tunables (seconds unless noted) ----
/** Speed smoothing time constant (also tames noisy remote speeds). */
const SPEED_TAU = 0.2;
/** Armed / aim pose smoothing: ~95 % of a change within ~0.3 s. */
const POSE_TAU = 0.1;
/** Minimum time a discrete input (armed, aiming) holds before flipping back. */
const FLAG_DWELL = 0.15;
const ONE_SHOT_FADE_IN = 0.12;
const ONE_SHOT_FADE_OUT = 0.15;
const DEATH_FADE_IN = 0.25;
const DEATH_FADE_OUT = 0.35;
/** Start/stop lean smoothing (on top of the already smoothed speed). */
const LEAN_TAU = 0.12;
/** Recoil overlay only while (nearly) standing still; Run_Shoot covers moving. */
const RECOIL_MAX_SPEED = 0.6;

/** How long a punch overrides locomotion (matches the fists' fire interval). */
export const PUNCH_DURATION = 0.45;
/** Punch clips are ~0.83 s long; played faster so one fits in PUNCH_DURATION. */
export const PUNCH_TIME_SCALE = 1.8;
/** How long the gun stays raised after the last shot (hip fire). */
export const SHOT_HOLD = 0.3;

interface OneShot {
  clip: ClipName;
  /** Envelope time (s) driving the fade weight. */
  elapsed: number;
  /** Envelope length (s) = clip duration / timeScale. */
  duration: number;
  /** Position inside the clip (s, clip time). */
  clipTime: number;
  timeScale: number;
}

export class CharacterAnimState {
  private readonly weights = new Map<ClipName, number>();
  private speed = 0;
  private runBoost = 0;
  private armedW = 0;
  private aimW = 0;
  private leanAngle = 0;
  private deathRamp = 0;
  private deathTime = 0;
  private wasAlive = true;
  private gaitPhase = 0;
  private idleTime = 0;
  private shotHold = 0;
  private punchSide: "left" | "right" = "left";
  private oneShot: OneShot | null = null;
  private readonly armed = new DwellFlag(false, FLAG_DWELL);
  private readonly aiming = new DwellFlag(false, FLAG_DWELL);

  constructor(private readonly durations: Partial<Record<ClipName, number>>) {
    for (const c of ANIM_CLIPS) this.weights.set(c, c === "Idle" ? 1 : 0);
  }

  private duration(clip: ClipName): number {
    return this.durations[clip] ?? 1;
  }

  private oneShotWeightNow(): number {
    const o = this.oneShot;
    return o ? oneShotWeight(o.elapsed, o.duration, ONE_SHOT_FADE_IN, ONE_SHOT_FADE_OUT) : 0;
  }

  /** Starts a one-shot, continuing the current overlay weight so nothing pops. */
  private startOneShot(clip: ClipName, timeScale: number): void {
    const carry = this.oneShotWeightNow() * ONE_SHOT_FADE_IN;
    this.oneShot = { clip, elapsed: carry, duration: this.duration(clip) / timeScale, clipTime: 0, timeScale };
  }

  /** A punch (fists, alternating hands) or a gunshot (raises the gun + recoil when standing). */
  trigger(weapon: WeaponId): void {
    if (!this.wasAlive) return;
    if (weapon === "fists") {
      this.punchSide = this.punchSide === "left" ? "right" : "left";
      this.startOneShot(this.punchSide === "left" ? "Punch_Left" : "Punch_Right", PUNCH_TIME_SCALE);
      return;
    }
    this.shotHold = SHOT_HOLD;
    if (this.speed > RECOIL_MAX_SPEED) return;
    const o = this.oneShot;
    // Let a running recoil play out (automatic fire) unless it is already fading.
    if (o && (o.clip !== "Idle_Gun_Shoot" || o.elapsed < o.duration - ONE_SHOT_FADE_OUT)) return;
    this.startOneShot("Idle_Gun_Shoot", 1);
  }

  update(dt: number, input: BlendInput): void {
    // ---- discrete inputs -> filtered / damped factors ----
    if (!input.alive && this.wasAlive) {
      this.deathTime = 0;
      this.oneShot = null;
    }
    this.wasAlive = input.alive;
    if (!input.alive) this.deathTime += dt;
    this.deathRamp = input.alive ? Math.max(0, this.deathRamp - dt / DEATH_FADE_OUT) : Math.min(1, this.deathRamp + dt / DEATH_FADE_IN);

    this.shotHold = Math.max(0, this.shotHold - dt);
    const armed = this.armed.update(input.armed, dt);
    const aiming = this.aiming.update(input.aiming, dt);
    this.armedW = damp(this.armedW, armed ? 1 : 0, POSE_TAU, dt);
    this.aimW = damp(this.aimW, armed && (aiming || this.shotHold > 0) ? 1 : 0, POSE_TAU, dt);
    // Frozen while dead: Death covers the body, and respawn eases from there.
    const prevSpeed = this.speed;
    if (input.alive) this.speed = damp(this.speed, Math.max(0, input.speed), SPEED_TAU, dt);
    // Start/stop lean from the smoothed acceleration (upright while dead).
    const accel = dt > 0 ? (this.speed - prevSpeed) / dt : 0;
    this.leanAngle = damp(this.leanAngle, input.alive ? leanFromAccel(accel) : 0, LEAN_TAU, dt);
    this.runBoost = damp(this.runBoost, input.running ? 1 : 0, POSE_TAU * 2, dt);

    // ---- clocks ----
    this.gaitPhase = (this.gaitPhase + gaitRate(this.speed) * dt) % 1;
    this.idleTime += dt;
    if (this.oneShot) {
      this.oneShot.elapsed += dt;
      this.oneShot.clipTime += dt * this.oneShot.timeScale;
      if (this.oneShot.elapsed >= this.oneShot.duration) this.oneShot = null;
    }

    // ---- weights ----
    const blendSpeed = this.speed + this.runBoost * Math.max(0, RUN_FULL_SPEED - this.speed);
    const loco = locomotionWeights(blendSpeed);
    const a = Math.min(1, this.aimW);
    const g = Math.max(this.armedW, a);
    const death = smoothstep(0, 1, this.deathRamp);
    // Overlays: Death on top of everything, then the one-shot, then locomotion.
    const oneShot = this.oneShotWeightNow();
    const shot = oneShot * (1 - death);
    const base = (1 - death) * (1 - oneShot);

    const w = this.weights;
    for (const c of ANIM_CLIPS) w.set(c, 0);
    w.set("Idle", base * loco.idle * (1 - g));
    w.set("Idle_Gun", base * loco.idle * (g - a));
    w.set("Idle_Gun_Pointing", base * loco.idle * a);
    w.set("Walk", base * loco.walk * (1 - a));
    w.set("Run", base * loco.run * (1 - a));
    w.set("Run_Shoot", base * (loco.walk + loco.run) * a);
    w.set("Death", death);
    if (this.oneShot) w.set(this.oneShot.clip, (w.get(this.oneShot.clip) ?? 0) + shot);
  }

  weight(clip: ClipName): number {
    return this.weights.get(clip) ?? 0;
  }

  /** Upper-body pitch (rad, + = forward) from accelerating/braking; rigs add it on the spine. */
  get lean(): number {
    return this.leanAngle;
  }

  /** Smoothed "holding a gun" factor (0..1), faded out by death: drives the two-handed carry. */
  get armedWeight(): number {
    return this.armedW * (1 - smoothstep(0, 1, this.deathRamp));
  }

  /** Smoothed aiming factor (0..1, includes the brief hip-fire raise), faded out by death. */
  get aimWeight(): number {
    return Math.min(1, this.aimW) * (1 - smoothstep(0, 1, this.deathRamp));
  }

  /** Time (s) within `clip` to display this frame. */
  clipTime(clip: ClipName): number {
    const d = this.duration(clip);
    const offset = GAIT_PHASE_OFFSET[clip];
    if (offset !== undefined) return ((this.gaitPhase + offset) % 1) * d;
    if (clip === "Death") return Math.min(this.deathTime, d - 1e-3);
    if (this.oneShot?.clip === clip) return Math.min(this.oneShot.clipTime, d - 1e-3);
    if (clip === "Punch_Left" || clip === "Punch_Right" || clip === "Idle_Gun_Shoot") return 0;
    return this.idleTime % d;
  }
}

/** Short-lived attack state (punch hand + recent gunshot) for the procedural fallback rig. */
export class AttackTimers {
  private punchT = 0;
  private shotT = 0;
  private side: "left" | "right" = "left";

  /** Registers an attack with `weapon`: a punch (alternating hands) or a gunshot. */
  trigger(weapon: WeaponId): void {
    if (weapon === "fists") {
      this.side = this.side === "left" ? "right" : "left";
      this.punchT = PUNCH_DURATION;
    } else {
      this.shotT = SHOT_HOLD;
    }
  }

  tick(dt: number): void {
    this.punchT = Math.max(0, this.punchT - dt);
    this.shotT = Math.max(0, this.shotT - dt);
  }

  get punch(): "left" | "right" | null {
    return this.punchT > 0 ? this.side : null;
  }

  get shooting(): boolean {
    return this.shotT > 0;
  }
}
