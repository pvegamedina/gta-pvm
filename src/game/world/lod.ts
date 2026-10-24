// Global draw-distance scale (graphics preset "viewScale") read by every
// distance-banded system — facades, street props, trees/proxies, vegetation
// chunks, vehicles — plus the hysteresis rule that keeps LOD switches from
// flickering when the camera hovers at a threshold. Pure, tested.

let scale = 1;
let version = 0;

/** Current LOD distance multiplier (1 = the "Alto" preset). */
export function getViewScale(): number {
  return scale;
}

/** Bumped on every change so cached LOD selections know to refresh. */
export function viewScaleVersion(): number {
  return version;
}

export function setViewScale(s: number): void {
  if (!Number.isFinite(s) || s <= 0) return;
  if (s === scale) return;
  scale = s;
  version++;
}

/**
 * Visibility with hysteresis: something hidden appears once `dist` < `view`;
 * something shown only disappears once `dist` > `view + hysteresis`.
 */
export function bandVisible(shown: boolean, dist: number, view: number, hysteresis: number): boolean {
  return shown ? dist <= view + hysteresis : dist < view;
}
