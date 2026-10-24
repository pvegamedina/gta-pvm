// Entering/exiting vehicles: nearest-vehicle probe, free-spot check for the
// exit point, and the enter/exit state transitions.

import { groundY, circleVsCollider, type CollisionGrid, type HitInfo } from "../world/colliders";
import { resolveFoot } from "./foot";
import type { Vehicle } from "../vehicles/meshes";
import type { PlayerState } from "./playerState";

export function nearestVehicle(p: { x: number; z: number }, vehicles: Vehicle[]): Vehicle | null {
  let best: Vehicle | null = null;
  let bd = 1e9;
  for (const v of vehicles) {
    if (v.mode === "player") continue;
    const dx = p.x - v.x;
    const dz = p.z - v.z;
    if (Math.abs(dx) > 8 || Math.abs(dz) > 8) continue;
    const lx = dx * Math.cos(v.yaw) - dz * Math.sin(v.yaw);
    const lz = dx * Math.sin(v.yaw) + dz * Math.cos(v.yaw) - v.spec.zc;
    const ex = Math.max(Math.abs(lx) - v.spec.W / 2, 0);
    const ez = Math.max(Math.abs(lz) - v.spec.L / 2, 0);
    const d = Math.hypot(ex, ez);
    if (d < bd) {
      bd = d;
      best = v;
    }
  }
  return bd < 2.2 ? best : null;
}

const H: HitInfo = { nx: 0, nz: 0, pen: 0 };

export function isFree(x: number, z: number, r: number, grid: CollisionGrid, vehicles: Vehicle[]): boolean {
  let free = true;
  grid.each(x, z, r + 0.1, (c) => {
    if (circleVsCollider(c, x, z, r, H)) free = false;
  });
  if (!free) return false;
  for (const v of vehicles) {
    if (Math.abs(v.x - x) > 6 || Math.abs(v.z - z) > 6) continue;
    for (const o of v.spec.offs) {
      const dx = x - (v.x + Math.sin(v.yaw) * o);
      const dz = z - (v.z + Math.cos(v.yaw) * o);
      const rs = r + v.spec.rad;
      if (dx * dx + dz * dz < rs * rs) return false;
    }
  }
  return true;
}

export function enterCar(player: PlayerState, v: Vehicle): void {
  v.mode = "player";
  v.ai = null;
  v.braking = false;
  v.steer = 0;
  v.prevF = v.speed;
  player.mode = "car";
  player.car = v;
  player.mesh.group.visible = false;
  player.vx = player.vz = 0;
}

/** Returns false (and a reason) when the car is going too fast to exit. */
export function exitCar(player: PlayerState, grid: CollisionGrid, vehicles: Vehicle[]): boolean {
  const v = player.car;
  if (!v) return true;
  if (Math.abs(v.speed) > 6) return false;
  const fx = Math.sin(v.yaw);
  const fz = Math.cos(v.yaw);
  const sx = Math.cos(v.yaw);
  const sz = -Math.sin(v.yaw);
  // Driver's door first (catalogue side/position), then the other side, then front/back.
  const W = (v.spec.W / 2 + 0.9) * v.spec.door.side;
  const L = v.spec.L / 2 + 1.0;
  const dz = v.spec.door.z;
  const cands: [number, number][] = [
    [W, dz],
    [-W, dz],
    [W, dz - 1.7],
    [-W, dz - 1.7],
    [0, v.spec.zc + L],
    [0, v.spec.zc - L],
  ];
  let px = v.x + sx * W + fx * dz;
  let pz = v.z + sz * W + fz * dz;
  for (const c of cands) {
    const x = v.x + sx * c[0] + fx * c[1];
    const z = v.z + sz * c[0] + fz * c[1];
    if (isFree(x, z, 0.5, grid, vehicles)) {
      px = x;
      pz = z;
      break;
    }
  }
  v.mode = "parked";
  v.vx = v.vz = 0;
  v.speed = 0;
  v.braking = false;
  v.steer = 0;
  v.steerVis = 0;
  player.mode = "foot";
  player.car = null;
  player.x = px;
  player.z = pz;
  player.y = groundY(px, pz);
  player.yaw = v.yaw;
  player.vx = player.vz = 0;
  player.vy = 0;
  player.ground = true;
  player.mesh.group.visible = true;
  resolveFoot(player, grid, vehicles);
  player.mesh.group.position.set(player.x, player.y, player.z);
  return true;
}

/** Ejects the player immediately (no speed check) — used on death. */
export function forceExitCar(player: PlayerState, grid: CollisionGrid, vehicles: Vehicle[]): void {
  const v = player.car;
  if (!v) return;
  v.speed = 0;
  v.mode = "parked";
  player.mode = "foot";
  player.car = null;
  const side = (v.spec.W / 2 + 1) * v.spec.door.side;
  player.x = v.x + Math.cos(v.yaw) * side;
  player.z = v.z + -Math.sin(v.yaw) * side;
  player.y = groundY(player.x, player.z);
  player.mesh.group.visible = true;
  resolveFoot(player, grid, vehicles);
}
