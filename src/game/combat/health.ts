// Pure health rules: damage application, regen-after-delay, and vehicle/fall
// damage thresholds. No DOM/THREE deps so it is unit-testable in isolation.

import { MAX_HEALTH } from "@shared/protocol";

export const REGEN_DELAY_S = 6;
export const REGEN_RATE_HP_S = 4;
export const VEHICLE_HIT_SPEED_THRESHOLD = 6;
export const VEHICLE_HIT_DAMAGE_PER_MS = 2.2;
export const CRASH_IMPACT_THRESHOLD = 14;
export const CRASH_DAMAGE_PER_UNIT = 0.9;

export interface HealthState {
  health: number;
  alive: boolean;
  lastDamageAt: number;
}

export function createHealthState(): HealthState {
  return { health: MAX_HEALTH, alive: true, lastDamageAt: -Infinity };
}

/** Applies damage, clamping at 0, and marks death when it crosses zero. Returns true if this hit killed. */
export function applyDamage(state: HealthState, amount: number, nowS: number): boolean {
  if (!state.alive || amount <= 0) return false;
  state.health = Math.max(0, state.health - amount);
  state.lastDamageAt = nowS;
  if (state.health <= 0) {
    state.alive = false;
    return true;
  }
  return false;
}

/** Regenerates health once `REGEN_DELAY_S` has passed since the last damage. */
export function tickRegen(state: HealthState, dt: number, nowS: number): void {
  if (!state.alive) return;
  if (state.health >= MAX_HEALTH) return;
  if (nowS - state.lastDamageAt < REGEN_DELAY_S) return;
  state.health = Math.min(MAX_HEALTH, state.health + REGEN_RATE_HP_S * dt);
}

export function respawn(state: HealthState): void {
  state.health = MAX_HEALTH;
  state.alive = true;
  state.lastDamageAt = -Infinity;
}

/** Damage for being hit by traffic while on foot: proportional to relative speed above the threshold. */
export function vehicleHitDamage(relativeSpeed: number): number {
  if (relativeSpeed <= VEHICLE_HIT_SPEED_THRESHOLD) return 0;
  return (relativeSpeed - VEHICLE_HIT_SPEED_THRESHOLD) * VEHICLE_HIT_DAMAGE_PER_MS;
}

/** Damage for a hard car crash while driving: only above the impact threshold. */
export function crashDamage(impact: number): number {
  if (impact <= CRASH_IMPACT_THRESHOLD) return 0;
  return (impact - CRASH_IMPACT_THRESHOLD) * CRASH_DAMAGE_PER_UNIT;
}

export function healthColor(health: number): string {
  if (health > 60) return "#4ade80";
  if (health > 30) return "#facc15";
  return "#ef4444";
}
