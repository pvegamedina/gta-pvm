import { describe, it, expect } from "vitest";
import { RecoilSpring, CameraRecoil, WEAPON_FEEL, spreadToCrosshairGap, shouldTrace, TRACER_EVERY } from "../recoil";

function run(spring: RecoilSpring, seconds: number, fps: number): number[] {
  const out: number[] = [];
  const dt = 1 / fps;
  const steps = Math.round(seconds * fps);
  for (let i = 0; i < steps; i++) {
    spring.update(dt);
    out.push(spring.value);
  }
  return out;
}

describe("RecoilSpring", () => {
  it("snaps out quickly after a kick and recovers to rest within ~150 ms", () => {
    const s = new RecoilSpring(32);
    s.kick(1);
    const trace = run(s, 0.25, 240);
    const peakIdx = trace.indexOf(Math.max(...trace));
    expect(peakIdx / 240).toBeLessThan(0.05); // peak within 50 ms
    expect(Math.max(...trace)).toBeGreaterThan(0.2);
    expect(Math.abs(trace[Math.round(0.15 * 240)])).toBeLessThan(0.25 * Math.max(...trace));
    expect(Math.abs(trace[trace.length - 1])).toBeLessThan(0.02);
  });

  it("does not overshoot below rest (critically damped)", () => {
    const s = new RecoilSpring(32);
    s.kick(1);
    expect(Math.min(...run(s, 0.5, 240))).toBeGreaterThan(-1e-3);
  });

  it("is framerate independent", () => {
    const a = new RecoilSpring(32);
    const b = new RecoilSpring(32);
    a.kick(1);
    b.kick(1);
    const ta = run(a, 0.1, 30);
    const tb = run(b, 0.1, 240);
    expect(ta[ta.length - 1]).toBeCloseTo(tb[tb.length - 1], 1);
  });
});

describe("CameraRecoil", () => {
  it("kicks the view up (positive pitch) on each shot and recovers", () => {
    const r = new CameraRecoil();
    r.fire("pistol", () => 0.5);
    for (let i = 0; i < 3; i++) r.update(1 / 60);
    expect(r.pitch).toBeGreaterThan(0);
    for (let i = 0; i < 120; i++) r.update(1 / 60);
    expect(r.pitch).toBeLessThan(0.002);
  });

  it("kicks the pistol harder than a single rifle round", () => {
    const p = new CameraRecoil();
    const m = new CameraRecoil();
    p.fire("pistol", () => 0.5);
    m.fire("m4", () => 0.5);
    let pm = 0;
    let mm = 0;
    for (let i = 0; i < 10; i++) {
      p.update(1 / 60);
      m.update(1 / 60);
      pm = Math.max(pm, p.pitch);
      mm = Math.max(mm, m.pitch);
    }
    expect(pm).toBeGreaterThan(mm);
    expect(WEAPON_FEEL.pistol.gunKick).toBeGreaterThan(WEAPON_FEEL.m4.gunKick);
  });

  it("climbs a little under sustained rifle fire, then settles back", () => {
    const r = new CameraRecoil();
    let single = 0;
    r.fire("m4", () => 0.5);
    for (let i = 0; i < 6; i++) {
      r.update(1 / 60);
      single = Math.max(single, r.pitch);
    }
    const burst = new CameraRecoil();
    let peak = 0;
    for (let shot = 0; shot < 15; shot++) {
      burst.fire("m4", () => 0.5);
      for (let i = 0; i < 6; i++) {
        burst.update(1 / 60);
        peak = Math.max(peak, burst.pitch);
      }
    }
    expect(peak).toBeGreaterThan(single * 1.5);
    for (let i = 0; i < 240; i++) burst.update(1 / 60);
    expect(burst.pitch).toBeLessThan(0.003);
  });

  it("punches the FOV briefly", () => {
    const r = new CameraRecoil();
    r.fire("pistol", () => 0.5);
    r.update(1 / 60);
    expect(r.fov).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) r.update(1 / 60);
    expect(Math.abs(r.fov)).toBeLessThan(0.05);
  });
});

describe("spreadToCrosshairGap", () => {
  it("never goes below the minimum gap", () => {
    expect(spreadToCrosshairGap(0, 65, 720)).toBeGreaterThanOrEqual(4);
  });

  it("maps angular spread to the on-screen radius of the shot cone", () => {
    // spread 0.1 => +-0.05 rad; at a 60° vertical FOV on 1000 px: tan(0.05)/tan(30°)*500 ≈ 43 px
    expect(spreadToCrosshairGap(0.1, 60, 1000)).toBeCloseTo(43.3, 0);
  });

  it("grows with spread and shrinks when zooming in (smaller FOV)", () => {
    expect(spreadToCrosshairGap(0.08, 65, 720)).toBeGreaterThan(spreadToCrosshairGap(0.04, 65, 720));
    expect(spreadToCrosshairGap(0.08, 50, 720)).toBeGreaterThan(spreadToCrosshairGap(0.08, 65, 720));
  });
});

describe("shouldTrace (tracer cadence)", () => {
  it("draws every pistol round", () => {
    expect([0, 1, 2, 3].map((n) => shouldTrace(n, "pistol"))).toEqual([true, true, true, true]);
  });

  it("draws the first rifle round and then every Nth", () => {
    const n = TRACER_EVERY.m4;
    expect(n).toBeGreaterThanOrEqual(2);
    const seq = Array.from({ length: n * 2 }, (_, i) => shouldTrace(i, "m4"));
    expect(seq.filter(Boolean)).toHaveLength(2);
    expect(seq[0]).toBe(true);
  });
});
