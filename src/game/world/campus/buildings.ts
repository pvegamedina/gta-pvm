// Campus buildings from the map footprints: extruded walls with a facade
// texture that repeats once per window bay and storey (3.2 m), a flat gravel
// roof and a parapet. Colour comes from a per-building vertex tint picked by
// category (campus whites/creams/brick, warm residential tones, retail and
// industrial greys), so all walls of one facade style share ONE material.
// Geometry is merged per 200 m chunk and material (cheap draw calls, and
// gunfire raycasts can still reject far chunks by bounding sphere).
//
// Each building also becomes a polygon collider (player, peds, cars, camera)
// and part of one static trimesh for the ragdoll physics. Names and
// categories are kept in `info` (HUD toasts).
//
// Phase 4b: every footprint also gets a MegaKit facade layout
// (facadeLayout.ts, rendered by facades.ts once the kit loads; these walls
// stay behind the modules as the far LOD and shadow caster), small houses get
// gabled / hipped tile roofs instead of the flat roof + parapet, and open
// canopies (building=roof) stand on columns.

import * as THREE from "three";
import type { CampusMap } from "../../map/loader";
import type { BuildingCategory, Ring, Vec2 } from "../../map/types";
import { ensureCCW, polygonCentroid } from "../../map/geometry";
import type { CollisionGrid } from "../colliders";
import type { ShootableRegistry } from "../../combat/shootables";
import { appendArrays, emptyArrays, type RibbonArrays } from "./ribbon";
import { buildParapet, buildRoof, extrudeWalls } from "./extrude";
import { FACADE_TILES, concreteTexture, facadeTextures, roofTexture, tileRoofTexture, type FacadeStyle } from "./textures";
import { layoutFacade, type FacadeLayout } from "./facadeLayout";
import { canopyColumns, pitchedRoof, wantsPitchedRoof } from "./roofs";
import type { FacadeBuildingRef } from "./facades";

export const FLOOR_HEIGHT = 3.2;
const PARAPET_HEIGHT = 0.9;
const PARAPET_THICKNESS = 0.3;
/** Walls start this far below the lowest ground under the footprint (no gaps on slopes). */
const FOUNDATION = 0.8;
const CHUNK = 200;

interface StyleInfo {
  style: FacadeStyle;
  bay: number;
  tints: string[];
}

const STYLES: Record<BuildingCategory, StyleInfo> = {
  university: { style: "campus", bay: 3.6, tints: ["#f3f0e8", "#efe7d6", "#eadcbf", "#f5f3ee", "#d9b28c", "#c88e69"] },
  school: { style: "campus", bay: 3.6, tints: ["#f1ead8", "#e9d9b8"] },
  sports: { style: "sports", bay: 5, tints: ["#e4e2dc", "#d5dbe1", "#ece8de"] },
  retail: { style: "commercial", bay: 4.5, tints: ["#c7c8c8", "#b6bac0", "#d2cfc6"] },
  industrial: { style: "commercial", bay: 5, tints: ["#bfc0bd", "#adb1b4"] },
  house: { style: "residential", bay: 3.2, tints: ["#f2e8d2", "#eddab4", "#e7d0a7", "#f4f0e6", "#e2c49c"] },
  residential: { style: "residential", bay: 3.2, tints: ["#efe4cc", "#e9d5ae", "#f2ede2", "#dcc3a0"] },
  roof: { style: "commercial", bay: 4, tints: ["#cfcac0"] },
  other: { style: "commercial", bay: 4, tints: ["#ddd8cc", "#d0cbbf", "#c9c6bf"] },
};

export interface BuildingInfo {
  name?: string;
  category: BuildingCategory;
  centroid: Vec2;
  base: number;
  top: number;
  /** Ground point in front of the main entrance (facade layout), when it has one. */
  entrance: Vec2 | null;
  /** Outward direction (game yaw) of the entrance facade. */
  entranceYaw: number;
}

export interface BuildingOptions {
  /** Terrain height (entrances on slopes, canopy columns). */
  terrainHeight: (x: number, z: number) => number;
  /** Distance to the nearest street / footway (entrance side). */
  roadDistance?: (x: number, z: number) => number;
}

/** Canopy column radius (m) and spacing. */
const COLUMN_RADIUS = 0.18;
const COLUMN_SPACING = 6;

