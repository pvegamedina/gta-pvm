import { describe, it, expect } from "vitest";
import { WEAPONS } from "@shared/protocol";
import { createAmmoState } from "../../player/playerState";
import { tickWeapon, tryFire, tryMelee, startReload, completeReload, nextWeapon, totalSpread } from "../weapons";

describe("tryFire", () => {
  it("fires and decrements the magazine", () => {
    const ammo = createAmmoState(WEAPONS.pistol.magSize, WEAPONS.pistol.reserve);
    const res = tryFire(ammo, WEAPONS.pistol);
    expect(res.fired).toBe(true);
    expect(res.dryClick).toBe(false);
    expect(ammo.mag).toBe(WEAPONS.pistol.magSize - 1);
    expect(ammo.fireCooldown).toBeCloseTo(WEAPONS.pistol.fireInterval);
  });

  it("respects the fire-rate cooldown (no fire while cooling down)", () => {
    const ammo = createAmmoState(WEAPONS.pistol.magSize, WEAPONS.pistol.reserve);
    tryFire(ammo, WEAPONS.pistol);
    const second = tryFire(ammo, WEAPONS.pistol);
    expect(second.fired).toBe(false);
    expect(second.dryClick).toBe(false);
  });

  it("can fire again once the cooldown has fully elapsed", () => {
    const ammo = createAmmoState(WEAPONS.pistol.magSize, WEAPONS.pistol.reserve);
    tryFire(ammo, WEAPONS.pistol);
    tickWeapon(ammo, WEAPONS.pistol, WEAPONS.pistol.fireInterval + 0.001);
    const second = tryFire(ammo, WEAPONS.pistol);
    expect(second.fired).toBe(true);
    expect(ammo.mag).toBe(WEAPONS.pistol.magSize - 2);
  });

  it("dry-clicks when empty with no reserve", () => {
    const ammo = createAmmoState(0, 0);
    const res = tryFire(ammo, WEAPONS.pistol);
    expect(res.fired).toBe(false);
    expect(res.dryClick).toBe(true);
  });

  it("auto-reloads when the magazine empties and reserve remains", () => {
    const ammo = createAmmoState(1, 50);
    const res = tryFire(ammo, WEAPONS.pistol);
    expect(res.fired).toBe(true);
    expect(res.startedReload).toBe(true);
    expect(ammo.reloading).toBe(true);
    expect(ammo.mag).toBe(0);
  });

  it("does not fire while reloading", () => {
    const ammo = createAmmoState(0, 50);
    startReload(ammo, WEAPONS.pistol);
    const res = tryFire(ammo, WEAPONS.pistol);
    expect(res.fired).toBe(false);
    expect(res.dryClick).toBe(false);
  });

  it("adds recoil-bloom spread per shot, capped at maxSpread", () => {
    const ammo = createAmmoState(WEAPONS.m4.magSize, WEAPONS.m4.reserve);
    for (let i = 0; i < 50; i++) {
      tryFire(ammo, WEAPONS.m4);
      tickWeapon(ammo, WEAPONS.m4, WEAPONS.m4.fireInterval + 0.001);
    }
    expect(ammo.spread).toBeLessThanOrEqual(WEAPONS.m4.maxSpread);
    expect(totalSpread(WEAPONS.m4, ammo)).toBeGreaterThan(WEAPONS.m4.spread);
  });
});

describe("reload state machine", () => {
  it("startReload refuses when the mag is already full", () => {
    const ammo = createAmmoState(WEAPONS.pistol.magSize, WEAPONS.pistol.reserve);
    expect(startReload(ammo, WEAPONS.pistol)).toBe(false);
  });

  it("startReload refuses when there is no reserve ammo", () => {
    const ammo = createAmmoState(0, 0);
    expect(startReload(ammo, WEAPONS.pistol)).toBe(false);
  });

  it("completeReload moves ammo from reserve into the magazine, capped at magSize", () => {
    const ammo = createAmmoState(2, 500);
    ammo.reloading = true;
    completeReload(ammo, WEAPONS.pistol);
    expect(ammo.mag).toBe(WEAPONS.pistol.magSize);
    expect(ammo.reserve).toBe(500 - (WEAPONS.pistol.magSize - 2));
    expect(ammo.reloading).toBe(false);
  });

  it("completeReload takes only what the reserve has when reserve is scarce", () => {
    const ammo = createAmmoState(2, 3);
    completeReload(ammo, WEAPONS.pistol);
    expect(ammo.mag).toBe(5);
    expect(ammo.reserve).toBe(0);
  });

  it("tickWeapon finishes the reload once the timer elapses", () => {
    const ammo = createAmmoState(0, 50);
    startReload(ammo, WEAPONS.pistol);
    tickWeapon(ammo, WEAPONS.pistol, WEAPONS.pistol.reloadTime - 0.01);
    expect(ammo.reloading).toBe(true);
    tickWeapon(ammo, WEAPONS.pistol, 0.02);
    expect(ammo.reloading).toBe(false);
    expect(ammo.mag).toBe(WEAPONS.pistol.magSize);
  });
});

describe("tryMelee (fists)", () => {
  it("gates on the fire-rate cooldown with no ammo involved", () => {
    const ammo = createAmmoState(0, 0);
    expect(tryMelee(ammo, WEAPONS.fists)).toBe(true);
    expect(tryMelee(ammo, WEAPONS.fists)).toBe(false);
    tickWeapon(ammo, WEAPONS.fists, WEAPONS.fists.fireInterval + 0.01);
    expect(tryMelee(ammo, WEAPONS.fists)).toBe(true);
  });
});

describe("nextWeapon", () => {
  it("cycles fists -> pistol -> m4 -> fists", () => {
    expect(nextWeapon("fists")).toBe("pistol");
    expect(nextWeapon("pistol")).toBe("m4");
    expect(nextWeapon("m4")).toBe("fists");
  });
});
