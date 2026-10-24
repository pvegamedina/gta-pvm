// Pure facade layout: which Downtown City MegaKit module goes where on a
// building footprint. Every footprint edge is split into 2 m slots (scaled a
// little so they fit exactly), one row per storey, with the module's front
// (+z in module space, origin at its bottom-front centre) turned to the
// edge's outward normal. The ground floor of the edge facing the nearest
// road gets an entrance, the last floor a cornice row, convex corners a
// post that hides the seam between the two rows, and a stable per-building
// hash picks the style family and the window rhythm. No THREE dependency:
// world/campus/facades.ts turns the placements into batched instances.
//
// Modules stand FACADE_DEPTH metres outside the footprint (their ~0.2 m deep
// back then touches the 4a extruded wall, which stays as the far LOD and
// as the shadow caster). Collisions keep using the footprint.

import type { BuildingCategory, Ring, Vec2 } from "../../map/types";
import { insetRing } from "./extrude";
import { bboxOf, pointInPolygon, polygonArea } from "../../map/geometry";

/** Distance (m) between the footprint and the modules' front plane. */
export const FACADE_DEPTH = 0.22;
/** Nominal module width (m). */
export const SLOT = 2;
/** Module height per storey in model space (m). */
export const MODULE_FLOOR = 3;
/** Edges shorter than this keep the plain extruded wall. */
export const MIN_EDGE = 1.5;
/** Share of the perimeter in short edges above which a footprint counts as curved. */
const CURVED_SHARE = 0.35;
/** Footprints with more edges than this are treated as curved / too irregular. */
const MAX_EDGES = 120;
/** Default storey height (m) when the map has no level count. */
const DEFAULT_FLOOR = 3.2;
/** Rooftop clutter module. */
export const ROOF_PROP = "Prop_ACUnit";
/** Probability that a window is lit at night. */
const LIT_SHARE = 0.45;

export type FacadeFamilyKey = "campusWhite" | "paleBrick" | "redBrick" | "glassMetal" | "sportsHall" | "house";

export interface FacadeFamily {
  ground: { window: string; plain: string; door: readonly string[] };
  upper: { window: string; plain: string };
  /** Plain module used on the last floor (trim band under the roof). */
  top?: string;
  cornice: string;
  corner: string;
  /** Window rhythms ("W" window, "P" plain), one picked per building. */
  rhythms: readonly string[];
  /** Ground-floor rhythm (shop-front windows vs wall). */
  groundRhythm: string;
  /** Tints (display RGB hex) per material slot; one of each picked per building. */
  tints: { brick: readonly number[]; trim: readonly number[]; metal: readonly number[] };
}

