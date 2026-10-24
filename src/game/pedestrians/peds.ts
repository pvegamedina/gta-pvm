// Pedestrians: walk the campus footway graph (footways, pedestrian streets,
// sidewalks along streets), turning at nodes; dodge nearby fast traffic and
// the on-foot player, flee from gunfire (run cycle), and respawn a while
// after being killed. Walkers that drift far from the camera are moved to a
// footway near it, so the crowd follows the player around the 1.2 km map.
// On death game.ts normally detaches the ped's body into a persistent corpse
// (physics/corpses.ts) and gives the ped a fresh, hidden rig (`bodyTaken`);
// otherwise the old rig plays its death animation here.

import * as THREE from "three";
import { angLerp } from "../core/math";
import { groundY } from "../world/ground";
import { randomPedColors } from "../player/human";
import { randomCharacter } from "../characters/characterChoice";
import type { CharacterRig, RigFactory, RigUpdate } from "../characters/characterRig";
import type { Vehicle } from "../vehicles/meshes";
import { createWalker, stepWalker, walkerPosition, type FootNetwork, type Walker } from "./footNetwork";

export interface Ped {
  walker: Walker;
  speed: number;
  /** Dodge offset added to the walking line. */
  ox: number;
  oz: number;
  /** Walking-line position (without the dodge offset), updated every frame. */
  x: number;
  z: number;
  mesh: CharacterRig;
  yaw: number;
  state: "walk" | "down";
  downT: number;
  fleeT: number;
  /** The dead body was detached as a corpse: keep the (fresh) rig hidden until respawn. */
  bodyTaken?: boolean;
}

const DOWN_RESPAWN_S = 5;
/** Peds farther than this from the camera are hidden; beyond RELOCATE_R they are moved near it. */
const VISIBLE_R = 130;
const RELOCATE_R = 210;
/** Relocated / respawned peds appear in this distance band from the camera. */
const PLACE_MIN = 40;
const PLACE_MAX = 150;

const _pos = { x: 0, z: 0, yaw: 0 };

/** A random walker on an edge within [minD, maxD] of (cx, cz) (any edge after a few failed tries). */
function randomWalker(net: FootNetwork, cx: number, cz: number, minD: number, maxD: number): Walker {
  const edges = net.edges;
  let fallback: Walker | null = null;
  for (let tries = 0; tries < 40; tries++) {
    const e = edges[Math.floor(Math.random() * edges.length)];
    const w = createWalker(net, e, Math.random() < 0.5, Math.random() < 0.5 ? 1 : -1, 0);
    w.s = Math.random() * w.path.length;
    walkerPosition(w, _pos);
    const d = Math.hypot(_pos.x - cx, _pos.z - cz);
    if (d >= minD && d <= maxD) return w;
    if (!fallback || d < maxD * 2) fallback = w;
  }
  return fallback!;
}

/** Pedestrians are local-only, so Math.random() picks their look freely. */
export function spawnPeds(scene: THREE.Scene, n: number, makeRig: RigFactory, net: FootNetwork, camX: number, camZ: number): Ped[] {
  const peds: Ped[] = [];
  if (net.edges.length === 0) return peds;
  for (let i = 0; i < n; i++) {
    const mesh = makeRig({ character: randomCharacter(), colors: randomPedColors(), castShadow: false });
    scene.add(mesh.group);
    const walker = randomWalker(net, camX, camZ, 0, PLACE_MAX);
    walkerPosition(walker, _pos);
    peds.push({
      walker,
      speed: (1.1 + Math.random() * 0.6) * (0.8 + Math.random() * 0.4),
      ox: 0,
      oz: 0,
      x: _pos.x,
      z: _pos.z,
      mesh,
      yaw: _pos.yaw,
      state: "walk",
      downT: 0,
      fleeT: 0,
    });
  }
  return peds;
}

function placeNear(p: Ped, net: FootNetwork, camX: number, camZ: number): void {
  p.walker = randomWalker(net, camX, camZ, PLACE_MIN, PLACE_MAX);
  walkerPosition(p.walker, _pos);
  p.x = _pos.x;
  p.z = _pos.z;
  p.yaw = _pos.yaw;
  p.ox = p.oz = 0;
}

