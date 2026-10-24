// Graphics presets (pause menu "Gráficos"): what each quality level means for
// the renderer (shadows, pixel ratio), the sun's shadow frustum and the draw
// distances (fog, camera far plane and the LOD scale applied to every
// distance-banded system: facades, props, vegetation). Pure data, tested.

export type GraphicsPreset = "low" | "medium" | "high" | "ultra";

export const PRESET_ORDER: readonly GraphicsPreset[] = ["low", "medium", "high", "ultra"];

/** Player-facing names (Spanish UI). */
export const PRESET_LABELS: Record<GraphicsPreset, string> = { low: "Bajo", medium: "Medio", high: "Alto", ultra: "Ultra" };

export interface GraphicsConfig {
  shadows: boolean;
  /** Sun shadow map resolution (texels per side). */
  shadowMapSize: number;
  /** Half extent (m) of the sun's orthographic shadow frustum around the player. */
  shadowHalfSize: number;
  /** Cap on the renderer pixel ratio (min with devicePixelRatio). */
  pixelRatioCap: number;
  /** Multiplies every LOD/draw distance (facades, props, trees, scatter, vehicles). */
  viewScale: number;
  /** Linear fog start / end (m). */
  fogNear: number;
  fogFar: number;
}

export const GRAPHICS_PRESETS: Record<GraphicsPreset, GraphicsConfig> = {
  low: { shadows: false, shadowMapSize: 1024, shadowHalfSize: 40, pixelRatioCap: 1, viewScale: 0.6, fogNear: 90, fogFar: 620 },
  medium: { shadows: true, shadowMapSize: 1024, shadowHalfSize: 50, pixelRatioCap: 1.25, viewScale: 0.8, fogNear: 120, fogFar: 850 },
  // "high" is the look the game had before presets existed.
  high: { shadows: true, shadowMapSize: 2048, shadowHalfSize: 70, pixelRatioCap: 1.5, viewScale: 1, fogNear: 160, fogFar: 1100 },
  ultra: { shadows: true, shadowMapSize: 4096, shadowHalfSize: 95, pixelRatioCap: 2, viewScale: 1.35, fogNear: 220, fogFar: 1500 },
};

export function presetConfig(p: GraphicsPreset): GraphicsConfig {
  return GRAPHICS_PRESETS[p];
}

/** Sky dome radius (world/environment.ts): the far plane must always contain it. */
const SKY_DOME_REACH = 1000;

/** Camera far plane for a preset: past the fog end (fully fogged beyond) and the sky dome. */
export function cameraFar(c: GraphicsConfig): number {
  return Math.max(SKY_DOME_REACH, Math.round(c.fogFar * 1.15));
}
