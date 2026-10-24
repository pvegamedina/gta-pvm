import { describe, expect, it } from "vitest";
import { GRAPHICS_PRESETS, PRESET_ORDER, presetConfig, cameraFar } from "../graphicsPresets";

describe("graphics presets", () => {
  it("lists the four presets from cheapest to richest", () => {
    expect(PRESET_ORDER).toEqual(["low", "medium", "high", "ultra"]);
  });

  it("scales monotonically: pixel ratio, view distance, fog and shadow map never shrink going up", () => {
    for (let i = 1; i < PRESET_ORDER.length; i++) {
      const a = GRAPHICS_PRESETS[PRESET_ORDER[i - 1]];
      const b = GRAPHICS_PRESETS[PRESET_ORDER[i]];
      expect(b.pixelRatioCap).toBeGreaterThanOrEqual(a.pixelRatioCap);
      expect(b.viewScale).toBeGreaterThan(a.viewScale);
      expect(b.fogFar).toBeGreaterThan(a.fogFar);
      expect(b.shadowMapSize).toBeGreaterThanOrEqual(a.shadowMapSize);
    }
  });

  it("'high' keeps the pre-settings look (shadows 2048, pixel ratio 1.5, fog 160..1100, LOD scale 1)", () => {
    const h = presetConfig("high");
    expect(h.shadows).toBe(true);
    expect(h.shadowMapSize).toBe(2048);
    expect(h.pixelRatioCap).toBe(1.5);
    expect(h.fogNear).toBe(160);
    expect(h.fogFar).toBe(1100);
    expect(h.viewScale).toBe(1);
  });

  it("'low' has no shadows; shadow maps are powers of two otherwise", () => {
    expect(presetConfig("low").shadows).toBe(false);
    for (const k of PRESET_ORDER) {
      const p = GRAPHICS_PRESETS[k];
      if (p.shadows) expect(Math.log2(p.shadowMapSize) % 1).toBe(0);
      expect(p.shadowHalfSize).toBeGreaterThan(0);
    }
  });

  it("keeps the camera far plane beyond the fog and the sky dome", () => {
    for (const k of PRESET_ORDER) {
      const far = cameraFar(GRAPHICS_PRESETS[k]);
      expect(far).toBeGreaterThan(GRAPHICS_PRESETS[k].fogFar);
      expect(far).toBeGreaterThanOrEqual(1000);
    }
  });
});
