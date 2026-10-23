// The local player's full runtime state: foot/car transform, health, weapon.

import type { WeaponId } from "@shared/protocol";
import { MAX_HEALTH, WEAPONS } from "@shared/protocol";
import type { Vehicle } from "../vehicles/meshes";
import type { HumanRig } from "./human";

export type PlayerMode = "foot" | "car";

export interface AmmoState {
  mag: number;
  reserve: number;
  reloading: boolean;
  reloadT: number;
  fireCooldown: number;
  spread: number;
}

export interface PlayerState {
  x: number;
  z: number;
  y: number;
  yaw: number;
  vx: number;
  vz: number;
  vy: number;
  ground: boolean;
  mode: PlayerMode;
  car: Vehicle | null;
  phase: number;
  mesh: HumanRig;
  health: number;
  alive: boolean;
  lastDamageAt: number;
  weapon: WeaponId;
  ammo: Record<WeaponId, AmmoState>;
  aiming: boolean;
  firing: boolean;
  deathFall: number;
}

export function createAmmoState(mag: number, reserve: number): AmmoState {
  return { mag, reserve, reloading: false, reloadT: 0, fireCooldown: 0, spread: 0 };
}

export function createPlayerState(mesh: HumanRig, x: number, z: number, yaw: number): PlayerState {
  return {
    x,
    z,
    y: 0.25,
    yaw,
    vx: 0,
    vz: 0,
    vy: 0,
    ground: true,
    mode: "foot",
    car: null,
    phase: 0,
    mesh,
    health: MAX_HEALTH,
    alive: true,
    lastDamageAt: -Infinity,
    weapon: "fists",
    ammo: {
      fists: createAmmoState(WEAPONS.fists.magSize, WEAPONS.fists.reserve),
      pistol: createAmmoState(WEAPONS.pistol.magSize, WEAPONS.pistol.reserve),
      m4: createAmmoState(WEAPONS.m4.magSize, WEAPONS.m4.reserve),
    },
    aiming: false,
    firing: false,
    deathFall: 0,
  };
}
