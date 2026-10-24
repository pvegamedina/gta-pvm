import { describe, it, expect } from "vitest";
import {
  EngineModel,
  ENGINE_PROFILES,
  engineProfileFor,
  engineSoundParams,
  wheelRpm,
  nearestVoices,
  estimateThrottle,
  type EngineEvent,
  type EngineProfile,
} from "../engine";

const DT = 1 / 60;
// Sedan spec (vehicles/types.ts): top speed 40 m/s, acc 11, wheel radius 0.36 m.
const SEDAN = { topSpeed: 40, wheelRadius: 0.36 };

function make(type = "sedan", spec = SEDAN) {
  return new EngineModel(engineProfileFor(type), spec.topSpeed, spec.wheelRadius);
}

/** Full-throttle run with the same speed law as vehicles/playerCar.ts (acc * (1 - v/max)). */
function fullThrottleRun(m: EngineModel, seconds: number, acc = 11, max = 40) {
  let v = 0;
  const log: { t: number; v: number; rpm: number; gear: number; load: number; events: EngineEvent[] }[] = [];
  for (let i = 0; i < seconds / DT; i++) {
    v += acc * (1 - v / max) * DT;
    const events = [...m.update(DT, { speed: v, throttle: 1 })];
    log.push({ t: i * DT, v, rpm: m.rpm, gear: m.gear, load: m.load, events });
  }
  return log;
}

describe("wheelRpm", () => {
  it("converts road speed to wheel revolutions per minute", () => {
    expect(wheelRpm(10, 0.36)).toBeCloseTo((10 / (2 * Math.PI * 0.36)) * 60, 9);
    expect(wheelRpm(-10, 0.36)).toBeCloseTo(wheelRpm(10, 0.36), 9);
  });
});

