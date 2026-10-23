// On-foot movement: WASD relative to camera yaw, running, jumping, and
// collision resolution against static colliders and parked/AI vehicles.

import { angLerp, clamp } from "../core/math";
import { LIMIT } from "../core/constants";
import { circleVsCollider, groundY, type CollisionGrid, type HitInfo } from "../world/colliders";
import type { Vehicle } from "../vehicles/meshes";
import type { PlayerState } from "./playerState";

export interface FootInput {
  forward: number;
  strafe: number;
  run: boolean;
  jump: boolean;
}

const H: HitInfo = { nx: 0, nz: 0, pen: 0 };
const FOOT_R = 0.45;

export function resolveFoot(p: { x: number; z: number }, grid: CollisionGrid, vehicles: Vehicle[]): void {
  const r = FOOT_R;
  for (let it = 0; it < 3; it++) {
    let moved = false;
    grid.each(p.x, p.z, r + 0.1, (c) => {
      if (circleVsCollider(c, p.x, p.z, r, H)) {
        p.x += H.nx * H.pen;
        p.z += H.nz * H.pen;
        moved = true;
      }
    });
    for (const v of vehicles) {
      if (v.mode === "player") continue;
      if (Math.abs(v.x - p.x) > 4 || Math.abs(v.z - p.z) > 4) continue;
      for (const o of v.spec.offs) {
        const cx = v.x + Math.sin(v.yaw) * o;
        const cz = v.z + Math.cos(v.yaw) * o;
        const dx = p.x - cx;
        const dz = p.z - cz;
        const rs = r + v.spec.rad;
        const d2 = dx * dx + dz * dz;
        if (d2 < rs * rs) {
          const d = Math.sqrt(d2) || 0.001;
          p.x += (dx / d) * (rs - d);
          p.z += (dz / d) * (rs - d);
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  p.x = clamp(p.x, -LIMIT, LIMIT);
  p.z = clamp(p.z, -LIMIT, LIMIT);
}

export function updateFoot(p: PlayerState, dt: number, input: FootInput, camYaw: number, grid: CollisionGrid, vehicles: Vehicle[]): void {
  let mx = 0;
  let mz = 0;
  if (input.forward || input.strafe) {
    mx = Math.sin(camYaw) * input.forward + Math.cos(camYaw) * input.strafe;
    mz = Math.cos(camYaw) * input.forward - Math.sin(camYaw) * input.strafe;
    const l = Math.hypot(mx, mz);
    mx /= l;
    mz /= l;
  }
  const sp = input.run ? 7.2 : 3.4;
  const a = Math.min(1, dt * 10);
  p.vx += (mx * sp - p.vx) * a;
  p.vz += (mz * sp - p.vz) * a;
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  resolveFoot(p, grid, vehicles);
  const gy = groundY(p.x, p.z);
  if (input.jump && p.ground) {
    p.vy = 6;
    p.ground = false;
  }
  if (!p.ground) {
    p.vy -= 20 * dt;
    p.y += p.vy * dt;
    if (p.y <= gy && p.vy < 0) {
      p.y = gy;
      p.vy = 0;
      p.ground = true;
    }
  } else {
    p.y += (gy - p.y) * Math.min(1, dt * 25);
  }
  const spd = Math.hypot(p.vx, p.vz);
  if (spd > 0.3) p.yaw = angLerp(p.yaw, Math.atan2(p.vx, p.vz), Math.min(1, dt * 12));
  p.phase += spd * dt * 4.5;
  const u = p.mesh;
  const amp = Math.min(1, spd / 3.4) * (input.run ? 0.95 : 0.6);
  const s = Math.sin(p.phase) * amp;
  if (p.ground) {
    u.lLeg.rotation.x = s;
    u.rLeg.rotation.x = -s;
    if (!p.aiming) {
      u.lArm.rotation.x = -s * 0.9;
      u.rArm.rotation.x = s * 0.9;
    }
  } else {
    u.lLeg.rotation.x = 0.5;
    u.rLeg.rotation.x = -0.3;
    if (!p.aiming) {
      u.lArm.rotation.x = -2.4;
      u.rArm.rotation.x = -2.4;
    }
  }
  u.torso.rotation.x = input.run && spd > 3 ? 0.15 : 0;
  p.mesh.group.position.set(p.x, p.y + (p.ground ? Math.abs(Math.sin(p.phase)) * 0.04 * amp : 0), p.z);
  p.mesh.group.rotation.y = p.yaw;
}

export function footSpeed(p: PlayerState): number {
  return Math.hypot(p.vx, p.vz);
}
