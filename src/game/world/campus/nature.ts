// Vegetation: the map's 766 trees (palms, pines, broadleaf trees, bushes) and
// a cheap scatter of grass tufts, plants, flowers and rocks over parks and
// lawns, all instanced from the Quaternius Ultimate Nature models (CC0).
//
// Two variants per species (random yaw/scale add the variety) keep the draw
// calls down. Every model's sub-meshes are merged into ONE vertex-coloured geometry (they
// only use flat colours), so a tree variant is a single InstancedMesh per
// 240 m chunk: frustum culling (and the small sun-shadow frustum) skip far
// chunks, and all vegetation shares one material.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { CampusMap } from "../../map/loader";
import type { MapLanduse, TreeSpecies } from "../../map/types";
import { bboxOf, pointInPolygon } from "../../map/geometry";
import { createRoadIndex, nearestRoadPoint } from "../../map/queries";
import { MODELS_URL, createGltfLoader, displayColor } from "../../assets/gltf";
import type { CollisionGrid } from "../colliders";

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
  stats: { trees: number; scatter: number; meshes: number; triangles: number };
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
}

/**
 * Hides vegetation chunks beyond their draw distance from (x, z) — trees
 * ~0.5 km, bushes 260 m, lawn scatter 120 m — so the GPU only gets what the
 * fog does not swallow anyway. Call every frame or so with the player focus.
 */
export function updateNatureVisibility(n: NatureBuild, x: number, z: number, all = false): void {
  for (const m of n.group.children) {
    const c = m.userData.cull as { x: number; z: number; r: number } | undefined;
    if (!c) continue;
    m.visible = all || Math.hypot(c.x - x, c.z - z) < c.r;
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
    instances.push({ model, x: t.x, y: y - 0.05, z: t.z, yaw: hash01(t.x, t.z, 3) * Math.PI * 2, scale, slim: sp.slim, shadow: sp.shadow, view, chunk: TREE_CHUNK });
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
      instances.push({ model: pick.model, x, y: height(x, z) - 0.03, z, yaw: hash01(x, z, 15) * Math.PI * 2, scale: target / asset.height, slim: 1, shadow: false, view: SCATTER_VIEW, chunk: SCATTER_CHUNK });
      placed++;
    }
    scatter += placed;
  }

  // One InstancedMesh per (chunk, model).
  const buckets = new Map<string, Instance[]>();
  for (const inst of instances) {
    const key = `${inst.chunk}:${Math.floor(inst.x / inst.chunk)},${Math.floor(inst.z / inst.chunk)}|${inst.model}|${inst.view}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = []));
    b.push(inst);
  }
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const group = new THREE.Group();
  group.name = "nature";
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
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
    mesh.userData.cull = { x: c.x, z: c.z, r: list[0].view + mesh.boundingSphere!.radius };
    group.add(mesh);
    triangles += (asset.geometry.attributes.position.count / 3) * list.length;
  }
  return { group, stats: { trees, scatter, meshes: group.children.length, triangles: Math.round(triangles) } };
}
