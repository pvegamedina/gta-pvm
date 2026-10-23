// Which character model a player/pedestrian uses. Pure (no THREE) so every
// client derives the same model for the same server-assigned player color.

/** Character GLBs under public/models/characters/. Order matters: it defines
 * the color -> character mapping, so append new ids at the end. */
export const CHARACTER_IDS = ["casual_hoodie", "casual_2", "suit", "worker", "punk", "swat", "beach", "farmer"] as const;

export type CharacterId = (typeof CHARACTER_IDS)[number];

/** Used offline and before the server's `welcome` tells us our color. */
export const DEFAULT_CHARACTER: CharacterId = "casual_hoodie";

/** Deterministic character for a player's server-assigned color (`color % N`). */
export function characterForColor(color: number | null | undefined): CharacterId {
  if (color == null || !Number.isFinite(color)) return DEFAULT_CHARACTER;
  const i = Math.abs(Math.trunc(color)) % CHARACTER_IDS.length;
  return CHARACTER_IDS[i];
}

/** Random character for local-only actors (pedestrians). */
export function randomCharacter(random: () => number = Math.random): CharacterId {
  const i = Math.min(CHARACTER_IDS.length - 1, Math.floor(random() * CHARACTER_IDS.length));
  return CHARACTER_IDS[i];
}