export interface BuildingsBuild {
  group: THREE.Group;
  info: BuildingInfo[];
  /** Walls + roofs as one triangle soup for the ragdoll physics. */
  trimesh: { vertices: Float32Array; indices: Uint32Array };
  /** Facade materials whose emissive (lit windows) the environment drives at night. */
  facadeMaterials: THREE.MeshLambertMaterial[];
  /** MegaKit facade layouts (non-fallback footprints) for facades.ts. */
  facades: FacadeBuildingRef[];
  stats: { vertices: number; triangles: number; meshes: number; pitchedRoofs: number; canopyColumns: number };
}

/** Stable small hash of a string (tint choice per building). */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Removes consecutive duplicate points (and a repeated closing point). */
function cleanRing(ring: Ring): Ring {
  const out: Vec2[] = [];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05) out.push(p);
  }
  if (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 0.05) out.pop();
  return out;
}

type Layer = FacadeStyle | "roof" | "trim" | "tiles";

interface ChunkLayer {
  arrays: RibbonArrays;
  colors: number[];
}

function pushColor(dst: ChunkLayer, count: number, c: THREE.Color): void {
  for (let i = 0; i < count; i++) dst.colors.push(c.r, c.g, c.b);
}

export function buildBuildings(map: CampusMap, grid: CollisionGrid, shootables: ShootableRegistry, anisotropy: number, opts: BuildingOptions): BuildingsBuild {
  const chunks = new Map<string, Map<Layer, ChunkLayer>>();
  const info: BuildingInfo[] = [];
  const physPos: number[] = [];
  const physIdx: number[] = [];
  const tint = new THREE.Color();
  const white = new THREE.Color(1, 1, 1);
  const facades: FacadeBuildingRef[] = [];
  const columns: { x: number; z: number; y0: number; y1: number }[] = [];
  let pitchedRoofs = 0;

  const layerOf = (key: string, layer: Layer): ChunkLayer => {
    let c = chunks.get(key);
    if (!c) chunks.set(key, (c = new Map()));
    let l = c.get(layer);
    if (!l) c.set(layer, (l = { arrays: emptyArrays(), colors: [] }));
    return l;
  };
  const addTo = (key: string, layer: Layer, a: RibbonArrays, color: THREE.Color, physics: boolean) => {
    const l = layerOf(key, layer);
    appendArrays(l.arrays, a);
    pushColor(l, a.positions.length / 3, color);
    if (physics) {
      const base = physPos.length / 3;
      for (const v of a.positions) physPos.push(v);
      for (const i of a.indices) physIdx.push(i + base);
    }
  };

  for (const b of map.buildings) {
    const ring = ensureCCW(cleanRing(b.footprint));
    if (ring.length < 3) continue;
    const st = STYLES[b.category] ?? STYLES.other;
    tint.set(st.tints[hashString(b.id) % st.tints.length]);
    const [cx, cz] = polygonCentroid(ring);
    const key = `${Math.floor(cx / CHUNK)},${Math.floor(cz / CHUNK)}`;
    const top = b.baseMin + b.height;
    const entry: BuildingInfo = { name: b.name, category: b.category, centroid: [cx, cz], base: b.baseMin, top, entrance: null, entranceYaw: 0 };
    info.push(entry);

    if (b.category === "roof") {
      // Canopy: a thin slab on top, open underneath (walk under it), held up by columns.
      const slab = extrudeWalls(ring, top - 0.35, top, { bayWidth: 2, floorHeight: 2, vBase: 0 });
      addTo(key, "trim", slab, tint, true);
      addTo(key, "trim", buildRoof(ring, top), tint, true);
      const under = buildRoof([...ring].reverse(), top - 0.35);
      addTo(key, "trim", under, tint, false);
      for (const [x, z] of canopyColumns(ring, COLUMN_SPACING, 0.45)) {
        const y0 = opts.terrainHeight(x, z) - 0.2;
        if (top - 0.35 - y0 < 1.2) continue;
        columns.push({ x, z, y0, y1: top - 0.35 });
        grid.addCirc(x, z, COLUMN_RADIUS + 0.05, y0, top - 0.35 - y0);
      }
      continue;
    }

    const pitched = wantsPitchedRoof(b.category, ring, b.height) ? pitchedRoof(ring, top, { pitch: 0.55, overhang: 0.35 }) : null;
    const layout: FacadeLayout = layoutFacade(
      { id: b.id, category: b.category, ring, base: b.baseMin, top, levels: b.levels, pitched: pitched !== null },
      { roadDistance: opts.roadDistance, groundAt: opts.terrainHeight },
    );
    entry.entrance = layout.entrance;
    entry.entranceYaw = layout.entranceYaw;
    if (!layout.fallback) {
      let r = 0;
      for (const [x, z] of ring) r = Math.max(r, Math.hypot(x - cx, z - cz));
      facades.push({ layout, cx, cz, r, base: b.baseMin, top: top + 1 });
    }

    const floorH = b.levels && b.levels > 0 ? Math.max(2.6, Math.min(4.5, b.height / b.levels)) : FLOOR_HEIGHT;
    const walls = extrudeWalls(ring, b.baseMin - FOUNDATION, top, {
      bayWidth: st.bay * FACADE_TILES,
      floorHeight: floorH * FACADE_TILES,
      vBase: b.baseMin,
    });
    addTo(key, st.style, walls, tint, true);
    if (pitched) {
      pitchedRoofs++;
      addTo(key, "tiles", pitched.roof, white, true);
      // Gable ends share the concrete "trim" texture (darker than the facade): lift them to the wall colour.
      addTo(key, "trim", pitched.gables, tint.clone().multiplyScalar(1.55), true);
      grid.addPolygon(ring, b.baseMin - FOUNDATION, top + pitched.ridgeHeight);
      continue;
    }
    addTo(key, "roof", buildRoof(ring, top), white, true);
    const trim = tint.clone().multiplyScalar(0.88);
    addTo(key, "trim", buildParapet(ring, top, PARAPET_HEIGHT, PARAPET_THICKNESS), trim, false);
    grid.addPolygon(ring, b.baseMin - FOUNDATION, top + PARAPET_HEIGHT);
  }

  // Materials: one per facade style + roof + trim.
  const facadeMaterials: THREE.MeshLambertMaterial[] = [];
  const mats = new Map<Layer, THREE.MeshLambertMaterial>();
  for (const style of ["campus", "residential", "commercial", "sports"] as FacadeStyle[]) {
    const t = facadeTextures(style, anisotropy);
    const m = new THREE.MeshLambertMaterial({ map: t.map, vertexColors: true, emissive: 0xffffff, emissiveMap: t.emissive, emissiveIntensity: 0 });
    mats.set(style, m);
    facadeMaterials.push(m);
  }
  const roofTex = roofTexture(anisotropy);
  mats.set("roof", new THREE.MeshLambertMaterial({ map: roofTex, vertexColors: true }));
  mats.set("trim", new THREE.MeshLambertMaterial({ map: concreteTexture(anisotropy), vertexColors: true }));
  mats.set("tiles", new THREE.MeshLambertMaterial({ map: tileRoofTexture(anisotropy), vertexColors: true }));

  const group = new THREE.Group();
  group.name = "buildings";
  let vertices = 0;
  let triangles = 0;
  for (const [key, layers] of chunks) {
    for (const [layer, l] of layers) {
      const a = l.arrays;
      if (a.indices.length === 0) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(a.positions, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(a.normals, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(a.uvs, 2));
      g.setAttribute("color", new THREE.Float32BufferAttribute(l.colors, 3));
      g.setIndex(new THREE.Uint32BufferAttribute(a.indices, 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mats.get(layer)!);
      m.castShadow = true;
      m.receiveShadow = true;
      m.name = `buildings:${key}:${layer}`;
      group.add(m);
      shootables.add(m, { kind: "building", refId: key });
      vertices += a.positions.length / 3;
      triangles += a.indices.length / 3;
    }
  }
  // Canopy columns: one instanced cylinder mesh for the whole campus.
  if (columns.length > 0) {
    const geo = new THREE.CylinderGeometry(COLUMN_RADIUS, COLUMN_RADIUS, 1, 10).translate(0, 0.5, 0);
    // The trim material uses vertex colours: give the cylinder a light grey colour attribute.
    geo.setAttribute("color", new THREE.Float32BufferAttribute(new Array(geo.attributes.position.count * 3).fill(0.92), 3));
    const mesh = new THREE.InstancedMesh(geo, mats.get("trim")!, columns.length);
    const m4 = new THREE.Matrix4();
    columns.forEach((c, i) => mesh.setMatrixAt(i, m4.makeScale(1, c.y1 - c.y0, 1).setPosition(c.x, c.y0, c.z)));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = "buildings:canopyColumns";
    group.add(mesh);
  }
  return {
    group,
    info,
    trimesh: { vertices: new Float32Array(physPos), indices: new Uint32Array(physIdx) },
    facadeMaterials,
    facades,
    stats: { vertices, triangles, meshes: group.children.length, pitchedRoofs, canopyColumns: columns.length },
  };
}

