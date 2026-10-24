// On-foot movement: WASD relative to camera yaw, running, jumping, and
// collision resolution against static colliders and parked/AI vehicles.
// Velocity is inertial (player/footMotion.ts): walking ramps up, Shift builds
// up to a sprint over ~1 s, stops slide out briefly and turns arc. Collisions
// remove the velocity component pushing into whatever was hit, so the
// character slides along walls instead of "running in place" against them.

import { angLerp, clamp } from "../core/math";
import { LIMIT } from "../core/constants";
import { circleVsCollider, groundY, type CollisionGrid, type HitInfo } from "../world/colliders";
import type { Vehicle } from "../vehicles/meshes";
import type { PlayerState } from "./playerState";
import { stepFootVelocity, type FootMoveInput } from "./footMotion";

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

const _move: FootMoveInput = { dirX: 0, dirZ: 0, run: false, ground: true };
const _vel = { x: 0, z: 0 };

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
  _move.dirX = mx;
  _move.dirZ = mz;
  _move.run = input.run;
  _move.ground = p.ground;
  _vel.x = p.vx;
  _vel.z = p.vz;
  stepFootVelocity(_vel, _move, dt, _vel);
  p.vx = _vel.x;
  p.vz = _vel.z;
  const ex = p.x + p.vx * dt;
  const ez = p.z + p.vz * dt;
  p.x = ex;
  p.z = ez;
  resolveFoot(p, grid, vehicles);
  // Something pushed us back: drop the velocity component into it (never add any).
  const cx = p.x - ex;
  const cz = p.z - ez;
  const cl = Math.hypot(cx, cz);
  if (cl > 1e-6) {
    const nx = cx / cl;
    const nz = cz / cl;
    const vn = p.vx * nx + p.vz * nz;
    if (vn < 0) {
      p.vx -= vn * nx;
      p.vz -= vn * nz;
    }
  }
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
  // Limb animation is the rig's job (CharacterRig.update, driven from game.ts).
  p.mesh.group.position.set(p.x, p.y, p.z);
  p.mesh.group.rotation.y = p.yaw;
}

export function footSpeed(p: PlayerState): number {
  return Math.hypot(p.vx, p.vz);
}
