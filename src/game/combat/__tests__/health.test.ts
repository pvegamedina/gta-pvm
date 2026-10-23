import { describe, it, expect } from "vitest";
import { MAX_HEALTH } from "@shared/protocol";
import {
  createHealthState,
  applyDamage,
  tickRegen,
  respawn,
  vehicleHitDamage,
  crashDamage,
  healthColor,
  REGEN_DELAY_S,
  REGEN_RATE_HP_S,
  VEHICLE_HIT_SPEED_THRESHOLD,
  CRASH_IMPACT_THRESHOLD,
} from "../health";

describe("applyDamage", () => {
  it("reduces health and records the damage timestamp", () => {
    const s = createHealthState();
    applyDamage(s, 30, 10);
    expect(s.health).toBe(MAX_HEALTH - 30);
    expect(s.lastDamageAt).toBe(10);
  });

  it("clamps at 0 and reports a kill", () => {
    const s = createHealthState();
    const killed = applyDamage(s, 1000, 0);
    expect(s.health).toBe(0);
    expect(s.alive).toBe(false);
    expect(killed).toBe(true);
  });

  it("does nothing once already dead", () => {
    const s = createHealthState();
    applyDamage(s, 1000, 0);
    const killed = applyDamage(s, 10, 1);
    expect(killed).toBe(false);
    expect(s.health).toBe(0);
  });

  it("ignores non-positive damage amounts", () => {
    const s = createHealthState();
    applyDamage(s, 0, 0);
    applyDamage(s, -5, 0);
    expect(s.health).toBe(MAX_HEALTH);
  });
});

describe("tickRegen", () => {
  it("does not regen before the delay has elapsed", () => {
    const s = createHealthState();
    applyDamage(s, 50, 0);
    tickRegen(s, 1, REGEN_DELAY_S - 0.5);
    expect(s.health).toBe(MAX_HEALTH - 50);
  });

  it("regenerates at REGEN_RATE_HP_S once the delay has elapsed", () => {
    const s = createHealthState();
    applyDamage(s, 50, 0);
    tickRegen(s, 1, REGEN_DELAY_S + 1);
    expect(s.health).toBe(MAX_HEALTH - 50 + REGEN_RATE_HP_S);
  });

  it("never regenerates past MAX_HEALTH", () => {
    const s = createHealthState();
    applyDamage(s, 2, 0);
    tickRegen(s, 100, REGEN_DELAY_S + 1);
    expect(s.health).toBe(MAX_HEALTH);
  });

  it("does not regenerate the dead", () => {
    const s = createHealthState();
    applyDamage(s, 1000, 0);
    tickRegen(s, 100, REGEN_DELAY_S + 10);
    expect(s.health).toBe(0);
  });
});

describe("respawn", () => {
  it("restores full health and aliveness", () => {
    const s = createHealthState();
    applyDamage(s, 1000, 0);
    respawn(s);
    expect(s.health).toBe(MAX_HEALTH);
    expect(s.alive).toBe(true);
  });
});

describe("vehicleHitDamage", () => {
  it("is zero at or below the speed threshold", () => {
    expect(vehicleHitDamage(VEHICLE_HIT_SPEED_THRESHOLD)).toBe(0);
    expect(vehicleHitDamage(2)).toBe(0);
  });

  it("scales proportionally above the threshold", () => {
    const d1 = vehicleHitDamage(VEHICLE_HIT_SPEED_THRESHOLD + 2);
    const d2 = vehicleHitDamage(VEHICLE_HIT_SPEED_THRESHOLD + 4);
    expect(d1).toBeGreaterThan(0);
    expect(d2).toBeGreaterThan(d1);
  });
});

describe("crashDamage", () => {
  it("is zero at or below the crash impact threshold", () => {
    expect(crashDamage(CRASH_IMPACT_THRESHOLD)).toBe(0);
    expect(crashDamage(5)).toBe(0);
  });

  it("scales proportionally above the threshold", () => {
    expect(crashDamage(CRASH_IMPACT_THRESHOLD + 10)).toBeGreaterThan(0);
  });
});

describe("healthColor", () => {
  it("is green above 60, yellow between 30-60, red at or below 30", () => {
    expect(healthColor(100)).toBe("#4ade80");
    expect(healthColor(45)).toBe("#facc15");
    expect(healthColor(10)).toBe("#ef4444");
  });
});
