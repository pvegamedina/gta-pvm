import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  SETTINGS_VERSION,
  clampSettings,
  defaultPreset,
  loadSettings,
  parseSettings,
  saveSettings,
  type Settings,
} from "../settings";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

describe("parseSettings", () => {
  it("returns the defaults for garbage input", () => {
    for (const raw of [null, undefined, 42, "x", [], "{not json"]) expect(parseSettings(raw, "high")).toEqual({ ...DEFAULT_SETTINGS, preset: "high" });
  });

  it("accepts a JSON string of a valid object", () => {
    const s: Settings = { ...DEFAULT_SETTINGS, mouseSensitivity: 1.6, preset: "ultra", showPerf: true };
    expect(parseSettings(JSON.stringify(s), "high")).toEqual(s);
  });

  it("uses the fallback preset when the stored one is missing or unknown", () => {
    expect(parseSettings({ version: SETTINGS_VERSION, preset: "potato" }, "medium").preset).toBe("medium");
    expect(parseSettings({ version: SETTINGS_VERSION }, "low").preset).toBe("low");
  });

  it("keeps valid fields and defaults the rest field by field", () => {
    const s = parseSettings({ version: SETTINGS_VERSION, masterVolume: 0.3, sfxVolume: "loud", showPerf: "yes" }, "high");
    expect(s.masterVolume).toBe(0.3);
    expect(s.sfxVolume).toBe(DEFAULT_SETTINGS.sfxVolume);
    expect(s.showPerf).toBe(DEFAULT_SETTINGS.showPerf);
  });

  it("clamps out-of-range numbers instead of rejecting them", () => {
    const s = parseSettings({ version: SETTINGS_VERSION, mouseSensitivity: 99, masterVolume: -2, ambienceVolume: 7 }, "high");
    expect(s.mouseSensitivity).toBe(3);
    expect(s.masterVolume).toBe(0);
    expect(s.ambienceVolume).toBe(1);
  });

  it("drops a payload from a different schema version", () => {
    expect(parseSettings({ version: 999, masterVolume: 0.1 }, "high")).toEqual({ ...DEFAULT_SETTINGS, preset: "high" });
  });

  it("treats NaN / Infinity as invalid", () => {
    const s = parseSettings({ version: SETTINGS_VERSION, mouseSensitivity: Number.NaN, masterVolume: Infinity }, "high");
    expect(s.mouseSensitivity).toBe(DEFAULT_SETTINGS.mouseSensitivity);
    expect(s.masterVolume).toBe(DEFAULT_SETTINGS.masterVolume);
  });
});

describe("clampSettings", () => {
  it("clamps every numeric field to its range", () => {
    const s = clampSettings({ ...DEFAULT_SETTINGS, mouseSensitivity: 0.01, sfxVolume: 1.5 });
    expect(s.mouseSensitivity).toBe(0.25);
    expect(s.sfxVolume).toBe(1);
  });

  it("is idempotent on valid settings", () => {
    expect(clampSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("defaultPreset", () => {
  it("keeps 'high' as the general default", () => {
    expect(defaultPreset({ devicePixelRatio: 1, hardwareConcurrency: 8 })).toBe("high");
    expect(defaultPreset({})).toBe("high");
  });

  it("drops to medium/low on weak machines, never picks ultra", () => {
    expect(defaultPreset({ devicePixelRatio: 1, hardwareConcurrency: 4 })).toBe("medium");
    expect(defaultPreset({ devicePixelRatio: 3, hardwareConcurrency: 6 })).toBe("medium");
    expect(defaultPreset({ devicePixelRatio: 1, hardwareConcurrency: 2 })).toBe("low");
    expect(defaultPreset({ devicePixelRatio: 1, hardwareConcurrency: 64 })).toBe("high");
  });
});

describe("loadSettings / saveSettings", () => {
  it("round-trips through storage under a versioned key", () => {
    const st = memoryStorage();
    const s: Settings = { ...DEFAULT_SETTINGS, masterVolume: 0.42, preset: "low" };
    saveSettings(s, st);
    expect(st.data.has(SETTINGS_KEY)).toBe(true);
    expect(loadSettings(st, "high")).toEqual(s);
  });

  it("falls back to defaults when storage is missing or throws", () => {
    expect(loadSettings(null, "medium")).toEqual({ ...DEFAULT_SETTINGS, preset: "medium" });
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadSettings(throwing, "high")).toEqual({ ...DEFAULT_SETTINGS, preset: "high" });
    expect(() => saveSettings(DEFAULT_SETTINGS, throwing)).not.toThrow();
  });

  it("falls back to defaults on corrupt stored JSON", () => {
    expect(loadSettings(memoryStorage({ [SETTINGS_KEY]: "{oops" }), "high")).toEqual({ ...DEFAULT_SETTINGS, preset: "high" });
  });
});
