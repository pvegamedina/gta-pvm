// Third-person chase camera with wall avoidance, speed-based FOV/shake, and an
// over-the-shoulder aim mode (closer, offset right, slightly lower FOV).

import * as THREE from "three";
import { angLerp, clamp } from "../core/math";
import type { CollisionGrid } from "../world/colliders";
import type { Vehicle } from "../vehicles/meshes";
import type { PlayerState } from "../player/playerState";

export interface CameraState {
  yaw: number;
  pitch: number;
  fx: number;
  fy: number;
  fz: number;
  lastMouse: number;
  shake: number;
  roll: number;
  clear: number;
  fov: number;
  zoom: number;
}

export function createCameraState(yaw: number): CameraState {
  return { yaw, pitch: 0.3, fx: 0, fy: 1.8, fz: 0, lastMouse: -9, shake: 0, roll: 0, clear: 1, fov: 65, zoom: 1 };
}

function camBlocked(grid: CollisionGrid, px: number, py: number, pz: number): boolean {
  if (py < 0.35) return true;
  let hit = false;
  grid.each(px, pz, 1, (c) => {
    if (c.t === 0 && py < c.h && Math.abs(px - c.x) < c.hx + 0.5 && Math.abs(pz - c.z) < c.hz + 0.5) hit = true;
  });
  return hit;
}

export function snapCamera(cam: CameraState, player: PlayerState): void {
  const tx = player.mode === "car" ? player.car!.x : player.x;
  const tz = player.mode === "car" ? player.car!.z : player.z;
  cam.fx = tx;
  cam.fz = tz;
  cam.fy = 1.8;
  cam.clear = 1;
}

export function updateCamera(
  cam: CameraState,
  camera: THREE.PerspectiveCamera,
  player: PlayerState,
  dt: number,
  tClock: number,
  grid: CollisionGrid,
): void {
  let tx: number, ty: number, tz: number, dist: number, pitch: number;
  let v: Vehicle | null = null;
  const aiming = player.aiming && player.mode === "foot";
  if (player.mode === "car") {
    v = player.car!;
    tx = v.x;
    ty = v.y + 1.4;
    tz = v.z;
    const spd = Math.hypot(v.vx, v.vz);
    dist = (8.2 + Math.min(3, spd * 0.07)) * cam.zoom;
    pitch = cam.pitch;
    if (tClock - cam.lastMouse > 1.3 && spd > 1.5) cam.yaw = angLerp(cam.yaw, v.yaw, 1 - Math.exp(-dt * 3));
  } else {
    tx = player.x;
    ty = player.y + 1.6;
    tz = player.z;
    dist = (aiming ? 2.6 : 5.6) * cam.zoom;
    pitch = cam.pitch;
  }
  const kf = 1 - Math.exp(-dt * (v ? 12 : 16));
  cam.fx += (tx - cam.fx) * kf;
  cam.fy += (ty - cam.fy) * kf;
  cam.fz += (tz - cam.fz) * kf;
  const fx = Math.sin(cam.yaw);
  const fz = Math.cos(cam.yaw);
  const hz = dist * Math.cos(pitch);
  const up = dist * Math.sin(pitch);
  const dx = -fx * hz;
  const dy = up;
  const dz = -fz * hz;
  // Aim offset to the right of the player (over-the-shoulder), perpendicular to view dir.
  const rightX = Math.cos(cam.yaw);
  const rightZ = -Math.sin(cam.yaw);
  const aimOffset = aiming ? 0.65 : 0;

  let tc = 1;
  for (let s = 1; s <= 10; s++) {
    const t = s / 10;
    if (camBlocked(grid, cam.fx + dx * t + rightX * aimOffset * t, cam.fy + dy * t, cam.fz + dz * t + rightZ * aimOffset * t)) {
      tc = Math.max(0.12, (s - 1) / 10 - 0.05);
      break;
    }
  }
  cam.clear += (tc - cam.clear) * (tc < cam.clear ? 0.5 : 0.08);
  let cx = cam.fx + dx * cam.clear + rightX * aimOffset * cam.clear;
  let cy = Math.max(0.6, cam.fy + dy * cam.clear);
  let cz = cam.fz + dz * cam.clear + rightZ * aimOffset * cam.clear;
  if (cam.shake > 0) {
    cx += (Math.random() - 0.5) * cam.shake;
    cy += (Math.random() - 0.5) * cam.shake;
    cz += (Math.random() - 0.5) * cam.shake;
    cam.shake = Math.max(0, cam.shake - dt * 2.5);
  }
  camera.position.set(cx, cy, cz);
  const lookYaw = aiming ? player.yaw : cam.yaw;
  const lfx = Math.sin(lookYaw);
  const lfz = Math.cos(lookYaw);
  camera.lookAt(cam.fx + lfx * 2 + rightX * aimOffset, cam.fy + 0.2, cam.fz + lfz * 2 + rightZ * aimOffset);
  const rollT = v ? -v.steer * clamp(Math.abs(v.speed) / v.spec.max, 0, 1) * 0.12 : 0;
  cam.roll += (rollT - cam.roll) * Math.min(1, dt * 4);
  camera.rotateZ(cam.roll);
  const fovT = (aiming ? 52 : 65) + (v ? Math.min(16, Math.abs(v.speed) * 0.4) : 0);
  cam.fov += (fovT - cam.fov) * Math.min(1, dt * 3);
  if (Math.abs(camera.fov - cam.fov) > 0.05) {
    camera.fov = cam.fov;
    camera.updateProjectionMatrix();
  }
}
