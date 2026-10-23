// Player-driven car physics: throttle/brake/steer, collision response against
// static colliders and other vehicles, and the suspension-ish pitch/roll feel.

import { clamp } from "../core/math";
import { LIMIT } from "../core/constants";
import { circleVsCollider, groundY, type CollisionGrid, type HitInfo } from "../world/colliders";
import type { Vehicle } from "./meshes";

export interface CarInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  handbrake: boolean;
}

const H: HitInfo = { nx: 0, nz: 0, pen: 0 };

export function collideCar(v: Vehicle, grid: CollisionGrid, vehicles: Vehicle[]): number {
  let impact = 0;
  for (let it = 0; it < 2; it++) {
    for (const o of v.spec.offs) {
      grid.each(v.x, v.z, 6, (c) => {
        const cx = v.x + Math.sin(v.yaw) * o;
        const cz = v.z + Math.cos(v.yaw) * o;
        if (circleVsCollider(c, cx, cz, v.spec.rad, H)) {
          v.x += H.nx * H.pen;
          v.z += H.nz * H.pen;
          const vn = v.vx * H.nx + v.vz * H.nz;
          if (vn < 0) {
            impact = Math.max(impact, -vn);
            v.vx -= 1.15 * vn * H.nx;
            v.vz -= 1.15 * vn * H.nz;
            v.vx *= 0.985;
            v.vz *= 0.985;
          }
        }
      });
    }
    for (const u of vehicles) {
      if (u === v || Math.abs(u.x - v.x) > 7 || Math.abs(u.z - v.z) > 7) continue;
      for (const o of v.spec.offs) {
        for (const q of u.spec.offs) {
          const ax = v.x + Math.sin(v.yaw) * o;
          const az = v.z + Math.cos(v.yaw) * o;
          const bx = u.x + Math.sin(u.yaw) * q;
          const bz = u.z + Math.cos(u.yaw) * q;
          const dx = ax - bx;
          const dz = az - bz;
          const rs = v.spec.rad + u.spec.rad;
          const d2 = dx * dx + dz * dz;
          if (d2 < rs * rs) {
            const d = Math.sqrt(d2) || 0.001;
            const nx = dx / d;
            const nz = dz / d;
            const pen = rs - d;
            const sh = u.mode === "ai" ? 0.7 : 1;
            v.x += nx * pen * sh;
            v.z += nz * pen * sh;
            if (u.mode === "ai") {
              u.x -= nx * pen * 0.3;
              u.z -= nz * pen * 0.3;
            }
            const vn = v.vx * nx + v.vz * nz;
            if (vn < 0) {
              impact = Math.max(impact, -vn);
              v.vx -= 1.1 * vn * nx;
              v.vz -= 1.1 * vn * nz;
            }
          }
        }
      }
    }
  }
  if (Math.abs(v.x) > LIMIT) {
    v.x = Math.sign(v.x) * LIMIT;
    v.vx = 0;
    impact = Math.max(impact, 3);
  }
  if (Math.abs(v.z) > LIMIT) {
    v.z = Math.sign(v.z) * LIMIT;
    v.vz = 0;
    impact = Math.max(impact, 3);
  }
  return impact;
}

/** Returns the impact magnitude for this tick (0 when no crash), for health/camera-shake hooks. */
export function updatePlayerCar(v: Vehicle, dt: number, input: CarInput, grid: CollisionGrid, vehicles: Vehicle[]): number {
  const sp = v.spec;
  const { up, down, left, right, handbrake: hb } = input;
  let fx = Math.sin(v.yaw);
  let fz = Math.cos(v.yaw);
  let sx = Math.cos(v.yaw);
  let sz = -Math.sin(v.yaw);
  let vF = v.vx * fx + v.vz * fz;
  let vS = v.vx * sx + v.vz * sz;
  v.braking = false;
  if (up) {
    if (vF >= -0.3) vF += sp.acc * (1 - Math.max(vF, 0) / sp.max) * dt;
    else {
      vF += 24 * dt;
      v.braking = true;
    }
  }
  if (down) {
    if (vF > 0.5) {
      vF -= 26 * dt;
      v.braking = true;
    } else if (vF > -9) vF -= 7 * dt;
  }
  if (hb) {
    const m = Math.min(Math.abs(vF), 16 * dt);
    vF -= Math.sign(vF) * m;
    v.braking = true;
  }
  if (!up && !down) {
    const m = Math.min(Math.abs(vF), (2.0 + 0.004 * vF * vF) * dt);
    vF -= Math.sign(vF) * m;
  }
  const sf = clamp(Math.abs(vF) / sp.max, 0, 1);
  const maxSteer = (0.62 - (0.62 - 0.16) * Math.pow(sf, 0.7));
  const target = ((left ? 1 : 0) - (right ? 1 : 0)) * maxSteer;
  const rate = target === 0 ? 5 : 3.2;
  v.steer += clamp(target - v.steer, -rate * dt, rate * dt);
  let yawRate = (vF / sp.wb) * Math.tan(v.steer);
  if (hb) yawRate *= 1.6;
  v.yaw += yawRate * dt;
  vS *= Math.exp(-(hb ? 1.4 : 8) * dt);
  fx = Math.sin(v.yaw);
  fz = Math.cos(v.yaw);
  sx = Math.cos(v.yaw);
  sz = -Math.sin(v.yaw);
  v.vx = fx * vF + sx * vS;
  v.vz = fz * vF + sz * vS;
  v.x += v.vx * dt;
  v.z += v.vz * dt;
  const impact = collideCar(v, grid, vehicles);
  vF = v.vx * fx + v.vz * fz;
  v.speed = vF;
  v.y += (groundY(v.x, v.z) - v.y) * Math.min(1, dt * 14);
  const acc = (vF - v.prevF) / dt;
  v.prevF = vF;
  v.pitch += (clamp(-acc * 0.004, -0.05, 0.05) - v.pitch) * Math.min(1, dt * 6);
  v.roll += (clamp(vF * yawRate * 0.004, -0.07, 0.07) - v.roll) * Math.min(1, dt * 6);
  v.steerVis = v.steer;
  return impact;
}