// Tints multiply a desaturated brick texture and the light trim / metal ones
// (see facades.ts), so whites stay white and the red family reads as brick.
export const FAMILIES: Record<FacadeFamilyKey, FacadeFamily> = {
  campusWhite: {
    ground: { window: "Trim_FirstFloor_Window_001", plain: "Trim_Plain_3", door: ["DoorFrame_Metal_Single", "Door_2"] },
    upper: { window: "Trim_FirstFloor_Window_001", plain: "Trim_Plain_3" },
    cornice: "Cornice_Metal_Center",
    corner: "Brick_Column_Small",
    rhythms: ["W", "WWP", "WP"],
    groundRhythm: "WWP",
    tints: { brick: [0xf1ede4, 0xe9e2d2], trim: [0xf4f2ec, 0xece6da, 0xf0e9d8], metal: [0xd8d8d4, 0xbfc3c6] },
  },
  paleBrick: {
    ground: { window: "Metal_FirstFloor_Window", plain: "Brick_Plain_3", door: ["DoorFrame_Metal_Single", "Door_2"] },
    upper: { window: "Brick_Window_Square_Single", plain: "Brick_Plain_3" },
    top: "Brick_TopTrim",
    cornice: "Cornice_Brick_Center",
    corner: "Brick_Column_Small",
    rhythms: ["W", "WP", "WWP"],
    groundRhythm: "WP",
    tints: { brick: [0xe8d8b8, 0xead9c0, 0xdccaa6, 0xe3d3bc], trim: [0xf2eee6], metal: [0xc9c6bf, 0xd7d3cb] },
  },
  redBrick: {
    ground: { window: "Metal_FirstFloor_Window", plain: "Brick_Plain_3", door: ["DoorFrame_Metal_Single", "Door_2"] },
    upper: { window: "Brick_Window_Square_Single", plain: "Brick_Plain_3" },
    top: "Brick_TopTrim",
    cornice: "Cornice_Brick_Center",
    corner: "Brick_Column_Small",
    rhythms: ["W", "WP"],
    groundRhythm: "WP",
    tints: { brick: [0xb8644a, 0xa85c45, 0xc07656], trim: [0xeee8dc], metal: [0xc9c6bf] },
  },
  glassMetal: {
    ground: { window: "Metal_FirstFloor_Window", plain: "Metal_Plain_3", door: ["DoorFrame_Metal_Single", "Door_2"] },
    upper: { window: "Metal_FullWindow", plain: "Metal_Plain_3" },
    cornice: "Cornice_Metal_Center",
    corner: "Brick_Column_Small",
    rhythms: ["W", "WWWP", "WWP"],
    groundRhythm: "WWP",
    tints: { brick: [0xe6e2da], trim: [0xeeeeea], metal: [0xd9dcdf, 0xc4c9cd, 0xe2ddd2] },
  },
  sportsHall: {
    ground: { window: "Metal_FirstFloor_Window", plain: "Metal_FirstFloor_Wall", door: ["DoorFrame_Metal_Single", "Door_2"] },
    upper: { window: "Metal_FullWindow", plain: "Metal_Plain_3" },
    cornice: "Cornice_Metal_Center",
    corner: "Brick_Column_Small",
    // Blank walls with a high strip of windows on the last floor (see layoutFacade).
    rhythms: ["P"],
    groundRhythm: "PPPPW",
    tints: { brick: [0xdedbd4], trim: [0xe8e6e0], metal: [0xd6dade, 0xc9d3dc, 0xe0ddd4] },
  },
  house: {
    ground: { window: "Brick_Window_Square_Single", plain: "Brick_Plain_3", door: ["DoorFrame_Metal_Single", "Door_2"] },
    upper: { window: "Brick_Window_Square_Single", plain: "Brick_Plain_3" },
    cornice: "Cornice_Brick_Center",
    corner: "Brick_Column_Small",
    rhythms: ["WP", "PW", "WPP"],
    groundRhythm: "WP",
    // Andalusian whitewash and warm render.
    tints: { brick: [0xf6f3ec, 0xf3ead6, 0xf1e2c4, 0xf7f5f0], trim: [0xf2eee6], metal: [0xcfcac0] },
  },
};

/** Weighted family choices per category. */
const CATEGORY_FAMILIES: Record<BuildingCategory, readonly [FacadeFamilyKey, number][]> = {
  university: [["campusWhite", 4], ["paleBrick", 3], ["glassMetal", 2], ["redBrick", 1]],
  school: [["paleBrick", 2], ["campusWhite", 2]],
  sports: [["sportsHall", 1]],
  retail: [["glassMetal", 3], ["campusWhite", 1]],
  industrial: [["sportsHall", 1], ["glassMetal", 1]],
  house: [["house", 1]],
  residential: [["house", 2], ["paleBrick", 1]],
  roof: [["campusWhite", 1]],
  other: [["campusWhite", 2], ["paleBrick", 2], ["glassMetal", 1]],
};

