// Traffic AI: intersection decisions, Bezier-ish turns, lane following, gap
// detection against other vehicles and the on-foot player, and spawning.
// Uses Math.random() deliberately — traffic is local-only ambient behavior,
// not synced, so it does not need to be deterministic across clients.

import * as THREE from "three";
import { G, LANE, STOPD, WORLD, HALF, P, rc, inR } from "../core/constants";
import { angDiff, angLerp, clamp, lerp } from "../core/math";
import { groundY } from "../world/colliders";
import { lightState } from "../world/environment";
import type { CityState } from "../world/cityState";
import { addVeh, type Vehicle, type TurnGeom } from "./meshes";
import { VEHICLE_CATALOG, pickTint, pickVehicleType } from "./catalog";
import type { SpawnPool } from "./types";

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Livery cars (taxi, police) ignore the colour; it is still sent over the network. */
const LIVERY_COLOR = 0xffffff;

/** A random catalogue vehicle for `pool`, with a random body tint when its type takes one. */
function addRandomVeh(scene: THREE.Scene, pool: SpawnPool, x: number, z: number, yaw: number, mode: "ai" | "parked"): Vehicle {
  const type = pickVehicleType(Math.random, pool);
  return addVeh(scene, type, pickTint(VEHICLE_CATALOG[type], Math.random) ?? LIVERY_COLOR, x, z, yaw, mode);
}

function decide(a: { ix: number; iz: number; dx: number; dz: number }): "S" | "L" | "R" {
  const o: ("S" | "L" | "R")[] = [];
  if (inR(a.ix + a.dx, a.iz + a.dz)) o.push("S", "S", "S", "S", "S");
  if (inR(a.ix - a.dz, a.iz + a.dx)) o.push("R", "R");
  if (inR(a.ix + a.dz, a.iz - a.dx)) o.push("L", "L");
  return pick(o);
}

function turnGeom(a: { ix: number; iz: number; dx: number; dz: number; dec: "S" | "L" | "R" | null }): TurnGeom {
  const cx = rc(a.ix);
  const cz = rc(a.iz);
  const rx = -a.dz;
  const rz = a.dx;
  const R = a.dec === "R";
  const nx = R ? rx : a.dz;
  const nz = R ? rz : -a.dx;
  const nrx = -nz;
  const nrz = nx;
  const Px = cx + rx * LANE + nrx * LANE;
  const Pz = cz + rz * LANE + nrz * LANE;
  const r = R ? 5 : 8;
  return { nx, nz, P: { x: Px, z: Pz }, S: { x: Px - a.dx * r, z: Pz - a.dz * r }, T: { x: Px + nx * r, z: Pz + nz * r }, r, nix: a.ix + nx, niz: a.iz + nz, u: 0 };
}

export interface FootPlayerRef {
  mode: "foot" | "car";
  x: number;
  z: number;
}

