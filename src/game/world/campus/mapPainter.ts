// Paints the campus map onto a 2D canvas: once as the terrain's ground
// texture (landuse colours, asphalt/paving under the road ribbons, plinths
// under the buildings — perfectly draped and z-fight free because it IS the
// terrain's texture) and once with a brighter palette as the minimap.

import type { CampusMap } from "../../map/loader";
import type { LanduseKind, MapBuilding, MapRoad, RoadClass, Vec2 } from "../../map/types";

export interface RoadStroke {
  color: string;
  /** Stroke width in metres. */
  width: number;
}

export interface MapPalette {
  base: string;
  /** Large soft colour blotches over the base (natural variation). */
  blotches?: string[];
  landuse: Partial<Record<LanduseKind, string>>;
  pitchLines?: string;
  /** Colour of running loops mapped as lines (area=no, paved jogging paths); athletics (tartan) tracks use landuse.track. */
  jogging?: string;
  road(r: MapRoad): RoadStroke | null;
  building(b: MapBuilding): string | null;
  /** Extra metres around building footprints (plinth). */
  buildingMargin: number;
  campusOutline?: string;
}

const DRIVABLE = new Set<RoadClass>([
  "motorway",
  "motorway_link",
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
  "secondary",
  "secondary_link",
  "tertiary",
  "tertiary_link",
  "residential",
  "unclassified",
  "living_street",
  "service",
]);

export function isDrivable(c: RoadClass): boolean {
  return DRIVABLE.has(c);
}

/** Draw order of road classes (minor first so main roads end up on top). */
const ROAD_RANK: Partial<Record<RoadClass, number>> = {
  service: 1,
  living_street: 1,
  residential: 2,
  unclassified: 2,
  tertiary_link: 3,
  tertiary: 3,
  secondary_link: 4,
  secondary: 4,
  primary_link: 5,
  primary: 5,
  trunk_link: 6,
  trunk: 6,
  motorway_link: 7,
  motorway: 8,
};

// Colours are albedos for the Lambert terrain: the scene's sun + sky light
// multiplies them by ~1.8 at noon, so keep them darker than they should look.
export const GROUND_PALETTE: MapPalette = {
  base: "#5d5a3e",
  blotches: ["rgba(70,90,40,0.35)", "rgba(95,80,55,0.30)", "rgba(62,78,42,0.30)"],
  landuse: {
    grass: "#42602b",
    park: "#3e5f28",
    garden: "#44672d",
    pitch: "#2e5a25",
    track: "#86412e",
    water: "#264a63",
    swimming_pool: "#2d7393",
    parking: "#37393d",
    playground: "#857659",
    industrial: "#5f5c56",
    allotments: "#4d5a2f",
    farmland: "#6b6440",
  },
  // Pitch lines are draped geometry now (landuse.ts), sharper than this 0.6 m/px painting.
  jogging: "#77716a",
  road(r) {
    if (r.bridge) return null;
    if (isDrivable(r.class)) return { color: "#333538", width: r.width + 1.2 };
    if (r.footway === "sidewalk") return null;
    return { color: "#77716a", width: r.width + 0.6 };
  },
  building: () => "#6c6962",
  buildingMargin: 1.2,
};

export const MINIMAP_PALETTE: MapPalette = {
  base: "#56664a",
  landuse: {
    grass: "#5f8a45",
    park: "#55843f",
    garden: "#5f8a45",
    pitch: "#4c9a3c",
    track: "#a8573f",
    water: "#3d7ab3",
    swimming_pool: "#4aa9e0",
    parking: "#6b6d72",
    playground: "#b8a77f",
    industrial: "#7a776f",
    allotments: "#6a7c45",
    farmland: "#8d8653",
  },
  road(r) {
    const c = r.class;
    if (c === "motorway" || c === "motorway_link" || c === "trunk" || c === "trunk_link") return { color: "#e8743b", width: Math.max(r.width * 1.1, 6) };
    if (c === "primary" || c === "primary_link") return { color: "#f2c14e", width: Math.max(r.width * 1.1, 6) };
    if (c === "secondary" || c === "secondary_link" || c === "tertiary" || c === "tertiary_link") return { color: "#f3ecd2", width: Math.max(r.width, 5) };
    if (isDrivable(c)) return { color: "#d4d4d4", width: Math.max(r.width, 4) };
    if (r.footway === "sidewalk") return null;
    return { color: "#c8b88c", width: 1.6 };
  },
  jogging: "#b59a6a",
  building: (b) => (b.category === "university" || b.category === "school" ? "#6f80d4" : b.category === "sports" ? "#9b6fd0" : "#9c9ca4"),
  buildingMargin: 0,
  campusOutline: "rgba(255,255,255,0.7)",
};