function respawnPed(p: Ped, net: FootNetwork, camX: number, camZ: number): void {
  placeNear(p, net, camX, camZ);
  p.state = "walk";
  p.downT = 0;
  p.fleeT = 0;
  p.bodyTaken = false;
  p.mesh.group.visible = true;
}

const _anim: RigUpdate = { speed: 0, ground: true, weapon: "fists", aiming: false, alive: true, running: false };

export function updatePeds(
  peds: Ped[],
  dt: number,
  vehicles: Vehicle[],
  playerFoot: { mode: "foot" | "car"; x: number; z: number },
  camX: number,
  camZ: number,
  net: FootNetwork,
): void {
  for (const p of peds) {
    if (p.state === "down") {
      p.downT += dt;
      if (p.bodyTaken || p.downT > DOWN_RESPAWN_S * 0.4) p.mesh.group.visible = false;
      else {
        _anim.alive = false;
        p.mesh.update(dt, _anim);
      }
      if (p.downT > DOWN_RESPAWN_S) respawnPed(p, net, camX, camZ);
      continue;
    }
    if (Math.hypot(p.x - camX, p.z - camZ) > RELOCATE_R) placeNear(p, net, camX, camZ);
    if (p.fleeT > 0) p.fleeT -= dt;
    const fleeMul = p.fleeT > 0 ? 2.1 : 1;
    stepWalker(p.walker, net, p.speed * fleeMul * dt, Math.random);
    walkerPosition(p.walker, _pos);
    p.x = _pos.x;
    p.z = _pos.z;
    const camDist = Math.hypot(p.x - camX, p.z - camZ);
    if (camDist > VISIBLE_R) {
      p.mesh.group.visible = false;
      continue;
    }
    p.mesh.group.visible = true;
    for (const v of vehicles) {
      if (Math.abs(v.speed) < 2.5) continue;
      const dx = p.x + p.ox - v.x;
      const dz = p.z + p.oz - v.z;
      if (Math.abs(dx) > 4 || Math.abs(dz) > 4) continue;
      const d = Math.hypot(dx, dz);
      if (d < 3.5 && d > 0.01) {
        p.ox += (dx / d) * dt * 6;
        p.oz += (dz / d) * dt * 6;
      }
    }
    if (playerFoot.mode === "foot") {
      const dx = p.x + p.ox - playerFoot.x;
      const dz = p.z + p.oz - playerFoot.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.9 && d > 0.01) {
        p.ox += (dx / d) * dt * 3;
        p.oz += (dz / d) * dt * 3;
      }
    }
    p.ox *= Math.exp(-dt * 0.8);
    p.oz *= Math.exp(-dt * 0.8);
    p.yaw = angLerp(p.yaw, _pos.yaw, Math.min(1, dt * 8));
    const wx = p.x + p.ox;
    const wz = p.z + p.oz;
    p.mesh.group.position.set(wx, groundY(wx, wz, p.mesh.group.position.y + 1), wz);
    p.mesh.group.rotation.y = p.yaw;
    _anim.alive = true;
    _anim.speed = p.speed * fleeMul;
    _anim.running = p.fleeT > 0;
    // Walking-line velocity (feeds lean / banking); foot IK only near the camera.
    _anim.vx = Math.sin(_pos.yaw) * _anim.speed;
    _anim.vz = Math.cos(_pos.yaw) * _anim.speed;
    _anim.cameraDistance = camDist;
    p.mesh.update(dt, _anim);
  }
}

/** Current world position of a ped (walking line + dodge offset). */
export function pedPosition(p: Ped): { x: number; z: number } {
  return { x: p.x + p.ox, z: p.z + p.oz };
}

/** World-space walking velocity (m/s) of a living ped (its body inherits it on death). */
export function pedVelocity(p: Ped): { x: number; y: number; z: number } {
  if (p.state === "down") return { x: 0, y: 0, z: 0 };
  const sp = p.speed * (p.fleeT > 0 ? 2.1 : 1);
  return { x: Math.sin(p.yaw) * sp, y: 0, z: Math.cos(p.yaw) * sp };
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
    if (Math.hypot(p.x - x, p.z - z) < radius) p.fleeT = 2.5;
  }
}