export function updateAI(v: Vehicle, dt: number, vehicles: Vehicle[], tod: number, player: FootPlayerRef): void {
  const a = v.ai!;
  const prevYaw = v.yaw;
  if (a.turn) {
    const t = a.turn;
    const tl = Math.sqrt((1 - t.u) * (1 - t.u) + t.u * t.u);
    v.speed += (Math.min(7.5, a.cruise) - v.speed) * Math.min(1, dt * 2);
    t.u = Math.min(1, t.u + (Math.max(v.speed, 1) * dt) / (2 * t.r * tl));
    const u = t.u;
    const w = 1 - u;
    v.x = w * w * t.S.x + 2 * u * w * t.P.x + u * u * t.T.x;
    v.z = w * w * t.S.z + 2 * u * w * t.P.z + u * u * t.T.z;
    v.yaw = Math.atan2(w * a.dx + u * t.nx, w * a.dz + u * t.nz);
    if (t.u >= 1) {
      a.dx = t.nx;
      a.dz = t.nz;
      a.ix = t.nix;
      a.iz = t.niz;
      a.turn = null;
      a.dec = decide(a);
      v.x = t.T.x;
      v.z = t.T.z;
    }
  } else {
    const dc = (rc(a.ix) - v.x) * a.dx + (rc(a.iz) - v.z) * a.dz;
    let target = a.cruise;
    const st = lightState(tod, a.dx !== 0 ? 0 : 1);
    const dStop = dc - STOPD;
    if (dStop > -1.0 && (st === "R" || (st === "Y" && dStop > (v.speed * v.speed) / 14))) target = Math.min(target, Math.sqrt(Math.max(0, dStop) * 8));
    let began = false;
    if (a.dec !== "S") {
      const g = turnGeom(a);
      const dS = (g.S.x - v.x) * a.dx + (g.S.z - v.z) * a.dz;
      target = Math.min(target, 7.5 + Math.max(0, dS) * 0.5);
      if (dS <= 0.05) {
        a.turn = g;
        v.x = g.S.x;
        v.z = g.S.z;
        began = true;
      }
    } else if (dc < -1.5) {
      a.ix += a.dx;
      a.iz += a.dz;
      a.dec = decide(a);
    }
    if (!began) {
      let gapMin = 1e9;
      const look = 7 + v.speed * 1.3;
      for (const u of vehicles) {
        if (u === v) continue;
        if (a.ghost > 0 && u.mode !== "player") continue;
        const rx = u.x - v.x;
        const rz = u.z - v.z;
        const al = rx * a.dx + rz * a.dz;
        if (al < 0.5 || al > look + 4) continue;
        const lat = Math.abs(rx * -a.dz + rz * a.dx);
        if (lat < (u.spec.W + v.spec.W) / 2 + 0.45) {
          const gap = al - (u.spec.L + v.spec.L) / 2;
          if (gap < gapMin) gapMin = gap;
        }
      }
      if (player.mode === "foot") {
        const rx = player.x - v.x;
        const rz = player.z - v.z;
        const al = rx * a.dx + rz * a.dz;
        if (al > 0.5 && al < look + 4 && Math.abs(rx * -a.dz + rz * a.dx) < 1.8) {
          const gap = al - v.spec.L / 2 - 0.5;
          if (gap < gapMin) gapMin = gap;
        }
      }
      if (gapMin < 1e8) target = Math.min(target, Math.sqrt(Math.max(0, gapMin - 2.0) * 10));
      if (v.speed < 0.3 && gapMin < 1e8 && (st === "G" || dStop < -1)) a.stuck += dt;
      else a.stuck = 0;
      if (a.stuck > 8) {
        a.ghost = 4;
        a.stuck = 0;
      }
      if (a.ghost > 0) a.ghost -= dt;
      if (target > v.speed) v.speed = Math.min(target, v.speed + a.acc * dt);
      else v.speed = Math.max(target, v.speed - 12 * dt);
      v.x += a.dx * v.speed * dt;
      v.z += a.dz * v.speed * dt;
      if (a.dx !== 0) {
        const zl = rc(a.iz) + a.dx * LANE;
        v.z += (zl - v.z) * Math.min(1, dt * 3);
      } else {
        const xl = rc(a.ix) + -a.dz * LANE;
        v.x += (xl - v.x) * Math.min(1, dt * 3);
      }
      v.yaw = angLerp(v.yaw, Math.atan2(a.dx, a.dz), Math.min(1, dt * 8));
    }
  }
  const dy = angDiff(prevYaw, v.yaw) / dt;
  v.steerVis = clamp(Math.atan((dy * v.spec.wb) / Math.max(2, v.speed)), -0.5, 0.5);
  v.vx = Math.sin(v.yaw) * v.speed;
  v.vz = Math.cos(v.yaw) * v.speed;
  v.braking = false;
  v.y += (groundY(v.x, v.z) - v.y) * Math.min(1, dt * 14);
}

export function spawnAI(scene: THREE.Scene, vehicles: Vehicle[], n: number): void {
  let tries = 0;
  let made = 0;
  while (made < n && tries < 800) {
    tries++;
    const axis = Math.random() < 0.5 ? 0 : 1;
    const r = Math.floor(Math.random() * (G + 1));
    const dir = Math.random() < 0.5 ? 1 : -1;
    const a = lerp(-WORLD + 30, WORLD - 30, Math.random());
    const f = (a - rc(0)) / P;
    const k = Math.round(f);
    if (Math.abs(a - rc(k)) < HALF + 10) continue;
    const dx = axis === 0 ? dir : 0;
    const dz = axis === 1 ? dir : 0;
    const x = axis === 0 ? a : rc(r) + -dz * LANE;
    const z = axis === 0 ? rc(r) + dx * LANE : a;
    if (Math.hypot(x - 21, z - 10) < 25) continue;
    if (vehicles.some((v) => Math.hypot(v.x - x, v.z - z) < 12)) continue;
    const nxt = dir > 0 ? Math.floor(f) + 1 : Math.ceil(f) - 1;
    const v = addRandomVeh(scene, "traffic", x, z, Math.atan2(dx, dz), "ai");
    v.ai = {
      dx,
      dz,
      ix: axis === 0 ? nxt : r,
      iz: axis === 0 ? r : nxt,
      turn: null,
      dec: null,
      cruise: 11 + Math.random() * 7,
      acc: 4 + Math.random() * 2,
      stuck: 0,
      ghost: 0,
    };
    v.ai.dec = decide(v.ai);
    v.speed = v.ai.cruise * 0.7;
    vehicles.push(v);
    made++;
  }
}

export function spawnVehicles(scene: THREE.Scene, vehicles: Vehicle[], city: CityState): void {
  for (const v of vehicles) scene.remove(v.root);
  vehicles.length = 0;
  const first = addVeh(scene, "sedan", 0x2f6fd6, 24, 7.5, Math.PI / 2, "parked");
  vehicles.push(first);
  for (const s of city.streetSlots) {
    if (Math.hypot(s.x - 24, s.z - 7.5) < 10) continue;
    vehicles.push(addRandomVeh(scene, "parked", s.x + (Math.random() - 0.5) * 0.4, s.z + (Math.random() - 0.5) * 0.3, s.yaw + (Math.random() - 0.5) * 0.05, "parked"));
  }
  for (const s of city.lotSlots) {
    if (Math.random() < 0.6) vehicles.push(addRandomVeh(scene, "parked", s.x, s.z, s.yaw + (Math.random() - 0.5) * 0.05, "parked"));
  }
  spawnAI(scene, vehicles, 24);
  for (const v of vehicles) {
    v.y = groundY(v.x, v.z);
  }
}
