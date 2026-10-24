// Vegetation: the map's 766 trees (palms, pines, broadleaf trees, bushes) and
// a cheap scatter of grass tufts, plants, flowers and rocks over parks and
// lawns, all instanced from the Quaternius Ultimate Nature models (CC0).
//
// Two variants per species (random yaw/scale add the variety) keep the draw
// calls down. Every model's sub-meshes are merged into ONE vertex-coloured
// geometry (they only use flat colours) and all vegetation shares one
// material.
//
// Trees (phase 4b LOD): each variant is two distance-banded InstancedMeshes
// for the whole campus: the full model within TREE_LOD of the camera (with
// shadows) and a ~40-triangle proxy (trunk + cone / crown in the model's own
// colours) from there to TREE_VIEW, so the ~2k-triangle trees only cost
// their full price up close. Bushes and lawn scatter keep 100-260 m chunks
// hidden beyond their (short) draw distance.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { CampusMap } from "../../map/loader";
import type { MapLanduse, TreeSpecies } from "../../map/types";
import { bboxOf, pointInPolygon } from "../../map/geometry";
import { createRoadIndex, nearestRoadPoint } from "../../map/queries";
import { MODELS_URL, createGltfLoader, displayColor } from "../../assets/gltf";
import type { CollisionGrid } from "../colliders";
import { DistanceInstances } from "../distanceInstances";
import { getViewScale } from "../lod";

const NATURE_URL = `${MODELS_URL}/nature`;

/** Model variants per species, with the target height range (m) they are scaled to. */
/**
 * Model variants per species, the target height range (m) they are scaled to
 * and `slim`: horizontal scale relative to the vertical one, so the stubby
 * low-poly trees get real-world proportions (canopies above head height).
 */
const SPECIES: Record<TreeSpecies, { models: string[]; height: [number, number]; slim: number; trunk: number; shadow: boolean }> = {
  palm: { models: ["palmtree_1", "palmtree_3"], height: [8, 12], slim: 0.85, trunk: 0.3, shadow: true },
  pine: { models: ["pinetree_2", "pinetree_3"], height: [10, 14], slim: 0.75, trunk: 0.35, shadow: true },
  common: { models: ["commontree_1", "commontree_3"], height: [8, 11], slim: 0.7, trunk: 0.3, shadow: true },
  bush: { models: ["bush_1", "bushberries_1"], height: [1.1, 1.8], slim: 1, trunk: 0, shadow: false },
};

/** Scatter models and their height range; `weight` sets how often each appears. */
const SCATTER: { model: string; height: [number, number]; weight: number }[] = [
  { model: "grass_2", height: [0.5, 0.9], weight: 5 },
  { model: "grass_short", height: [0.25, 0.4], weight: 4 },
  { model: "flowers", height: [0.5, 0.8], weight: 2 },
  { model: "rock_2", height: [0.3, 0.6], weight: 0.6 },
];

/** Landuse kinds that get scatter, and the mean area (m²) per scattered item. */
const SCATTER_DENSITY: Partial<Record<MapLanduse["kind"], number>> = { park: 45, grass: 60, garden: 35, allotments: 50 };
const SCATTER_MAX = 2400;
/** Instancing chunk sizes (m): trees / scatter. */
const TREE_CHUNK = 260;
const SCATTER_CHUNK = 100;
/** Chunks farther than this from the player (m) are hidden: trees, bushes, scatter. */
export const TREE_VIEW = 520;
/** Trees closer than this (m) use the full model, farther ones the low-poly proxy. */
export const TREE_LOD = 150;
const BUSH_VIEW = 260;
const SCATTER_VIEW = 120;

export interface NatureModel {
  geometry: THREE.BufferGeometry;
  /** Model-space height (m) before scaling. */
  height: number;
}

export type NatureAssets = Map<string, NatureModel>;

/** Every model the campus uses. */
export function natureModelNames(): string[] {
  const names = new Set<string>();
  for (const s of Object.values(SPECIES)) for (const m of s.models) names.add(m);
  for (const s of SCATTER) names.add(s.model);
  return [...names];
}

