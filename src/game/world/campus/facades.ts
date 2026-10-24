// MegaKit facades for the whole campus: every placement from
// facadeLayout.ts becomes one instance per material slot of its module in a
// handful of city-wide BatchedMeshes (one per material: brick, trim, metal,
// lit glass, dark glass, roof props), so the facade detail costs ~6 draw
// calls however many buildings are dressed. Per-instance colours give each
// building its family tint from shared materials (the brick texture is
// desaturated so it can be tinted pale, cream or red).
//
// LOD: a building shows its modules only while the camera focus is within
// FACADE_VIEW of it and its bounding sphere is in the camera frustum; farther
// away the 4a extruded wall (window texture) behind them is all that is
// drawn. (Per-building culling here instead of BatchedMesh's per-instance
// culling: ~120 sphere tests a frame instead of tens of thousands.) Modules never cast shadows (the walls
// do) and are not shootable (bullets hit the walls/footprint).

import * as THREE from "three";
import type { MegakitAssets, MegakitSlot } from "../../assets/megakit";
import { desaturatedTexture } from "../../assets/megakit";
import type { BuildingLightMat } from "../environment";
import type { FacadeLayout, ModulePlacement } from "./facadeLayout";

/** Facade detail draw distance (m) from the camera focus to a building's bounding circle. */
export const FACADE_VIEW = 190;
/** The focus must move this far (m) before visibility is re-evaluated. */
const LOD_STEP = 8;

type BatchKey = "brick" | "trim" | "metal" | "glassLit" | "glassDark" | "ornament";

export interface FacadeBuildingRef {
  layout: FacadeLayout;
  /** Bounding circle of the footprint and the height span of the facade. */
  cx: number;
  cz: number;
  r: number;
  base: number;
  top: number;
}

export interface FacadeBuild {
  group: THREE.Group;
  /**
   * Shows the modules of buildings near (x, z) and, given a camera, inside
   * its view; "all" shows every building (aerial views).
   */
  update(x: number, z: number, all?: boolean, camera?: THREE.Camera): void;
  /** Lit-window glass (night emissive driven by the environment). */
  lightMaterials: BuildingLightMat[];
  stats: { buildings: number; placements: number; instances: number; drawCalls: number; trianglesAll: number; trianglesVisible: number };
}

function batchOf(slot: MegakitSlot, p: ModulePlacement): BatchKey | null {
  switch (slot) {
    case "brick":
    case "trim":
    case "metal":
      return slot;
    case "glass":
      return p.lit ? "glassLit" : "glassDark";
    case "ornament":
      return "ornament";
    default:
      return null;
  }
}

function tintOf(key: BatchKey, t: FacadeLayout["tints"]): number {
  if (key === "brick") return t.brick;
  if (key === "trim") return t.trim;
  if (key === "metal") return t.metal;
  return 0xffffff;
}

function makeMaterials(assets: MegakitAssets, anisotropy: number): Record<BatchKey, THREE.Material> {
  const tex = assets.textures;
  for (const t of Object.values(tex)) if (t) t.anisotropy = anisotropy;
  const brickMap = tex.brick ? desaturatedTexture(tex.brick) : null;
  // The MegaKit metal/concrete is dark brown-grey: brighten it to a neutral grey so the family tints read.
  const metalMap = tex.metal ? desaturatedTexture(tex.metal, 0.8) : null;
  const glass = (emissive: number) =>
    new THREE.MeshPhongMaterial({ color: 0x33424f, specular: 0x6f8296, shininess: 60, emissive, emissiveIntensity: 0, name: "FacadeGlass" });
  return {
    brick: new THREE.MeshLambertMaterial({ map: brickMap, name: "FacadeBrick" }),
    trim: new THREE.MeshLambertMaterial({ map: tex.trim ?? null, name: "FacadeTrim" }),
    metal: new THREE.MeshLambertMaterial({ map: metalMap, name: "FacadeMetal" }),
    glassLit: glass(0xffd9a0),
    glassDark: glass(0x000000),
    ornament: new THREE.MeshLambertMaterial({ map: tex.ornament ?? null, name: "FacadeOrnament" }),
  };
}

