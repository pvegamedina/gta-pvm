// Which character model a player/pedestrian uses. Pure (no THREE). The
// canonical id list and the colour fallback live in the shared protocol (the
// server validates choices against them); this module adds the client-side
// selection helpers. An explicit player choice always wins over the colour.

import { CHARACTER_IDS, DEFAULT_CHARACTER, characterForColor, isCharacterId, type CharacterId } from "@shared/protocol";

export { CHARACTER_IDS, DEFAULT_CHARACTER, characterForColor };
export type { CharacterId };

/** Display names for the character picker (Spanish UI). */
export const CHARACTER_NAMES: Record<CharacterId, string> = {
  casual_hoodie: "Sudadera",
  casual_2: "Casual",
  suit: "Traje",
  worker: "Obrero",
  punk: "Punk",
  swat: "SWAT",
  beach: "Playero",
  farmer: "Granjero",
};

/** A known character id, or null (unknown strings from storage/network, wrong types). */
export function parseCharacterId(v: unknown): CharacterId | null {
  return isCharacterId(v) ? v : null;
}

/** The character `delta` steps away in the picker order, wrapping around. */
export function cycleCharacter(current: CharacterId, delta: number): CharacterId {
  const n = CHARACTER_IDS.length;
  const i = CHARACTER_IDS.indexOf(current);
  return CHARACTER_IDS[(((i + delta) % n) + n) % n];
}

/** Explicit (valid) choice first, else the deterministic colour-derived default. */
export function resolveCharacter(choice: unknown, color: number | null | undefined): CharacterId {
  return parseCharacterId(choice) ?? characterForColor(color);
}

/** Random character for local-only actors (pedestrians). */
export function randomCharacter(random: () => number = Math.random): CharacterId {
  const i = Math.min(CHARACTER_IDS.length - 1, Math.floor(random() * CHARACTER_IDS.length));
  return CHARACTER_IDS[i];
}
