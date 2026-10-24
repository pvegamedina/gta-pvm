// Walkable/drivable surface height: the terrain plus elevated bridge decks.
//
// The DEM (IGN MDT05) is a bare-earth model: bridges are removed and the
// embankments leading onto them are kept. So a bridge way's two ends sit on
// its embankments, and the deck is modelled as a straight line between the
// terrain heights at those ends (never closer than DECK_MIN_CLEARANCE to the
// terrain below). Roads passing underneath (OSM tunnel/layer -1) stay on the
// terrain: callers pass their current height as `yHint` so something below a
// deck is not snapped up onto it.

import type { MapRoad, Vec2 } from "../../map/types";
import { SpatialHash } from "../../map/spatialHash";
import { cumulativeLengths } from "./ribbon";

/** Minimum gap (m) between a deck and the terrain below it. */
export const DECK_MIN_CLEARANCE = 0.25;
/** Things more than this far below a deck are "underneath" it. */
const UNDER_MARGIN = 2;

export interface DeckProfile {
  /** Index of the road in the map's road list. */
  road: number;
  points: readonly Vec2[];
  cum: readonly number[];
  halfWidth: number;
  /** Deck height at arc length s along the road. */
  deckAt(s: number): number;
}

export interface Surface {
  height(x: number, z: number, yHint?: number): number;
  decks: readonly DeckProfile[];
}

interface SegRef {
  deck: number;
  seg: number;
}

export function createSurface(terrain: (x: number, z: number) => number, roads: readonly MapRoad[]): Surface {
  // Bridge ways are often split into consecutive (or branching) pieces. Solve
  // the height of every joint between pieces as the length-weighted average
  // of its neighbours (harmonic interpolation), with the free ends — where a
  // bridge meets an ordinary road on its embankment — pinned to the terrain.
  // For a simple chain this is exactly a straight line end to end.
  const key = (p: Vec2) => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;
  const bridges = roads.map((r, ri) => ({ r, ri })).filter(({ r }) => r.bridge && r.points.length >= 2);
  const nodeHeight = new Map<string, number>();
  const links = new Map<string, { other: string; len: number }[]>();
  const terrainAt = new Map<string, number>();
  for (const { r } of bridges) {
    const a = r.points[0];
    const b = r.points[r.points.length - 1];
    const ka = key(a);
    const kb = key(b);
    const len = Math.max(0.5, cumulativeLengths(r.points).at(-1) ?? 0);
    terrainAt.set(ka, terrain(a[0], a[1]));
    terrainAt.set(kb, terrain(b[0], b[1]));
    if (!links.has(ka)) links.set(ka, []);
    if (!links.has(kb)) links.set(kb, []);
    links.get(ka)!.push({ other: kb, len });
    links.get(kb)!.push({ other: ka, len });
  }
  const free = new Set([...links].filter(([, l]) => l.length === 1).map(([k]) => k));
  for (const [k, l] of links) nodeHeight.set(k, free.has(k) ? terrainAt.get(k)! : Math.max(...l.map((x) => terrainAt.get(x.other)!)));
  for (let it = 0; it < 200 && free.size > 0; it++) {
    for (const [k, l] of links) {
      if (free.has(k)) continue;
      let num = 0;
      let den = 0;
      for (const x of l) {
        num += nodeHeight.get(x.other)! / x.len;
        den += 1 / x.len;
      }
      nodeHeight.set(k, num / den);
    }
  }

  const decks: DeckProfile[] = [];
  for (const { r, ri } of bridges) {
    const points = r.points;
    const cum = cumulativeLengths(points);
    const total = cum[cum.length - 1] || 1;
    const h0 = free.size > 0 ? nodeHeight.get(key(points[0]))! : terrainAt.get(key(points[0]))!;
    const h1 = free.size > 0 ? nodeHeight.get(key(points[points.length - 1]))! : terrainAt.get(key(points[points.length - 1]))!;
    const pinned0 = free.has(key(points[0]));
    const pinned1 = free.has(key(points[points.length - 1]));
    const deckAt = (s: number) => {
      const t = Math.min(1, Math.max(0, s / total));
      let i = 1;
      while (i < cum.length - 1 && cum[i] < s) i++;
      const seg = cum[i] - cum[i - 1] || 1;
      const f = Math.min(1, Math.max(0, (s - cum[i - 1]) / seg));
      const x = points[i - 1][0] + (points[i][0] - points[i - 1][0]) * f;
      const z = points[i - 1][1] + (points[i][1] - points[i - 1][1]) * f;
      const straight = h0 + (h1 - h0) * t;
      // Where the deck meets the ordinary road it must match it exactly.
      const atRoad = (pinned0 && s < 0.5) || (pinned1 && total - s < 0.5);
      return atRoad ? straight : Math.max(straight, terrain(x, z) + DECK_MIN_CLEARANCE);
    };
    decks.push({ road: ri, points, cum, halfWidth: r.width / 2, deckAt });
  }

  const hash = new SpatialHash<SegRef>(32);
  decks.forEach((d, di) => {
    for (let s = 0; s + 1 < d.points.length; s++) {
      const [ax, az] = d.points[s];
      const [bx, bz] = d.points[s + 1];
      const m = d.halfWidth + 0.5;
      hash.insert({ deck: di, seg: s }, Math.min(ax, bx) - m, Math.min(az, bz) - m, Math.max(ax, bx) + m, Math.max(az, bz) + m);
    }
  });

  function height(x: number, z: number, yHint?: number): number {
    const g = terrain(x, z);
    if (decks.length === 0) return g;
    let best = g;
    for (const ref of hash.queryPoint(x, z)) {
      const d = decks[ref.deck];
      const [ax, az] = d.points[ref.seg];
      const [bx, bz] = d.points[ref.seg + 1];
      const ex = bx - ax;
      const ez = bz - az;
      const l2 = ex * ex + ez * ez;
      if (l2 < 1e-9) continue;
      const t = ((x - ax) * ex + (z - az) * ez) / l2;
      if (t < 0 || t > 1) continue;
      const dist = Math.hypot(x - (ax + ex * t), z - (az + ez * t));
      if (dist > d.halfWidth + 0.3) continue;
      const deck = d.deckAt(d.cum[ref.seg] + Math.sqrt(l2) * t);
      if (yHint !== undefined && yHint < deck - UNDER_MARGIN) continue;
      if (deck > best) best = deck;
    }
    return best;
  }

  return { height, decks };
}
