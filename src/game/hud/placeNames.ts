// Pure GTA-style location toasts: which street name to announce when the
// player (on foot or driving) gets onto a different named road, and which
// campus building to name when walking up to its entrance. Hysteresis keeps
// brushes with a side street or a junction from flickering the toast.

/** Seconds the player must stay on a new street before it is announced. */
export const STREET_CONFIRM = 0.7;
/** Max distance (m) outside the carriageway edge that still counts as being on the street (sidewalks). */
export const STREET_REACH = 4;
/** Distance (m) to an entrance that names the building, and the distance that re-arms it. */
export const ENTRANCE_NEAR = 9;
export const ENTRANCE_REARM = 30;

export interface PlaceTracker {
  street: string | null;
  candidate: string | null;
  candidateT: number;
  building: string | null;
}

export function createPlaceTracker(): PlaceTracker {
  return { street: null, candidate: null, candidateT: 0, building: null };
}

/**
 * `sample` is the nearest named road and how far (m) the player is outside
 * its carriageway edge (0 on it). Returns the street to announce now, or null.
 */
export function updateStreetName(t: PlaceTracker, sample: { name: string; excess: number } | null, dt: number): string | null {
  if (!sample || sample.excess > STREET_REACH) {
    // Off any street: keep the current one (no toast), drop a half-confirmed candidate.
    t.candidate = null;
    t.candidateT = 0;
    return null;
  }
  if (sample.name === t.street) {
    t.candidate = null;
    t.candidateT = 0;
    return null;
  }
  if (sample.name !== t.candidate) {
    t.candidate = sample.name;
    t.candidateT = 0;
  }
  t.candidateT += dt;
  if (t.candidateT < STREET_CONFIRM) return null;
  t.street = sample.name;
  t.candidate = null;
  t.candidateT = 0;
  return t.street;
}

/** Names the building whose entrance the player walks up to (once per visit), or null. */
export function updateBuildingName(t: PlaceTracker, entrances: readonly { name: string; x: number; z: number }[], x: number, z: number): string | null {
  let best: { name: string; d: number } | null = null;
  for (const e of entrances) {
    const d = Math.hypot(e.x - x, e.z - z);
    if (!best || d < best.d) best = { name: e.name, d };
  }
  if (!best) return null;
  if (t.building) {
    // Re-arm once the player has left the last announced building well behind.
    const last = entrances.find((e) => e.name === t.building);
    if (!last || Math.hypot(last.x - x, last.z - z) > ENTRANCE_REARM) t.building = null;
  }
  if (best.d > ENTRANCE_NEAR || best.name === t.building) return null;
  t.building = best.name;
  return best.name;
}
