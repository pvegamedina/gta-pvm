// Player settings (pause menu "Ajustes"): schema, defaults, validation and
// persistence. Stored in localStorage as versioned JSON; every read/write is
// wrapped so private mode / blocked storage / corrupt data simply fall back
// to the defaults, and loaded values are clamped field by field (one bad
// field does not discard the others). Pure apart from the injected storage.

import { PRESET_ORDER, type GraphicsPreset } from "./graphicsPresets";

export const SETTINGS_VERSION = 1;
export const SETTINGS_KEY = `gta-pvm:settings:v${SETTINGS_VERSION}`;

export interface Settings {
  version: typeof SETTINGS_VERSION;
  /** Mouse look multiplier (1 = the original feel). */
  mouseSensitivity: number;
  /** Intensity (0..1) of the camera feel: follow lag, sprint FOV, landing dip. */
  cameraMotion: number;
  /** Gain buses, 0..1. */
  masterVolume: number;
  sfxVolume: number;
  ambienceVolume: number;
  preset: GraphicsPreset;
  /** Frame-time HUD (also toggled with F3). */
  showPerf: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  mouseSensitivity: 1,
  cameraMotion: 1,
  masterVolume: 0.8,
  sfxVolume: 1,
  ambienceVolume: 0.7,
  preset: "high",
  showPerf: false,
};

/** Allowed range of each numeric field. */
export const SETTING_RANGES = {
  mouseSensitivity: [0.25, 3],
  cameraMotion: [0, 1],
  masterVolume: [0, 1],
  sfxVolume: [0, 1],
  ambienceVolume: [0, 1],
} as const;

type NumericKey = keyof typeof SETTING_RANGES;
const NUMERIC_KEYS = Object.keys(SETTING_RANGES) as NumericKey[];

function clampTo(v: number, [lo, hi]: readonly [number, number]): number {
  return Math.min(hi, Math.max(lo, v));
}

export function isPreset(v: unknown): v is GraphicsPreset {
  return typeof v === "string" && (PRESET_ORDER as readonly string[]).includes(v);
}

/** Clamps every numeric field into its range (other fields untouched). */
export function clampSettings(s: Settings): Settings {
  const out = { ...s };
  for (const k of NUMERIC_KEYS) out[k] = clampTo(s[k], SETTING_RANGES[k]);
  return out;
}

/**
 * Validates anything (a parsed object or its JSON string) into Settings:
 * a different schema version or a non-object gives the defaults; otherwise
 * each field is kept when valid (numbers clamped) and defaulted when not.
 * `fallbackPreset` is used when no valid preset is stored.
 */
export function parseSettings(raw: unknown, fallbackPreset: GraphicsPreset): Settings {
  const defaults: Settings = { ...DEFAULT_SETTINGS, preset: fallbackPreset };
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return defaults;
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return defaults;
  const o = obj as Record<string, unknown>;
  if (o.version !== SETTINGS_VERSION) return defaults;
  const out: Settings = { ...defaults };
  for (const k of NUMERIC_KEYS) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = clampTo(v, SETTING_RANGES[k]);
  }
  if (isPreset(o.preset)) out.preset = o.preset;
  if (typeof o.showPerf === "boolean") out.showPerf = o.showPerf;
  return out;
}

/** What the default-preset heuristic looks at (navigator / window values). */
export interface DeviceHints {
  devicePixelRatio?: number;
  hardwareConcurrency?: number;
}

/**
 * First-run preset from cheap device hints: "high" in general; "medium" for
 * 4-core machines or very dense (phone-like) screens; "low" for 1-2 cores.
 * Never "ultra" (the player opts into it).
 */
export function defaultPreset(h: DeviceHints): GraphicsPreset {
  const cores = h.hardwareConcurrency ?? 8;
  const dpr = h.devicePixelRatio ?? 1;
  if (cores <= 2) return "low";
  if (cores <= 4 || dpr >= 2.5) return "medium";
  return "high";
}

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadSettings(storage: SettingsStorage | null, fallbackPreset: GraphicsPreset): Settings {
  try {
    return parseSettings(storage?.getItem(SETTINGS_KEY) ?? null, fallbackPreset);
  } catch {
    // Storage access itself can throw (blocked site data).
    return { ...DEFAULT_SETTINGS, preset: fallbackPreset };
  }
}

export function saveSettings(s: Settings, storage: SettingsStorage | null): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(clampSettings(s)));
  } catch {
    // ignore: the settings just won't persist
  }
}
