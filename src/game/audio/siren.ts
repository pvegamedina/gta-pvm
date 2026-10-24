// Pure siren rules: the two-tone (hi-lo) pitch over time, distance
// attenuation and which sirens get one of the few synth voices.

/** Hi-lo tones (Hz) and the full cycle length (s) — European two-tone. */
export const SIREN_HIGH_HZ = 950;
export const SIREN_LOW_HZ = 725;
export const SIREN_PERIOD = 1.3;
/** Sirens are loud: audible much further than engines (m). */
export const SIREN_MAX_DISTANCE = 260;
/** Simultaneous siren voices (nearest first). */
export const SIREN_VOICES = 2;

export interface SirenSource {
  id: string;
  /** Distance to the listener (m; 0 = our own car) and stereo pan (-1 .. 1). */
  distance: number;
  pan: number;
}

/** Siren pitch at time `t` (s): high for the first half of the cycle, low for the second. */
export function sirenFrequency(t: number): number {
  const p = ((t % SIREN_PERIOD) + SIREN_PERIOD) % SIREN_PERIOD;
  return p < SIREN_PERIOD / 2 ? SIREN_HIGH_HZ : SIREN_LOW_HZ;
}

/** Quadratic fall-off to silence at SIREN_MAX_DISTANCE. */
export function sirenGain(distance: number): number {
  const a = Math.max(0, 1 - distance / SIREN_MAX_DISTANCE);
  return a * a;
}

/** The `count` closest audible sirens. */
export function nearestSirens<T extends SirenSource>(list: readonly T[], count: number): T[] {
  return list
    .filter((s) => s.distance < SIREN_MAX_DISTANCE)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count);
}