describe("EngineModel", () => {
  it("idles in first gear when stopped", () => {
    const m = make();
    for (let i = 0; i < 120; i++) m.update(DT, { speed: 0, throttle: 0 });
    expect(m.gear).toBe(1);
    expect(m.rpm).toBeCloseTo(m.profile.idleRpm, 0);
  });

  it("revs (clutch slip) when launching from standstill", () => {
    const m = make();
    for (let i = 0; i < 30; i++) m.update(DT, { speed: 0, throttle: 1 });
    expect(m.rpm).toBeGreaterThan(m.profile.idleRpm + 1000);
    expect(m.rpm).toBeLessThan(m.profile.limiterRpm);
  });

  it("geared rpm follows wheel speed x gear ratio x final drive", () => {
    const m = make();
    const r = m.gearedRpm(15, 2);
    expect(r).toBeCloseTo(wheelRpm(15, 0.36) * m.profile.gears[1] * m.finalDrive, 6);
  });

  it("is geared so top speed lands in top gear well below the redline", () => {
    for (const type of ["sedan", "sport", "suv", "van"]) {
      const m = make(type);
      const top = m.gearedRpm(SEDAN.topSpeed, m.profile.gears.length);
      expect(top / m.profile.redline).toBeGreaterThan(0.7);
      expect(top / m.profile.redline).toBeLessThan(0.9);
    }
  });

  it("upshifts through the gears near the redline at full throttle, with an rpm drop and torque cut", () => {
    const m = make();
    const log = fullThrottleRun(m, 12);
    const ups = log.filter((s) => s.events.includes("upshift"));
    expect(ups.length).toBeGreaterThanOrEqual(3);
    let gear = 1;
    for (const s of log) {
      expect(s.gear).toBeGreaterThanOrEqual(gear); // never downshifts while accelerating
      gear = s.gear;
      expect(s.rpm).toBeLessThanOrEqual(m.profile.limiterRpm + 1);
    }
    for (const u of ups) {
      const i = log.indexOf(u);
      const before = log[i - 1].rpm;
      expect(before / m.profile.redline).toBeGreaterThan(0.85);
      // Torque cut during the shift, rpm falls towards the next gear.
      expect(log[i + 2].load).toBeLessThan(0.3);
      const after = log[i + Math.ceil(m.profile.shiftTime / DT)].rpm;
      expect(after).toBeLessThan(before * 0.9);
    }
  });

  it("shifts earlier at part throttle", () => {
    const part = make();
    let v = 0;
    let firstShiftRpm = 0;
    let prev = part.rpm;
    for (let i = 0; i < 600 && !firstShiftRpm; i++) {
      v += 4 * (1 - v / 40) * DT;
      prev = part.rpm;
      if (part.update(DT, { speed: v, throttle: 0.3 }).includes("upshift")) firstShiftRpm = prev;
    }
    expect(firstShiftRpm).toBeGreaterThan(0);
    expect(firstShiftRpm).toBeLessThan(0.75 * part.profile.redline);
  });

  it("does not hunt between gears at a steady speed and throttle", () => {
    for (let speed = 2; speed <= 40; speed += 1.5) {
      for (const throttle of [0, 0.3, 0.6, 1]) {
        const m = make();
        for (let i = 0; i < 120; i++) m.update(DT, { speed, throttle }); // settle
        let shifts = 0;
        for (let i = 0; i < 300; i++) shifts += m.update(DT, { speed, throttle }).filter((e) => e === "upshift" || e === "downshift").length;
        expect(shifts).toBe(0);
      }
    }
  });

  it("downshifts progressively while coasting to a stop, never below idle", () => {
    const m = make();
    fullThrottleRun(m, 10);
    const topGear = m.gear;
    let v = 35;
    let downs = 0;
    while (v > 0) {
      v = Math.max(0, v - 6 * DT);
      downs += m.update(DT, { speed: v, throttle: 0 }).filter((e) => e === "downshift").length;
      expect(m.rpm).toBeGreaterThanOrEqual(m.profile.idleRpm - 1);
    }
    for (let i = 0; i < 60; i++) m.update(DT, { speed: 0, throttle: 0 });
    expect(downs).toBeGreaterThanOrEqual(topGear - 2);
    expect(m.gear).toBe(1);
  });

  it("drops several gears at once under hard braking, reaching first before stopping", () => {
    const m = make();
    for (let i = 0; i < 600; i++) m.update(DT, { speed: 22, throttle: 0.15 });
    const from = m.gear;
    let v = 22;
    let downs = 0;
    while (v > 1.5) {
      v -= 12 * DT; // emergency stop
      downs += m.update(DT, { speed: v, throttle: 0 }).filter((e) => e === "downshift").length;
    }
    for (let i = 0; i < 40; i++) m.update(DT, { speed: 1, throttle: 0 });
    expect(m.gear).toBe(1);
    expect(downs).toBeLessThan(from - 1);
  });

  it("kicks down when flooring it while cruising in a tall gear", () => {
    const m = make();
    for (let i = 0; i < 600; i++) m.update(DT, { speed: 22, throttle: 0.15 });
    const cruise = m.gear;
    let kicked = false;
    for (let i = 0; i < 60; i++) kicked = m.update(DT, { speed: 22, throttle: 1 }).includes("downshift") || kicked;
    expect(kicked).toBe(true);
    expect(m.gear).toBeLessThan(cruise);
  });

  it("bounces off the rev limiter when the wheels overspeed the engine", () => {
    const m = make();
    fullThrottleRun(m, 15);
    const rpms: number[] = [];
    for (let i = 0; i < 120; i++) {
      m.update(DT, { speed: 60, throttle: 1 });
      rpms.push(m.rpm);
    }
    expect(Math.max(...rpms)).toBeLessThanOrEqual(m.profile.limiterRpm + 60);
    expect(Math.min(...rpms.slice(30))).toBeLessThan(m.profile.limiterRpm - 100);
  });

  it("uses the reverse gear when backing up, without shift events", () => {
    const m = make();
    const events: EngineEvent[] = [];
    for (let i = 0; i < 120; i++) events.push(...m.update(DT, { speed: -5, throttle: 1 }));
    expect(m.gear).toBe(-1);
    expect(m.rpm).toBeCloseTo(m.gearedRpm(-5, -1), -1);
    expect(events.filter((e) => e === "upshift" || e === "downshift")).toHaveLength(0);
    for (let i = 0; i < 60; i++) m.update(DT, { speed: 0, throttle: 0 });
    expect(m.gear).toBe(1);
  });

  it("spools the turbo and blows off on lift-off (sport)", () => {
    const m = make("sport", { topSpeed: 54, wheelRadius: 0.35 });
    for (let i = 0; i < 120; i++) m.update(DT, { speed: 20, throttle: 1 });
    expect(m.boost).toBeGreaterThan(0.5);
    let blew = false;
    for (let i = 0; i < 30; i++) blew = m.update(DT, { speed: 20, throttle: 0 }).includes("blowoff") || blew;
    expect(blew).toBe(true);
    const sedan = make();
    for (let i = 0; i < 120; i++) sedan.update(DT, { speed: 20, throttle: 1 });
    expect(sedan.boost).toBe(0);
  });

  it("is framerate independent", () => {
    const run = (dt: number) => {
      const m = make();
      let v = 0;
      for (let t = 0; t < 2.5; t += dt) {
        v += 11 * (1 - v / 40) * dt;
        m.update(dt, { speed: v, throttle: 1 });
      }
      return m;
    };
    const fine = run(1 / 240);
    const coarse = run(1 / 30);
    expect(coarse.gear).toBe(fine.gear);
    expect(Math.abs(coarse.rpm - fine.rpm) / fine.rpm).toBeLessThan(0.06);
  });
});

