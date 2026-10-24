// Downtown City MegaKit (Quaternius, CC0): loads the merged module GLB once
// and splits it into per-module, per-material geometries ready for batching.
// Every root node of the GLB is one module named after the original file
// (see public/models/buildings/megakit.index.json); its sub-meshes are
// baked into module space (origin at the module's bottom-front centre, front
// facing +z) and merged by material slot. The quantized attributes are
// expanded to float32 so the geometries can be merged and transformed.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MODELS_URL, createGltfLoader } from "./gltf";

export const MEGAKIT_URL = `${MODELS_URL}/buildings/megakit.glb`;

/** Material slots we render (the fake interiors behind the glass are dropped: the glass is opaque here). */
export type MegakitSlot = "brick" | "trim" | "glass" | "metal" | "ornament" | "dirt" | "concrete" | "slate";

const SLOT_OF: Record<string, MegakitSlot> = {
  MI_RedBrick: "brick",
  MI_Trim: "trim",
  MI_Glass: "glass",
  MI_Trim_MetalConcrete: "metal",
  MI_Ornaments: "ornament",
  MI_Dirt: "dirt",
  MI_Concrete: "concrete",
  MI_Roof_Slate: "slate",
};

export type ModuleParts = Map<MegakitSlot, THREE.BufferGeometry>;

export interface MegakitAssets {
  modules: Map<string, ModuleParts>;
  /** Base-colour textures by slot (display values: NoColorSpace, as the renderer runs unmanaged). */
  textures: Partial<Record<MegakitSlot, THREE.Texture>>;
}

/** Float32, non-normalized copy of an attribute (quantized GLB attributes are int16/int8). */
function floatAttribute(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  const n = a.count;
  const size = a.itemSize;
  const out = new Float32Array(n * size);
  for (let i = 0; i < n; i++) {
    out[i * size] = a.getX(i);
    if (size > 1) out[i * size + 1] = a.getY(i);
    if (size > 2) out[i * size + 2] = a.getZ(i);
    if (size > 3) out[i * size + 3] = a.getW(i);
  }
  return new THREE.BufferAttribute(out, size);
}

/** position/normal/uv float32 geometry of a mesh, baked with its world matrix. */
function bakedGeometry(mesh: THREE.Mesh): THREE.BufferGeometry {
  const src = mesh.geometry;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", floatAttribute(src.attributes.position));
  if (src.attributes.normal) g.setAttribute("normal", floatAttribute(src.attributes.normal));
  if (src.attributes.uv) g.setAttribute("uv", floatAttribute(src.attributes.uv));
  else g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(src.attributes.position.count * 2), 2));
  if (src.index) g.setIndex(new THREE.BufferAttribute(new Uint32Array(src.index.array), 1));
  else {
    const idx = new Uint32Array(src.attributes.position.count);
    for (let i = 0; i < idx.length; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  g.applyMatrix4(mesh.matrixWorld);
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

let pending: Promise<MegakitAssets> | null = null;

/** Loads (once per page) the MegaKit modules. Rejects on failure; a later call retries. */
export function loadMegakit(): Promise<MegakitAssets> {
  if (!pending) {
    pending = createGltfLoader()
      .loadAsync(MEGAKIT_URL)
      .then((gltf) => {
        gltf.scene.updateMatrixWorld(true);
        const modules = new Map<string, ModuleParts>();
        const textures: MegakitAssets["textures"] = {};
        for (const root of gltf.scene.children) {
          const bySlot = new Map<MegakitSlot, THREE.BufferGeometry[]>();
          root.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            const mat = mesh.material as THREE.MeshStandardMaterial;
            const slot = SLOT_OF[mat.name];
            if (!slot) return;
            if (mat.map && !textures[slot]) {
              mat.map.colorSpace = THREE.NoColorSpace;
              textures[slot] = mat.map;
            }
            let list = bySlot.get(slot);
            if (!list) bySlot.set(slot, (list = []));
            list.push(bakedGeometry(mesh));
          });
          const parts: ModuleParts = new Map();
          for (const [slot, list] of bySlot) {
            const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
            if (merged) {
              merged.computeBoundingSphere();
              parts.set(slot, merged);
            }
          }
          modules.set(root.name, parts);
        }
        return { modules, textures };
      })
      .catch((err) => {
        pending = null;
        throw err;
      });
  }
  return pending;
}

/**
 * Grey, brightness-normalized copy of a texture (the MegaKit brick is red):
 * per-instance tints then give pale, cream or red brick from one material.
 */
export function desaturatedTexture(tex: THREE.Texture, targetMean = 0.78): THREE.Texture {
  const img = tex.image as CanvasImageSource & { width: number; height: number };
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.drawImage(img, 0, 0);
  const data = x.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
  const mean = sum / (d.length / 4) / 255 || 1;
  // Keep some of the mortar/brick contrast but centre it on the target brightness.
  const k = targetMean / mean;
  for (let i = 0; i < d.length; i += 4) {
    const l = (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / 255;
    const v = Math.min(255, Math.round((targetMean + (l * k - targetMean) * 0.75) * 255));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  x.putImageData(data, 0, 0);
  const out = new THREE.CanvasTexture(c);
  out.colorSpace = THREE.NoColorSpace;
  out.flipY = tex.flipY;
  out.wrapS = tex.wrapS;
  out.wrapT = tex.wrapT;
  out.anisotropy = tex.anisotropy;
  return out;
}
