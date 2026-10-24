import { describe, expect, it } from "vitest";
import { LoadProgress } from "../loadProgress";

const stages = [
  { id: "map", label: "Cargando mapa…", weight: 2 },
  { id: "vehicles", label: "Cargando vehículos…", weight: 1 },
  { id: "world", label: "Construyendo el campus…", weight: 1 },
] as const;

describe("LoadProgress", () => {
  it("starts at 0 with the first stage's label", () => {
    const p = new LoadProgress(stages);
    expect(p.value()).toBe(0);
    expect(p.label()).toBe("Cargando mapa…");
    expect(p.finished()).toBe(false);
  });

  it("weights partial progress", () => {
    const p = new LoadProgress(stages);
    p.progress("map", 0.5);
    expect(p.value()).toBeCloseTo(0.25);
    p.done("map");
    expect(p.value()).toBeCloseTo(0.5);
    expect(p.label()).toBe("Cargando vehículos…");
  });

  it("reaches exactly 1 when every stage is done or failed", () => {
    const p = new LoadProgress(stages);
    p.done("map");
    p.fail("vehicles");
    p.done("world");
    expect(p.value()).toBe(1);
    expect(p.finished()).toBe(true);
    expect(p.failed()).toEqual(["vehicles"]);
  });

  it("never goes backwards", () => {
    const p = new LoadProgress(stages);
    p.progress("map", 0.8);
    const v = p.value();
    p.progress("map", 0.3);
    expect(p.value()).toBe(v);
    p.done("map");
    p.progress("map", 0.1);
    expect(p.value()).toBeCloseTo(0.5);
  });

  it("clamps partial values and ignores unknown stages / NaN", () => {
    const p = new LoadProgress(stages);
    p.progress("map", 7);
    expect(p.value()).toBeLessThan(0.5 + 1e-9);
    p.progress("nope", 1);
    p.progress("vehicles", Number.NaN);
    expect(p.value()).toBeCloseTo(0.5 * 0.99, 5);
  });

  it("partial progress alone never reports 'finished' (only done/fail do)", () => {
    const p = new LoadProgress(stages);
    for (const s of stages) p.progress(s.id, 1);
    expect(p.finished()).toBe(false);
    expect(p.value()).toBeLessThan(1);
  });

  it("labels the first unfinished stage even when later ones finish first", () => {
    const p = new LoadProgress(stages);
    p.done("world");
    p.done("vehicles");
    expect(p.label()).toBe("Cargando mapa…");
  });

  it("tracks a promise: resolve -> done, reject -> failed, without throwing", async () => {
    const p = new LoadProgress(stages);
    const a = await p.track("map", Promise.resolve(5));
    expect(a).toBe(5);
    await expect(p.track("vehicles", Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(p.failed()).toEqual(["vehicles"]);
    expect(p.value()).toBeCloseTo(0.75);
  });

  it("notifies listeners on change", () => {
    const p = new LoadProgress(stages);
    const seen: number[] = [];
    p.onChange((v) => seen.push(v));
    p.progress("map", 0.5);
    p.done("map");
    expect(seen.length).toBe(2);
    expect(seen[1]).toBeCloseTo(0.5);
  });
});
