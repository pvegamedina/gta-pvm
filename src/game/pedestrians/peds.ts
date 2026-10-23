// Pedestrians: wander on a per-block sidewalk ring, dodge nearby fast traffic
// and the on-foot player, flee from gunfire (run cycle), and play their death
// animation then respawn when shot.

import * as THREE from "three";
import { G, bc } from "../core/constants";
import { angLerp } from "../core/math";
import { randomPedColors } from "../player/human";
import { randomCharacter } from "../characters/characterChoice";
import type { CharacterRig, RigFactory, RigUpdate } from "../characters/characterRig";
import type { Vehicle } from "../vehicles/meshes";

export interface Ped {
  bi: number;
  bj: number;
  s: number;
  dir: number;
  speed: number;
  ox: number;
  oz: number;
  mesh: CharacterRig;
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

/** Pedestrians are local-only, so Math.random() picks their look freely. */
export function spawnPeds(scene: THREE.Scene, n: number, makeRig: RigFactory): Ped[] {
  const peds: Ped[] = [];
  for (let i = 0; i < n; i++) {
    const mesh = makeRig({ character: randomCharacter(), colors: randomPedColors(), castShadow: false });
    scene.add(mesh.group);
    peds.push({
      bi: Math.floor(Math.random() * G),
      bj: Math.floor(Math.random() * G),
      s: Math.random() * 213,
      dir: Math.random() < 0.5 ? 1 : -1,
      speed: (1.1 + Math.random() * 0.6) * (0.8 + Math.random() * 0.4),
      ox: 0,
      oz: 0,
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
}

const _anim: RigUpdate = { speed: 0, ground: true, weapon: "fists", aiming: false, alive: true, running: false };

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
      else {
        _anim.alive = false;
        p.mesh.update(dt, _anim);
      }
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
    p.yaw = angLerp(p.yaw, Math.atan2(_p2.x - _p1.x, _p2.z - _p1.z), Math.min(1, dt * 8));
    p.mesh.group.position.set(_p1.x + p.ox, 0.25, _p1.z + p.oz);
    p.mesh.group.rotation.y = p.yaw;
    _anim.alive = true;
    _anim.speed = p.speed * fleeMul;
    _anim.running = p.fleeT > 0;
    p.mesh.update(dt, _anim);
  }
}

/** Current world position of a ped (ring position + dodge offset), for callers
 * that need it outside the per-frame updatePeds loop (e.g. vehicle-ram checks). */
export function pedPosition(p: Ped): { x: number; z: number } {
  const out = { x: 0, z: 0 };
  ringPos(p.bi, p.bj, p.s, out);
  out.x += p.ox;
  out.z += p.oz;
  return out;
}

/** Ped takes a hit: plays its death (see updatePeds) and starts the respawn timer. */
export function hitPed(p: Ped): void {
  if (p.state === "down") return;
  p.state = "down";
  p.downT = 0;
}

export function spookPedsNear(peds: Ped[], x: number, z: number, radius: number): void {
  for (const p of peds) {
    if (p.state === "down") continue;
    ringPos(p.bi, p.bj, p.s, _p1);
    if (Math.hypot(_p1.x - x, _p1.z - z) < radius) p.fleeT = 2.5;
  }
}
