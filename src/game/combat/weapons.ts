// Pure ammo/reload/fire-rate state machine, shared by local prediction and
// (indirectly, via the same math) server validation expectations. No DOM/THREE
// deps so it is unit-testable in isolation.

import type { WeaponId, WeaponSpec } from "@shared/protocol";
import { WEAPONS } from "@shared/protocol";
import type { AmmoState } from "../player/playerState";

export interface FireResult {
  fired: boolean;
  dryClick: boolean;
  startedReload: boolean;
}

/** Advances cooldown/reload timers by dt. Completes a reload when its timer elapses. */
export function tickWeapon(ammo: AmmoState, spec: WeaponSpec, dt: number): void {
  if (ammo.fireCooldown > 0) ammo.fireCooldown = Math.max(0, ammo.fireCooldown - dt);
  if (ammo.reloading) {
    ammo.reloadT -= dt;
    if (ammo.reloadT <= 0) {
      completeReload(ammo, spec);
    }
  }
  // Spread bloom decays back to baseline when not actively firing.
  if (ammo.fireCooldown <= 0 && !ammo.reloading) {
    ammo.spread = Math.max(0, ammo.spread - dt * 0.08);
  }
}

export function completeReload(ammo: AmmoState, spec: WeaponSpec): void {
  const need = spec.magSize - ammo.mag;
  const take = Math.min(need, ammo.reserve);
  ammo.mag += take;
  ammo.reserve -= take;
  ammo.reloading = false;
  ammo.reloadT = 0;
}

export function startReload(ammo: AmmoState, spec: WeaponSpec): boolean {
  if (spec.magSize === 0) return false;
  if (ammo.reloading) return false;
  if (ammo.mag >= spec.magSize) return false;
  if (ammo.reserve <= 0) return false;
  ammo.reloading = true;
  ammo.reloadT = spec.reloadTime;
  return true;
}

/**
 * Attempts to fire once. Mutates ammo on success (decrements mag, resets cooldown,
 * adds recoil-bloom spread). Auto-reloads when the mag is empty but reserve remains.
 */
export function tryFire(ammo: AmmoState, spec: WeaponSpec): FireResult {
  if (ammo.reloading) return { fired: false, dryClick: false, startedReload: false };
  if (ammo.fireCooldown > 0) return { fired: false, dryClick: false, startedReload: false };
  if (ammo.mag <= 0) {
    const startedReload = startReload(ammo, spec);
    return { fired: false, dryClick: !startedReload, startedReload };
  }
  ammo.mag -= 1;
  ammo.fireCooldown = spec.fireInterval;
  ammo.spread = Math.min(spec.maxSpread, ammo.spread + spec.spreadPerShot);
  let startedReload = false;
  if (ammo.mag <= 0 && ammo.reserve > 0) startedReload = startReload(ammo, spec);
  return { fired: true, dryClick: false, startedReload };
}

/** Fists have no ammo — just a fire-rate gate. Returns true when the melee swing is allowed. */
export function tryMelee(ammo: AmmoState, spec: WeaponSpec): boolean {
  if (ammo.fireCooldown > 0) return false;
  ammo.fireCooldown = spec.fireInterval;
  return true;
}

export function weaponSpec(id: WeaponId): WeaponSpec {
  return WEAPONS[id];
}

export function totalSpread(spec: WeaponSpec, ammo: AmmoState): number {
  return spec.spread + ammo.spread;
}

export const WEAPON_CYCLE_ORDER: WeaponId[] = ["fists", "pistol", "m4"];

export function nextWeapon(current: WeaponId): WeaponId {
  const i = WEAPON_CYCLE_ORDER.indexOf(current);
  return WEAPON_CYCLE_ORDER[(i + 1) % WEAPON_CYCLE_ORDER.length];
}