/** Deterministic pseudo random sequence for the blotches. */
function prng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/**
 * Paints `map` onto a canvas of the given pixel size covering the map's
 * terrain extent (x -> canvas x, z -> canvas y, north up).
 */
export function paintMap(map: CampusMap, palette: MapPalette, width: number, height: number): HTMLCanvasElement {
  const t = map.terrainGrid;
  const minX = t.originX;
  const minZ = t.originZ;
  const spanX = (t.width - 1) * t.cellSize;
  const spanZ = (t.height - 1) * t.cellSize;
  const sx = width / spanX;
  const sz = height / spanZ;
  const scale = (sx + sz) / 2;
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const x = c.getContext("2d")!;
  const px = (p: Vec2): [number, number] => [(p[0] - minX) * sx, (p[1] - minZ) * sz];

  x.fillStyle = palette.base;
  x.fillRect(0, 0, width, height);
  if (palette.blotches) {
    const rnd = prng(4242);
    for (let i = 0; i < 260; i++) {
      const cx = rnd() * width;
      const cy = rnd() * height;
      const r = (8 + rnd() * 40) * scale;
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, palette.blotches[i % palette.blotches.length]);
      g.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = g;
      x.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  }

  const polygon = (ring: readonly Vec2[]) => {
    x.beginPath();
    ring.forEach((p, i) => {
      const [a, b] = px(p);
      if (i === 0) x.moveTo(a, b);
      else x.lineTo(a, b);
    });
    x.closePath();
  };

  // Landuse: big areas first so small ones (pools in parks) stay visible.
  const lu = [...map.landuse].sort((a, b) => b.area - a.area);
  for (const l of lu) {
    const col = palette.landuse[l.kind];
    if (!col) continue;
    polygon(l.points);
    if (l.kind === "track") {
      // The infield is a field either way. A tartan track is an athletics ring (7 m, track colour);
      // a loop mapped as a line (area=no, e.g. the paved jogging loop in the middle of the campus)
      // is a 3.5 m path in the jogging colour, not a red ring.
      x.fillStyle = palette.landuse.grass ?? palette.base;
      x.fill();
      const athletics = !l.linear && (l.surface === undefined || l.surface === "tartan");
      x.strokeStyle = athletics ? col : (palette.jogging ?? col);
      x.lineWidth = (athletics ? 7 : 3.5) * scale;
      x.stroke();
      continue;
    }
    x.fillStyle = col;
    x.fill();
    if (l.kind === "pitch" && palette.pitchLines) {
      x.strokeStyle = palette.pitchLines;
      x.lineWidth = 0.25 * scale;
      x.stroke();
    }
  }

  // Roads: footways, then drivable roads by rank.
  const roads = map.roads
    .map((r) => ({ r, stroke: palette.road(r) }))
    .filter((e): e is { r: MapRoad; stroke: RoadStroke } => e.stroke !== null)
    .sort((a, b) => (ROAD_RANK[a.r.class] ?? 0) - (ROAD_RANK[b.r.class] ?? 0));
  x.lineCap = "round";
  x.lineJoin = "round";
  for (const { r, stroke } of roads) {
    x.beginPath();
    r.points.forEach((p, i) => {
      const [a, b] = px(p);
      if (i === 0) x.moveTo(a, b);
      else x.lineTo(a, b);
    });
    x.strokeStyle = stroke.color;
    x.lineWidth = Math.max(1, stroke.width * scale);
    x.stroke();
  }

  for (const b of map.buildings) {
    const col = palette.building(b);
    if (!col) continue;
    polygon(b.footprint);
    x.fillStyle = col;
    x.fill();
    if (palette.buildingMargin > 0) {
      x.strokeStyle = col;
      x.lineWidth = palette.buildingMargin * 2 * scale;
      x.stroke();
    }
  }

  if (palette.campusOutline && map.campus.length > 2) {
    polygon(map.campus);
    x.setLineDash([6 * scale, 4 * scale]);
    x.strokeStyle = palette.campusOutline;
    x.lineWidth = 1.6 * scale;
    x.stroke();
    x.setLineDash([]);
  }
  return c;
}
