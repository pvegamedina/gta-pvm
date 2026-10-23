// Pedestrians: wander on a per-block sidewalk ring, dodge nearby fast traffic
// and the on-foot player, flee from gunfire, and fall/respawn when shot.

import * as THREE from "three";
import { G, bc } from "../core/constants";
import { angLerp } from "../core/math";
import { makeHuman, randomPedColors, type HumanRig } from "../player/human";
import type { Vehicle } from "../vehicles/meshes";

export interface Ped {
  bi: number;
  bj: number;
  s: number;
  dir: number;
  speed: number;
  ox: number;
  oz: number;
  phase: number;
  mesh: HumanRig;
  yaw: number;
  state: "walk" | "down";
  downT: number;
  fleeT: number;
}

const RING_HS = 26.7;
const RING_LEN = RING_HS * 2;
const RING_PER = RING_LEN * 4;
const DOWN_RESPAWN_S = 5;

function ringPos(bi: number, bj: number, s: number, out: { x: number; z: number }): void {
  s = ((s % RING_PER) + RING_PER) % RING_PER;
  const side = Math.floor(s / RING_LEN);
  const t = s - side * RING_LEN;
  const cx = bc(bi);
  const cz = bc(bj);
  if (side === 0) {
    out.x = cx - RING_HS + t;
    out.z = cz - RING_HS;
  } else if (side === 1) {
    out.x = cx + RING_HS;
    out.z = cz - RING_HS + t;
  } else if (side === 2) {
    out.x = cx + RING_HS - t;
    out.z = cz + RING_HS;
  } else {
    out.x = cx - RING_HS;
    out.z = cz + RING_HS - t;
  }
}

export function spawnPeds(scene: THREE.Scene, n: number): Ped[] {
  const peds: Ped[] = [];
  for (let i = 0; i < n; i++) {
    const mesh = makeHuman(randomPedColors());
    scene.add(mesh.group);
    peds.push({
      bi: Math.floor(Math.random() * G),
      bj: Math.floor(Math.random() * G),
      s: Math.random() * 213,
      dir: Math.random() < 0.5 ? 1 : -1,
      speed: (1.1 + Math.random() * 0.6) * (0.8 + Math.random() * 0.4),
      ox: 0,
      oz: 0,
      phase: Math.random() * 6,
      mesh,
      yaw: 0,
      state: "walk",
      downT: 0,
      fleeT: 0,
    });
  }
  return peds;
}

function respawnPed(scene: THREE.Scene, p: Ped): void {
  p.bi = Math.floor(Math.random() * G);
  p.bj = Math.floor(Math.random() * G);
  p.s = Math.random() * 213;
  p.state = "walk";
  p.downT = 0;
  p.ox = p.oz = 0;
  p.mesh.group.visible = true;
  p.mesh.group.rotation.set(0, 0, 0);
}

const _p1 = { x: 0, z: 0 };
const _p2 = { x: 0, z: 0 };

export function updatePeds(
  scene: THREE.Scene,
  peds: Ped[],
  dt: number,
  vehicles: Vehicle[],
  playerFoot: { mode: "foot" | "car"; x: number; z: number },
  camX: number,
  camZ: number,
): void {
  for (const p of peds) {
    if (p.state === "down") {
      p.downT += dt;
      if (p.downT > DOWN_RESPAWN_S * 0.4) p.mesh.group.visible = false;
      if (p.downT > DOWN_RESPAWN_S) respawnPed(scene, p);
      continue;
    }
    if (p.fleeT > 0) p.fleeT -= dt;
    const fleeMul = p.fleeT > 0 ? 2.1 : 1;
    p.s += p.dir * p.speed * fleeMul * dt;
    ringPos(p.bi, p.bj, p.s, _p1);
    ringPos(p.bi, p.bj, p.s + p.dir * 0.5, _p2);
    const dcam = Math.hypot(_p1.x - camX, _p1.z - camZ);
    if (dcam > 170) {
      p.mesh.group.visible = false;
      continue;
    }
    p.mesh.group.visible = true;
    for (const v of vehicles) {
      if (Math.abs(v.speed) < 2.5) continue;
      const dx = _p1.x + p.ox - v.x;
      const dz = _p1.z + p.oz - v.z;
      const d = Math.hypot(dx, dz);
      if (d < 3.5 && d > 0.01) {
        p.ox += (dx / d) * dt * 6;
        p.oz += (dz / d) * dt * 6;
      }
    }
    if (playerFoot.mode === "foot") {
      const dx = _p1.x + p.ox - playerFoot.x;
      const dz = _p1.z + p.oz - playerFoot.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.9 && d > 0.01) {
        p.ox += (dx / d) * dt * 3;
        p.oz += (dz / d) * dt * 3;
      }
    }
    p.ox *= Math.exp(-dt * 0.8);
    p.oz *= Math.exp(-dt * 0.8);
    p.phase += p.speed * dt * 4.5;
    p.yaw = angLerp(p.yaw, Math.atan2(_p2.x - _p1.x, _p2.z - _p1.z), Math.min(1, dt * 8));
    p.mesh.group.position.set(_p1.x + p.ox, 0.25, _p1.z + p.oz);
    p.mesh.group.rotation.y = p.yaw;
    const s = Math.sin(p.phase) * 0.55;
    p.mesh.lLeg.rotation.x = s;
    p.mesh.rLeg.rotation.x = -s;
    p.mesh.lArm.rotation.x = -s * 0.9;
    p.mesh.rArm.rotation.x = s * 0.9;
  }
}

/** Ped takes a hit: falls over, starts the respawn timer, and nearby peds flee. */
export function hitPed(p: Ped): void {
  if (p.state === "down") return;
  p.state = "down";
  p.downT = 0;
  p.mesh.group.rotation.x = Math.PI / 2;
}

export function spookPedsNear(peds: Ped[], x: number, z: number, radius: number): void {
  for (const p of peds) {
    if (p.state === "down") continue;
    ringPos(p.bi, p.bj, p.s, _p1);
    if (Math.hypot(_p1.x - x, _p1.z - z) < radius) p.fleeT = 2.5;
  }
}
