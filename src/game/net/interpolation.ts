// Snapshot interpolation buffer: holds a short history of PlayerMotion samples
// and produces a smoothed position/yaw ~100ms behind the latest sample, so
// remote players move fluidly despite TICK_RATE_HZ-spaced network updates.
// Pure logic — no THREE/DOM deps — so it is unit-testable.

import type { PlayerMotion } from "@shared/protocol";
import { angLerp, lerp } from "../core/math";

export const INTERP_DELAY_MS = 120;
const MAX_BUFFER_MS = 1000;
/** Once the render clock runs past the newest sample (buffer ran dry — a late
 * or dropped network tick), keep extrapolating from the last known velocity
 * for up to this long before giving up and holding the last known pose.
 * Smooths over ordinary jitter without ever producing an unbounded drift if
 * updates genuinely stop (e.g. the remote player disconnected). */
const MAX_EXTRAPOLATION_MS = 250;

export interface Snapshot {
  t: number; // ms, local receive clock
  motion: PlayerMotion;
}

export class InterpolationBuffer {
  private buf: Snapshot[] = [];

  push(motion: PlayerMotion, nowMs: number): void {
    this.buf.push({ t: nowMs, motion });
    const cutoff = nowMs - MAX_BUFFER_MS;
    while (this.buf.length > 2 && this.buf[0].t < cutoff) this.buf.shift();
  }

  size(): number {
    return this.buf.length;
  }

  /** Returns the interpolated motion at `nowMs - INTERP_DELAY_MS`, or null if no data yet. */
  sample(nowMs: number): PlayerMotion | null {
    if (this.buf.length === 0) return null;
    const renderT = nowMs - INTERP_DELAY_MS;
    if (this.buf.length === 1) return this.buf[0].motion;
    if (renderT <= this.buf[0].t) return this.buf[0].motion;
    const last = this.buf[this.buf.length - 1];
    if (renderT >= last.t) {
      const prev = this.buf[this.buf.length - 2];
      return extrapolateMotion(prev.motion, last.motion, last.t - prev.t, renderT - last.t);
    }
    for (let i = 0; i < this.buf.length - 1; i++) {
      const a = this.buf[i];
      const b = this.buf[i + 1];
      if (renderT >= a.t && renderT <= b.t) {
        const span = b.t - a.t;
        const t = span <= 0 ? 1 : (renderT - a.t) / span;
        return lerpMotion(a.motion, b.motion, t);
      }
    }
    return last.motion;
  }
}

/** Continues the velocity implied by the last two samples for `aheadMs`
 * beyond the newest one (capped at MAX_EXTRAPOLATION_MS), instead of visibly
 * freezing the instant the buffer runs dry. Discrete fields (weapon/aiming/
 * ground/car) just hold the newest known value — only position/yaw, which
 * read as motion, are extrapolated. */
function extrapolateMotion(prev: PlayerMotion, last: PlayerMotion, spanMs: number, aheadMs: number): PlayerMotion {
  const capped = Math.min(aheadMs, MAX_EXTRAPOLATION_MS);
  if (spanMs <= 0 || capped <= 0) return last;
  const t = 1 + capped / spanMs;
  return {
    p: [lerp(prev.p[0], last.p[0], t), lerp(prev.p[1], last.p[1], t), lerp(prev.p[2], last.p[2], t)],
    yaw: angLerp(prev.yaw, last.yaw, t),
    speed: last.speed,
    ground: last.ground,
    weapon: last.weapon,
    aiming: last.aiming,
    ...(last.aimPitch !== undefined ? { aimPitch: last.aimPitch } : {}),
    car:
      last.car && prev.car
        ? { type: last.car.type, color: last.car.color, yaw: angLerp(prev.car.yaw, last.car.yaw, t), speed: last.car.speed, steer: last.car.steer }
        : last.car,
  };
}

/** Optional aim pitch: lerped when both samples carry it, else the nearer one's (absent for old clients). */
function lerpAimPitch(a: number | undefined, b: number | undefined, t: number): { aimPitch?: number } {
  if (a !== undefined && b !== undefined) return { aimPitch: a + (b - a) * t };
  const v = t < 0.5 ? a : b;
  return v !== undefined ? { aimPitch: v } : {};
}

function lerpMotion(a: PlayerMotion, b: PlayerMotion, t: number): PlayerMotion {
  return {
    p: [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t, a.p[2] + (b.p[2] - a.p[2]) * t],
    yaw: angLerp(a.yaw, b.yaw, t),
    speed: a.speed + (b.speed - a.speed) * t,
    ground: t < 0.5 ? a.ground : b.ground,
    weapon: t < 0.5 ? a.weapon : b.weapon,
    aiming: t < 0.5 ? a.aiming : b.aiming,
    ...lerpAimPitch(a.aimPitch, b.aimPitch, t),
    car:
      a.car && b.car
        ? { type: t < 0.5 ? a.car.type : b.car.type, color: a.car.color, yaw: angLerp(a.car.yaw, b.car.yaw, t), speed: a.car.speed + (b.car.speed - a.car.speed) * t, steer: a.car.steer + (b.car.steer - a.car.steer) * t }
        : t < 0.5
          ? a.car
          : b.car,
  };
}