export function buildFacades(buildings: readonly FacadeBuildingRef[], assets: MegakitAssets, anisotropy: number): FacadeBuild {
  // Pass 1: which (module, slot) geometries each batch needs and how many instances.
  const need = new Map<BatchKey, { geos: Map<string, THREE.BufferGeometry>; instances: number }>();
  let placements = 0;
  for (const b of buildings) {
    for (const p of b.layout.placements) {
      const parts = assets.modules.get(p.module);
      if (!parts) continue;
      placements++;
      for (const [slot, geo] of parts) {
        const key = batchOf(slot, p);
        if (!key) continue;
        let n = need.get(key);
        if (!n) need.set(key, (n = { geos: new Map(), instances: 0 }));
        n.geos.set(`${p.module}|${slot}`, geo);
        n.instances++;
      }
    }
  }

  const materials = makeMaterials(assets, anisotropy);
  const group = new THREE.Group();
  group.name = "facades";
  const batches = new Map<BatchKey, { mesh: THREE.BatchedMesh; ids: Map<string, number>; tris: Map<string, number> }>();
  for (const [key, n] of need) {
    let verts = 0;
    let idx = 0;
    for (const g of n.geos.values()) {
      verts += g.attributes.position.count;
      idx += g.index!.count;
    }
    const mesh = new THREE.BatchedMesh(n.instances, verts, idx, materials[key]);
    mesh.name = `facades:${key}`;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    // Visibility is driven by distance (update); per-instance culling/sorting would cost CPU every frame.
    mesh.perObjectFrustumCulled = false;
    mesh.sortObjects = false;
    mesh.frustumCulled = false;
    const ids = new Map<string, number>();
    const tris = new Map<string, number>();
    for (const [k, g] of n.geos) {
      ids.set(k, mesh.addGeometry(g));
      tris.set(k, g.index!.count / 3);
    }
    batches.set(key, { mesh, ids, tris });
    group.add(mesh);
  }

  // Pass 2: instances (hidden until the LOD pass shows them).
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const col = new THREE.Color();
  const perBuilding: { cx: number; cz: number; r: number; sphere: THREE.Sphere; inst: [THREE.BatchedMesh, number][]; tris: number; shown: boolean }[] = [];
  const frustum = new THREE.Frustum();
  const viewProj = new THREE.Matrix4();
  let instances = 0;
  let trianglesAll = 0;
  for (const b of buildings) {
    const sphere = new THREE.Sphere(new THREE.Vector3(b.cx, (b.base + b.top) / 2, b.cz), Math.hypot(b.r + 1, (b.top - b.base) / 2 + 1));
    const entry = { cx: b.cx, cz: b.cz, r: b.r, sphere, inst: [] as [THREE.BatchedMesh, number][], tris: 0, shown: false };
    for (const p of b.layout.placements) {
      const parts = assets.modules.get(p.module);
      if (!parts) continue;
      q.setFromAxisAngle(up, p.yaw);
      m4.compose(pos.set(p.x, p.y, p.z), q, scl.set(p.sx, p.sy, p.sz));
      for (const slot of parts.keys()) {
        const key = batchOf(slot, p);
        if (!key) continue;
        const batch = batches.get(key)!;
        const k = `${p.module}|${slot}`;
        const id = batch.mesh.addInstance(batch.ids.get(k)!);
        batch.mesh.setMatrixAt(id, m4);
        batch.mesh.setColorAt(id, col.setHex(tintOf(key, b.layout.tints)));
        batch.mesh.setVisibleAt(id, false);
        entry.inst.push([batch.mesh, id]);
        entry.tris += batch.tris.get(k)!;
        instances++;
      }
    }
    trianglesAll += entry.tris;
    if (entry.inst.length > 0) perBuilding.push(entry);
  }

  let lastX = Infinity;
  let lastZ = Infinity;
  let lastAll = false;
  const stats: FacadeBuild["stats"] = { buildings: perBuilding.length, placements, instances, drawCalls: batches.size, trianglesAll, trianglesVisible: 0 };

  return {
    group,
    lightMaterials: [materials.glassLit as THREE.MeshPhongMaterial],
    stats,
    update(x, z, all = false, camera) {
      const cull = !!camera && !all;
      // Without a camera only the distance matters: skip until the focus has moved a bit.
      if (!cull && all === lastAll && Math.hypot(x - lastX, z - lastZ) < LOD_STEP) return;
      lastX = x;
      lastZ = z;
      lastAll = all;
      if (cull) {
        camera!.updateMatrixWorld();
        viewProj.multiplyMatrices(camera!.projectionMatrix, camera!.matrixWorldInverse);
        frustum.setFromProjectionMatrix(viewProj);
      }
      let visible = 0;
      for (const b of perBuilding) {
        const show = all || (Math.hypot(b.cx - x, b.cz - z) - b.r < FACADE_VIEW && (!cull || frustum.intersectsSphere(b.sphere)));
        if (show) visible += b.tris;
        if (show === b.shown) continue;
        b.shown = show;
        for (const [mesh, id] of b.inst) mesh.setVisibleAt(id, show);
      }
      stats.trianglesVisible = visible;
    },
  };
}