/** Loads and merges the nature models (sub-meshes -> one vertex-coloured geometry each). */
export async function loadNatureAssets(): Promise<NatureAssets> {
  const loader = createGltfLoader();
  const out: NatureAssets = new Map();
  await Promise.all(
    natureModelNames().map(async (name) => {
      const gltf = await loader.loadAsync(`${NATURE_URL}/${name}.glb`);
      gltf.scene.updateMatrixWorld(true);
      const parts: THREE.BufferGeometry[] = [];
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        const col = displayColor(mat);
        let g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
        if (g.index) g = g.toNonIndexed();
        for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k);
        if (!g.attributes.normal) g.computeVertexNormals();
        const n = g.attributes.position.count;
        const colors = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          colors[i * 3] = col.r;
          colors[i * 3 + 1] = col.g;
          colors[i * 3 + 2] = col.b;
        }
        g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        parts.push(g);
        (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => m.dispose());
      });
      const merged = mergeGeometries(parts, false);
      if (!merged) return;
      merged.computeBoundingBox();
      const bb = merged.boundingBox!;
      // Stand the model on y = 0.
      merged.translate(0, -bb.min.y, 0);
      out.set(name, { geometry: merged, height: bb.max.y - bb.min.y });
    }),
  );
  return out;
}

/** Deterministic [0, 1) hash of a position + salt (stable across clients/reloads). */
export function hash01(x: number, z: number, salt: number): number {
  const h = Math.sin(x * 12.9898 + z * 78.233 + salt * 37.719) * 43758.5453;
  return h - Math.floor(h);
}

export interface NatureBuild {
  group: THREE.Group;
  /** Tree variants: full model near, proxy far. */
  lods: { near: DistanceInstances; far: DistanceInstances; trisNear: number; trisFar: number }[];
  stats: { trees: number; scatter: number; meshes: number; triangles: number; treeTrianglesNear: number; treeTrianglesFar: number };
}

/** Mean vertex colour of the part of a (vertex-coloured, y-up, standing) geometry selected by `pick`. */
function meanColor(g: THREE.BufferGeometry, pick: (x: number, y: number, z: number) => boolean, fallback: number): THREE.Color {
  const p = g.attributes.position;
  const c = g.attributes.color;
  let r = 0;
  let gr = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < p.count; i++) {
    if (!pick(p.getX(i), p.getY(i), p.getZ(i))) continue;
    r += c.getX(i);
    gr += c.getY(i);
    b += c.getZ(i);
    n++;
  }
  return n > 0 ? new THREE.Color(r / n, gr / n, b / n) : new THREE.Color(fallback);
}

function paint(g: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (k !== "position" && k !== "normal") out.deleteAttribute(k);
  const n = out.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  out.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return out;
}

/**
 * Low-poly stand-in for a tree model, in the model's own units (same
 * instance matrices): a trunk plus a cone (pines), a flat crown (palms) or a
 * round crown (broadleaf), coloured with the model's mean canopy / trunk colours.
 */
export function treeProxy(model: NatureModel, species: TreeSpecies): THREE.BufferGeometry {
  const g = model.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  const bb = g.boundingBox!;
  const h = bb.max.y - bb.min.y;
  const half = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2;
  const canopy = meanColor(g, (_x, y) => y > h * 0.5, 0x4b7a2e);
  const trunk = meanColor(g, (x, y, z) => y < h * 0.3 && Math.hypot(x, z) < half * 0.25, 0x6b4a2f);
  const parts: THREE.BufferGeometry[] = [];
  if (species === "pine") {
    parts.push(paint(new THREE.CylinderGeometry(h * 0.03, h * 0.04, h * 0.3, 5).translate(0, h * 0.15, 0), trunk));
    parts.push(paint(new THREE.ConeGeometry(half * 0.95, h * 0.82, 7).translate(0, h * 0.18 + h * 0.41, 0), canopy));
  } else if (species === "palm") {
    parts.push(paint(new THREE.CylinderGeometry(h * 0.025, h * 0.035, h * 0.85, 5).translate(0, h * 0.425, 0), trunk));
    parts.push(paint(new THREE.IcosahedronGeometry(half * 0.85, 0).scale(1, 0.3, 1).translate(0, h * 0.86, 0), canopy));
  } else {
    parts.push(paint(new THREE.CylinderGeometry(h * 0.035, h * 0.05, h * 0.5, 5).translate(0, h * 0.25, 0), trunk));
    const r = half * 0.9;
    parts.push(paint(new THREE.IcosahedronGeometry(r, 0).scale(1, Math.min(1.2, (h * 0.42) / r), 1).translate(0, h * 0.62, 0), canopy));
  }
  return mergeGeometries(parts, false)!;
}