describe("engine profiles", () => {
  it("covers every current vehicle type plus the planned bus/police/ambulance", () => {
    for (const t of ["sedan", "hatch", "taxi", "sport", "suv", "van", "bus", "police", "ambulance"]) expect(ENGINE_PROFILES[t]).toBeDefined();
    expect(engineProfileFor("spaceship")).toBe(ENGINE_PROFILES.sedan);
  });

  it("has sane, distinct characters", () => {
    const p = ENGINE_PROFILES;
    expect(p.van.diesel).toBe(true);
    expect(p.bus.diesel).toBe(true);
    expect(p.van.redline).toBeLessThan(p.sedan.redline);
    expect(p.sport.turbo).toBe(true);
    expect(p.sport.shiftTime).toBeLessThan(p.sedan.shiftTime);
    for (const prof of Object.values(p) as EngineProfile[]) {
      expect(prof.idleRpm).toBeLessThan(prof.redline);
      expect(prof.redline).toBeLessThan(prof.limiterRpm);
      for (let i = 1; i < prof.gears.length; i++) expect(prof.gears[i]).toBeLessThan(prof.gears[i - 1]);
    }
  });
});

describe("engineSoundParams", () => {
  it("maps rpm to the firing frequency (4-stroke: cylinders/2 pulses per revolution)", () => {
    const prof = ENGINE_PROFILES.sedan;
    const s = engineSoundParams(prof, 3000, 0.5, 0);
    expect(s.firingHz).toBeCloseTo((3000 / 60) * (prof.cylinders / 2), 9);
  });

  it("gets louder and brighter with load and rpm", () => {
    const prof = ENGINE_PROFILES.sedan;
    const lo = engineSoundParams(prof, 2000, 0, 0);
    const hi = engineSoundParams(prof, 2000, 1, 0);
    const rev = engineSoundParams(prof, 6000, 1, 0);
    expect(hi.exhaustGain).toBeGreaterThan(lo.exhaustGain);
    expect(hi.intakeGain).toBeGreaterThan(lo.intakeGain);
    expect(rev.exhaustCutoff).toBeGreaterThan(hi.exhaustCutoff);
    expect(hi.drive).toBeGreaterThan(lo.drive);
  });

  it("only whistles when there is boost", () => {
    expect(engineSoundParams(ENGINE_PROFILES.sport, 5000, 1, 0).turboGain).toBe(0);
    expect(engineSoundParams(ENGINE_PROFILES.sport, 5000, 1, 0.8).turboGain).toBeGreaterThan(0);
  });
});

describe("remote engine voices", () => {
  it("keeps only the nearest cars within earshot, up to the voice cap", () => {
    const cars = [
      { id: "a", distance: 50 },
      { id: "b", distance: 5 },
      { id: "c", distance: 300 },
      { id: "d", distance: 20 },
      { id: "e", distance: 90 },
      { id: "f", distance: 10 },
    ];
    expect(nearestVoices(cars, 4, 120).map((c) => c.id)).toEqual(["b", "f", "d", "a"]);
    expect(nearestVoices(cars, 4, 30).map((c) => c.id)).toEqual(["b", "f", "d"]);
    expect(nearestVoices([], 4, 120)).toEqual([]);
  });

  it("guesses throttle from a remote car's acceleration (they don't send pedals)", () => {
    expect(estimateThrottle(10, 10.1, DT)).toBeGreaterThan(0.9); // ~6 m/s^2
    expect(estimateThrottle(10, 9.9, DT)).toBe(0); // braking/coasting
    expect(estimateThrottle(15, 15, DT)).toBeGreaterThan(0); // cruising holds some throttle
    expect(estimateThrottle(15, 15, DT)).toBeLessThan(0.5);
    expect(estimateThrottle(0, 0, DT)).toBe(0); // parked
  });
});