/** Stable 32-bit FNV-1a hash. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Deterministic [0, 1) from a building id and a few integers. */
function rand01(id: string, ...k: number[]): number {
  let h = hashString(id);
  for (const v of k) h = Math.imul(h ^ (v + 0x9e3779b9), 2654435761) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export function facadeFamily(category: BuildingCategory, id: string): FacadeFamilyKey {
  const opts = CATEGORY_FAMILIES[category] ?? CATEGORY_FAMILIES.other;
  const total = opts.reduce((s, [, w]) => s + w, 0);
  let r = rand01(id, 1) * total;
  for (const [k, w] of opts) {
    r -= w;
    if (r < 0) return k;
  }
  return opts[opts.length - 1][0];
}

/** 2 m slots along an edge, scaled to fit it exactly (null when the edge is too short for a module). */
export function slotEdge(length: number): { count: number; scale: number } | null {
  if (length < MIN_EDGE) return null;
  const count = Math.max(1, Math.round(length / SLOT));
  return { count, scale: length / (count * SLOT) };
}

/** Per vertex: true when the footprint (CCW from above) turns outward there. */
export function convexCorners(ring: Ring): boolean[] {
  const n = ring.length;
  return ring.map((c, i) => {
    const p = ring[(i + n - 1) % n];
    const q = ring[(i + 1) % n];
    const ax = c[0] - p[0];
    const az = c[1] - p[1];
    const bx = q[0] - c[0];
    const bz = q[1] - c[1];
    // CCW from above with z south (signedArea > 0): an outward (convex) turn has a negative a x b in x-z order.
    return ax * bz - az * bx < 0;
  });
}

/** Module yaw so its front (+z) faces the outward normal of edge a -> b (local +x then runs from a to b). */
export function moduleYaw(a: Vec2, b: Vec2): number {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const nx = -(b[1] - a[1]) / len;
  const nz = (b[0] - a[0]) / len;
  return Math.atan2(nx, nz);
}

export interface FloorPlan {
  floors: number;
  floorHeight: number;
  /** Vertical scale applied to the 3 m modules. */
  sy: number;
}

export function floorPlan(height: number, levels?: number): FloorPlan {
  const floors = Math.max(1, levels && levels > 0 ? Math.round(levels) : Math.round(height / DEFAULT_FLOOR));
  const floorHeight = height / floors;
  return { floors, floorHeight, sy: floorHeight / MODULE_FLOOR };
}

/**
 * Index of the edge facing the street: the one whose midpoint, pushed 3 m
 * outwards, is closest to a road (`roadDistance`), else the longest edge.
 */
export function frontEdge(ring: Ring, roadDistance?: (x: number, z: number) => number): number {
  // Prefer edges with room for a door bay between two others; short edges only if nothing else qualifies.
  const longest = Math.max(...ring.map((a, e) => Math.hypot(ring[(e + 1) % ring.length][0] - a[0], ring[(e + 1) % ring.length][1] - a[1])));
  const minLen = longest >= SLOT * 3 ? SLOT * 3 - 0.5 : MIN_EDGE * 2;
  let best = 0;
  let bestScore = Infinity;
  for (let e = 0, n = ring.length; e < n; e++) {
    const a = ring[e];
    const b = ring[(e + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < minLen) continue;
    const nx = -(b[1] - a[1]) / len;
    const nz = (b[0] - a[0]) / len;
    const mx = (a[0] + b[0]) / 2 + nx * 3;
    const mz = (a[1] + b[1]) / 2 + nz * 3;
    // Without roads: longest edge (negative length as the score). Ties keep the first edge.
    const score = roadDistance ? roadDistance(mx, mz) - len * 1e-3 : -len;
    if (score < bestScore - 1e-9) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

export type PlacementRole = "wall" | "door" | "doorLeaf" | "cornice" | "corner" | "roofProp";

export interface ModulePlacement {
  module: string;
  role: PlacementRole;
  /** Module origin (bottom-front centre) in world metres. */
  x: number;
  y: number;
  z: number;
  /** Rotation about +y (module +z faces outwards). */
  yaw: number;
  sx: number;
  sy: number;
  sz: number;
  /** A window module (glass lit at night when `lit`). */
  window: boolean;
  lit: boolean;
}

export interface FacadeInput {
  id: string;
  category: BuildingCategory;
  /** Footprint, CCW from above. */
  ring: Ring;
  /** Height of the ground floor (lowest terrain under the footprint) and of the roof. */
  base: number;
  top: number;
  levels?: number;
  /** Has a pitched roof: no cornice row (the eaves cover the wall top). */
  pitched?: boolean;
}

export interface FacadeOptions {
  /** Distance (m) from a point to the nearest street, for choosing the entrance side. */
  roadDistance?: (x: number, z: number) => number;
  /** Terrain height, so entrances are not buried on slopes. */
  groundAt?: (x: number, z: number) => number;
}

export interface FacadeLayout {
  family: FacadeFamilyKey;
  /** True when the footprint keeps the plain extruded walls (curved / irregular). */
  fallback: boolean;
  placements: ModulePlacement[];
  frontEdge: number;
  /** Ground point in front of the entrance (for HUD toasts), if the building got one. */
  entrance: Vec2 | null;
  /** Outward direction (game yaw) of the entrance facade. */
  entranceYaw: number;
  tints: { brick: number; trim: number; metal: number };
}

/** True for footprints that are mostly short segments (round towers, curved wings). */
export function isCurved(ring: Ring): boolean {
  if (ring.length > MAX_EDGES) return true;
  let short = 0;
  let total = 0;
  for (let e = 0, n = ring.length; e < n; e++) {
    const a = ring[e];
    const b = ring[(e + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    total += len;
    if (len < MIN_EDGE * 2) short += len;
  }
  return total <= 0 || short / total > CURVED_SHARE;
}

export function layoutFacade(b: FacadeInput, o: FacadeOptions = {}): FacadeLayout {
  const familyKey = facadeFamily(b.category, b.id);
  const fam = FAMILIES[familyKey];
  const pick = (list: readonly number[], salt: number) => list[Math.floor(rand01(b.id, salt) * list.length) % list.length];
  const tints = { brick: pick(fam.tints.brick, 2), trim: pick(fam.tints.trim, 3), metal: pick(fam.tints.metal, 4) };
  const front = frontEdge(b.ring, o.roadDistance);
  const out: FacadeLayout = { family: familyKey, fallback: false, placements: [], frontEdge: front, entrance: null, entranceYaw: 0, tints };
  const height = b.top - b.base;
  if (b.ring.length < 3 || height < 2 || isCurved(b.ring)) {
    out.fallback = true;
    return out;
  }
  const plan = floorPlan(height, b.levels);
  const rhythm = fam.rhythms[Math.floor(rand01(b.id, 5) * fam.rhythms.length) % fam.rhythms.length];
  const outer = insetRing(b.ring, -FACADE_DEPTH);
  const convex = convexCorners(b.ring);
  const n = b.ring.length;
  const P = out.placements;

  for (let e = 0; e < n; e++) {
    const a = outer[e];
    const c = outer[(e + 1) % n];
    const fa = b.ring[e];
    const fb = b.ring[(e + 1) % n];
    // Short footprint edges keep the extruded wall (the offset edge can differ in length at sharp corners).
    if (Math.hypot(fb[0] - fa[0], fb[1] - fa[1]) < MIN_EDGE) continue;
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const slots = slotEdge(len);
    if (!slots) continue;
    const yaw = moduleYaw(fa, fb);
    const ux = (c[0] - a[0]) / len;
    const uz = (c[1] - a[1]) / len;
    const sx = slots.scale;
    const doorSlot = e === front && slots.count >= 3 ? Math.floor(slots.count / 2) : -1;
    for (let s = 0; s < slots.count; s++) {
      const t = (s + 0.5) * SLOT * sx;
      const x = a[0] + ux * t;
      const z = a[1] + uz * t;
      for (let f = 0; f < plan.floors; f++) {
        const y = b.base + f * plan.floorHeight;
        const last = f === plan.floors - 1 && plan.floors > 1;
        let module: string;
        let window: boolean;
        if (f === 0) {
          if (s === doorSlot) {
            const ground = o.groundAt ? o.groundAt(x, z) : b.base;
            if (ground - b.base < 1.0) {
              P.push({ module: fam.ground.door[0], role: "door", x, y, z, yaw, sx, sy: plan.sy, sz: 1, window: false, lit: false });
              for (let k = 1; k < fam.ground.door.length; k++) {
                // Door leaf: 1 m wide, hinge side at its local x = 0, centred in the frame.
                P.push({ module: fam.ground.door[k], role: "doorLeaf", x: x + ux * 0.5 * sx, y, z: z + uz * 0.5 * sx, yaw, sx, sy: Math.min(1.25, plan.sy), sz: 1, window: false, lit: false });
              }
              out.entrance = [x + Math.sin(yaw) * 2.5, z + Math.cos(yaw) * 2.5];
              out.entranceYaw = yaw;
              continue;
            }
          }
          window = fam.groundRhythm[s % fam.groundRhythm.length] === "W";
          module = window ? fam.ground.window : fam.ground.plain;
        } else {
          // Sports halls: blank walls with a band of windows on the last floor.
          const ch = familyKey === "sportsHall" ? (last ? "W" : "P") : rhythm[s % rhythm.length];
          window = ch === "W";
          module = window ? fam.upper.window : last && fam.top ? fam.top : fam.upper.plain;
        }
        P.push({ module, role: "wall", x, y, z, yaw, sx, sy: plan.sy, sz: 1, window, lit: window && rand01(b.id, e, s, f) < LIT_SHARE });
      }
      if (!b.pitched) P.push({ module: fam.cornice, role: "cornice", x, y: b.top, z, yaw, sx, sy: 1, sz: 1, window: false, lit: false });
    }
  }

  // Corner posts over the seam where two rows meet at a convex corner.
  for (let i = 0; i < n; i++) {
    if (!convex[i]) continue;
    const p = b.ring[(i + n - 1) % n];
    const c = b.ring[i];
    const q = b.ring[(i + 1) % n];
    if (Math.hypot(c[0] - p[0], c[1] - p[1]) < MIN_EDGE || Math.hypot(q[0] - c[0], q[1] - c[1]) < MIN_EDGE) continue;
    const oc = outer[i];
    const yaw = moduleYaw(p, c);
    // Brick_Column_Small spans x +-0.125, z -0.25..0.1 (centre at z = -0.075): centre it on the seam.
    const size = FACADE_DEPTH + 0.14;
    const sz = size / 0.35;
    const x = (c[0] + oc[0]) / 2 + Math.sin(yaw) * 0.075 * sz;
    const z = (c[1] + oc[1]) / 2 + Math.cos(yaw) * 0.075 * sz;
    P.push({ module: fam.corner, role: "corner", x, y: b.base, z, yaw, sx: size / 0.25, sy: height / MODULE_FLOOR, sz, window: false, lit: false });
  }

  // Air-conditioning units on flat roofs (one per ~250 m², at most six), clear of the parapet.
  if (!b.pitched) {
    const want = Math.min(6, Math.floor(polygonArea(b.ring) / 250));
    const inner = insetRing(b.ring, 2.5);
    const bb = bboxOf(inner);
    for (let k = 0, placed = 0; placed < want && k < want * 12; k++) {
      const x = bb.minX + (bb.maxX - bb.minX) * rand01(b.id, 101, k);
      const z = bb.minZ + (bb.maxZ - bb.minZ) * rand01(b.id, 102, k);
      if (!pointInPolygon(x, z, inner) || !pointInPolygon(x, z, b.ring)) continue;
      P.push({ module: ROOF_PROP, role: "roofProp", x, y: b.top, z, yaw: Math.floor(rand01(b.id, 103, k) * 4) * (Math.PI / 2), sx: 1.4, sy: 1.4, sz: 1.4, window: false, lit: false });
      placed++;
    }
  }
  return out;
}