interface Instance {
  model: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  /** Horizontal / vertical scale ratio. */
  slim: number;
  shadow: boolean;
  /** Draw distance of this kind of plant. */
  view: number;
  chunk: number;
  /** Tree species (null for lawn scatter). */
  species: TreeSpecies | null;
}

/**
 * Hides vegetation chunks beyond their draw distance from (x, z) — trees
 * ~0.5 km, bushes 260 m, lawn scatter 120 m — so the GPU only gets what the
 * fog does not swallow anyway. Call every frame or so with the player focus.
 */
export function updateNatureVisibility(n: NatureBuild, x: number, z: number, all = false): void {
  // Draw distances follow the graphics preset (world/lod.ts).
  const k = getViewScale();
  for (const m of n.group.children) {
    const c = m.userData.cull as { x: number; z: number; view: number; radius: number } | undefined;
    if (!c) continue;
    m.visible = all || Math.hypot(c.x - x, c.z - z) < c.view * k + c.radius;
  }
  for (const l of n.lods) {
    l.near.update(x, z, all);
    // Aerial views draw every full model instead of the proxies.
    if (all) l.far.clear();
    else l.far.update(x, z);
  }
}

export function buildNature(map: CampusMap, assets: NatureAssets, height: (x: number, z: number) => number, grid: CollisionGrid): NatureBuild {
  const instances: Instance[] = [];
  let trees = 0;
  for (const t of map.trees) {
    const sp = SPECIES[t.species];
    const model = sp.models[Math.floor(hash01(t.x, t.z, 1) * sp.models.length)];
    const asset = assets.get(model);
    if (!asset) continue;
    const target = sp.height[0] + (sp.height[1] - sp.height[0]) * hash01(t.x, t.z, 2);
    const scale = target / asset.height;
    const y = height(t.x, t.z);
    const view = t.species === "bush" ? BUSH_VIEW : TREE_VIEW;
    instances.push({ model, x: t.x, y: y - 0.05, z: t.z, yaw: hash01(t.x, t.z, 3) * Math.PI * 2, scale, slim: sp.slim, shadow: sp.shadow, view, chunk: TREE_CHUNK, species: t.species });
    if (sp.trunk > 0) grid.addCirc(t.x, t.z, sp.trunk, y, 6);
    trees++;
  }

  // Scatter on lawns and parks, away from paths/roads.
  const roadIndex = createRoadIndex(map.roads);
  const totalWeight = SCATTER.reduce((s, e) => s + e.weight, 0);
  let scatter = 0;
  for (const l of map.landuse) {
    const per = SCATTER_DENSITY[l.kind];
    if (!per) continue;
    const count = Math.min(Math.round(l.area / per), SCATTER_MAX - scatter);
    if (count <= 0) continue;
    const bb = bboxOf(l.points);
    let placed = 0;
    for (let k = 0; placed < count && k < count * 4; k++) {
      const x = bb.minX + (bb.maxX - bb.minX) * hash01(bb.minX + k, bb.minZ, 11);
      const z = bb.minZ + (bb.maxZ - bb.minZ) * hash01(bb.minZ, bb.maxX + k, 12);
      if (!pointInPolygon(x, z, l.points)) continue;
      const near = nearestRoadPoint(roadIndex, x, z, { maxDistance: 6 });
      if (near && near.distance < map.roads[near.road].width / 2 + 0.8) continue;
      let r = hash01(x, z, 13) * totalWeight;
      let pick = SCATTER[0];
      for (const e of SCATTER) {
        r -= e.weight;
        if (r <= 0) {
          pick = e;
          break;
        }
      }
      const asset = assets.get(pick.model);
      if (!asset) continue;
      const target = pick.height[0] + (pick.height[1] - pick.height[0]) * hash01(x, z, 14);
      instances.push({ model: pick.model, x, y: height(x, z) - 0.03, z, yaw: hash01(x, z, 15) * Math.PI * 2, scale: target / asset.height, slim: 1, shadow: false, view: SCATTER_VIEW, chunk: SCATTER_CHUNK, species: null });
      placed++;
    }
    scatter += placed;
  }

  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const group = new THREE.Group();
  group.name = "nature";
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const matrixOf = (inst: Instance) => {
    q.setFromAxisAngle(up, inst.yaw);
    return new THREE.Matrix4().compose(pos.set(inst.x, inst.y, inst.z), q, scl.set(inst.scale * inst.slim, inst.scale, inst.scale * inst.slim));
  };

  // Trees: one near (full model) + one far (proxy) distance-banded mesh per variant.
  const lods: NatureBuild["lods"] = [];
  const treeModels = new Map<string, { species: TreeSpecies; list: Instance[] }>();
  for (const inst of instances) {
    if (inst.species === null || inst.species === "bush") continue;
    let e = treeModels.get(inst.model);
    if (!e) treeModels.set(inst.model, (e = { species: inst.species, list: [] }));
    e.list.push(inst);
  }
  for (const [model, { species, list }] of treeModels) {
    const asset = assets.get(model)!;
    const items = list.map((inst) => ({ matrix: matrixOf(inst), x: inst.x, z: inst.z }));
    const near = new DistanceInstances(asset.geometry, material, items, 0, TREE_LOD, 8);
    const proxy = treeProxy(asset, species);
    const far = new DistanceInstances(proxy, material, items, TREE_LOD, TREE_VIEW, 8);
    near.mesh.castShadow = SPECIES[species].shadow;
    near.mesh.name = `nature:tree:${model}`;
    far.mesh.name = `nature:treeProxy:${model}`;
    group.add(near.mesh, far.mesh);
    lods.push({ near, far, trisNear: asset.geometry.attributes.position.count / 3, trisFar: proxy.attributes.position.count / 3 });
  }

  // Bushes and scatter: one InstancedMesh per (chunk, model).
  const buckets = new Map<string, Instance[]>();
  for (const inst of instances) {
    if (inst.species !== null && inst.species !== "bush") continue;
    const key = `${inst.chunk}:${Math.floor(inst.x / inst.chunk)},${Math.floor(inst.z / inst.chunk)}|${inst.model}|${inst.view}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = []));
    b.push(inst);
  }
  let triangles = 0;
  for (const [key, list] of buckets) {
    const asset = assets.get(list[0].model)!;
    const mesh = new THREE.InstancedMesh(asset.geometry, material, list.length);
    list.forEach((inst, i) => {
      q.setFromAxisAngle(up, inst.yaw);
      m4.compose(pos.set(inst.x, inst.y, inst.z), q, scl.set(inst.scale * inst.slim, inst.scale, inst.scale * inst.slim));
      mesh.setMatrixAt(i, m4);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = list[0].shadow;
    mesh.receiveShadow = false;
    mesh.name = `nature:${key}`;
    // Draw-distance culling (see updateNatureVisibility): chunk centre + view distance.
    const c = mesh.boundingSphere!.center;
    mesh.userData.cull = { x: c.x, z: c.z, view: list[0].view, radius: mesh.boundingSphere!.radius };
    group.add(mesh);
    triangles += (asset.geometry.attributes.position.count / 3) * list.length;
  }
  // Totals if every tree were drawn as the full model / as the proxy.
  let treeTrianglesNear = 0;
  let treeTrianglesFar = 0;
  for (const l of lods) {
    treeTrianglesNear += l.trisNear * l.near.mesh.instanceMatrix.count;
    treeTrianglesFar += l.trisFar * l.far.mesh.instanceMatrix.count;
  }
  return {
    group,
    lods,
    stats: { trees, scatter, meshes: group.children.length, triangles: Math.round(triangles), treeTrianglesNear: Math.round(treeTrianglesNear), treeTrianglesFar: Math.round(treeTrianglesFar) },
  };
}
