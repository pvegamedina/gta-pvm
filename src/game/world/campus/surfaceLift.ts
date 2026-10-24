// Height (m) of the DRAWN walking surface above the terrain at a point: the
// road meshes (roads.ts) float their layers above the terrain — asphalt, zebra
// paint, footway paving and raised sidewalks with kerbs that dip to road level
// at crossings (dropped kerbs) — while gameplay height (`groundY`) is the bare
// terrain. Foot IK (characters/locomotionPose.ts) samples terrain + this lift
// so feet stand on the visible kerb / sidewalk / asphalt instead of sinking.
// Mirrors roads.ts' band rules from the same map data. Queries use a uniform
// grid of segment ids and allocate nothing. Pure (no THREE), unit-tested.

import type { MapRoad } from "../../map/types";
import { isDrivable } from "./mapPainter";
import { kerbDrop, polylineCrossings, type KerbDropSpan } from "./roadDetail";
import { KERB_DROP, KERB_RAMP, LIFT } from "./roadLevels";

const CELL = 8;
const KEY_OFFSET = 32768;
const key = (ix: number, iz: number) => (ix + KEY_OFFSET) * 65536 + (iz + KEY_OFFSET);

/** Segment kinds. */
const DRIVE = 0;
const CROSSING = 1;
const FOOTWAY = 2;

/** Same sidewalk rule as roads.ts: streets (not service roads, tunnels, bridges) with a generated band. */
function sidewalkWidth(r: MapRoad): number {
  if (!(r.sidewalkOffset > 0) || r.class === "service" || r.tunnel || r.bridge) return 0;
  return Math.max(1.5, 2 * (r.sidewalkOffset - r.width / 2));
}

/** Builds the `(x, z) => lift` sampler for a map's roads (0 = bare terrain). */
export function createSurfaceLift(roads: readonly MapRoad[]): (x: number, z: number) => number {
  const ax: number[] = [];
  const az: number[] = [];
  const bx: number[] = [];
  const bz: number[] = [];
  /** Arc length at the segment start (dropped-kerb profile). */
  const s0: number[] = [];
  const kind: number[] = [];
  /** Half width of the carriageway / crossing / footway band. */
  const half: number[] = [];
  /** Sidewalk band width beyond the carriageway (0 = none). */
  const side: number[] = [];
  /** Dropped kerbs of the segment's road (shared per road). */
  const drops: (KerbDropSpan[] | null)[] = [];
  const cells = new Map<number, number[]>();

  const crossings = roads.filter((r) => r.footway === "crossing");
  for (const r of roads) {
    if (r.tunnel || r.points.length < 2) continue;
    let k: number;
    let h: number;
    let sw = 0;
    let roadDrops: KerbDropSpan[] | null = null;
    if (isDrivable(r.class)) {
      k = DRIVE;
      h = r.width / 2;
      sw = sidewalkWidth(r);
      if (sw > 0) {
        const list: KerbDropSpan[] = [];
        for (const c of crossings) for (const s of polylineCrossings(r.points, c.points)) list.push({ s, half: Math.max(3, c.width) / 2 });
        roadDrops = list.length > 0 ? list : null;
      }
    } else if (r.footway === "sidewalk") {
      continue; // drawn as the generated bands of the streets instead
    } else if (r.footway === "crossing") {
      k = CROSSING;
      h = Math.max(3, r.width) / 2;
    } else {
      k = FOOTWAY;
      h = r.width / 2;
    }
    const reach = h + sw;
    let s = 0;
    for (let i = 0; i + 1 < r.points.length; i++) {
      const [x0, z0] = r.points[i];
      const [x1, z1] = r.points[i + 1];
      const id = ax.length;
      ax.push(x0);
      az.push(z0);
      bx.push(x1);
      bz.push(z1);
      s0.push(s);
      kind.push(k);
      half.push(h);
      side.push(sw);
      drops.push(roadDrops);
      s += Math.hypot(x1 - x0, z1 - z0);
      const ix0 = Math.floor((Math.min(x0, x1) - reach) / CELL);
      const ix1 = Math.floor((Math.max(x0, x1) + reach) / CELL);
      const iz0 = Math.floor((Math.min(z0, z1) - reach) / CELL);
      const iz1 = Math.floor((Math.max(z0, z1) + reach) / CELL);
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          const kk = key(ix, iz);
          let list = cells.get(kk);
          if (!list) cells.set(kk, (list = []));
          list.push(id);
        }
      }
    }
  }

  return (x, z) => {
    const list = cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return 0;
    let carriageway = false;
    let onCrossing = false;
    let onFootway = false;
    let sidewalk = -1;
    let sidewalkDepth = Infinity;
    for (let n = 0; n < list.length; n++) {
      const i = list[n];
      const dx = bx[i] - ax[i];
      const dz = bz[i] - az[i];
      const len2 = dx * dx + dz * dz;
      let t = len2 > 0 ? ((x - ax[i]) * dx + (z - az[i]) * dz) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - (ax[i] + dx * t), z - (az[i] + dz * t));
      const h = half[i];
      if (kind[i] === DRIVE) {
        if (d <= h) carriageway = true;
        else if (side[i] > 0 && d <= h + side[i] && d - h < sidewalkDepth) {
          // The street whose kerb is nearest owns the point (junction overlaps).
          sidewalkDepth = d - h;
          const dl = drops[i];
          sidewalk = LIFT.kerbTop - (dl ? kerbDrop(s0[i] + t * Math.sqrt(len2), dl, KERB_DROP, KERB_RAMP) : 0);
        }
      } else if (d <= h) {
        if (kind[i] === CROSSING) onCrossing = true;
        else onFootway = true;
      }
    }
    if (carriageway) return onCrossing ? LIFT.crossing : LIFT.road;
    if (sidewalk >= 0) return sidewalk;
    if (onCrossing) return LIFT.crossing;
    return onFootway ? LIFT.footway : 0;
  };
}
