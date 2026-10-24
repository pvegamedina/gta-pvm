// Street props from the Quaternius Public Transport Pack (CC0): bicycles,
// traffic cones and the traffic light. The GLBs were converted from OBJ files
// whose MTLs carried no colours (every primitive is the same grey), so the
// colours are assigned here per node / primitive in the original material
// order (see the OBJ `usemtl` sequence). Each model is merged into one
// vertex-coloured geometry (flat colours only), standing on y = 0.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MODELS_URL, createGltfLoader } from "./gltf";

export const PROPS_URL = `${MODELS_URL}/props`;

/** Display colours per node-name prefix, in primitive order (last entry repeats). */
type Palette = { match: RegExp; colors: number[] }[];

const WHITE = 0xffffff;
const PALETTES: Record<string, Palette> = {
  // Frame colour stays white so instances can tint it; grips, tyres and saddle are dark.
  bicycle: [
    { match: /^Handle/, colors: [WHITE, 0x1d1d1f] },
    { match: /Wheel/, colors: [0x222326] },
    { match: /^Saddle/, colors: [0x1f1f21] },
    { match: /^Frame/, colors: [WHITE] },
  ],
  bicycle_2: [
    { match: /^Handle/, colors: [WHITE, 0x1d1d1f] },
    { match: /Wheel/, colors: [0x222326] },
    { match: /^Saddle/, colors: [0x1f1f21] },
    { match: /^Frame/, colors: [WHITE] },
  ],
  traffic_cone: [{ match: /./, colors: [0xff5a14, 0xf2f2ee] }],
  // Body, then the green / yellow / red lenses (kept dark: the signal lamps are drawn separately).
  traffic_light: [{ match: /./, colors: [0x2a2d30, 0x1a2a1d, 0x2e2a14, 0x2e1614] }],
};

export interface PropModel {
  geometry: THREE.BufferGeometry;
  /** Model-space bounds after standing it on y = 0. */
  box: THREE.Box3;
  /** Centres of the per-primitive parts (model space, after the lift), e.g. the traffic-light lenses. */
  parts: THREE.Vector3[];
}

export type PropAssets = Map<string, PropModel>;

export const PROP_NAMES = ["bicycle", "bicycle_2", "traffic_cone", "traffic_light"] as const;

function colourFor(palette: Palette, nodeName: string, index: number): number {
  const entry = palette.find((p) => p.match.test(nodeName));
  if (!entry) return WHITE;
  return entry.colors[Math.min(index, entry.colors.length - 1)];
}

let pending: Promise<PropAssets> | null = null;

/** Loads (once per page) the street props. Rejects on failure; a later call retries. */
export function loadPropAssets(): Promise<PropAssets> {
  if (!pending) {
    const loader = createGltfLoader();
    pending = Promise.all(
      PROP_NAMES.map(async (name) => {
        const gltf = await loader.loadAsync(`${PROPS_URL}/${name}.glb`);
        gltf.scene.updateMatrixWorld(true);
        const parts: THREE.BufferGeometry[] = [];
        const centres: THREE.Vector3[] = [];
        for (const node of gltf.scene.children) {
          let k = 0;
          node.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            let g = mesh.geometry.clone();
            // Expand quantized attributes before transforming.
            for (const key of Object.keys(g.attributes)) {
              const a = g.attributes[key];
              if (key !== "position" && key !== "normal") {
                g.deleteAttribute(key);
                continue;
              }
              const f = new Float32Array(a.count * 3);
              for (let i = 0; i < a.count; i++) {
                f[i * 3] = a.getX(i);
                f[i * 3 + 1] = a.getY(i);
                f[i * 3 + 2] = a.getZ(i);
              }
              g.setAttribute(key, new THREE.BufferAttribute(f, 3));
            }
            g.applyMatrix4(mesh.matrixWorld);
            if (g.index) g = g.toNonIndexed();
            if (!g.attributes.normal) g.computeVertexNormals();
            const c = new THREE.Color(colourFor(PALETTES[name], node.name, k++));
            const n = g.attributes.position.count;
            const col = new Float32Array(n * 3);
            for (let i = 0; i < n; i++) {
              col[i * 3] = c.r;
              col[i * 3 + 1] = c.g;
              col[i * 3 + 2] = c.b;
            }
            g.setAttribute("color", new THREE.BufferAttribute(col, 3));
            g.computeBoundingBox();
            centres.push(g.boundingBox!.getCenter(new THREE.Vector3()));
            parts.push(g);
            (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => m.dispose());
          });
        }
        const merged = mergeGeometries(parts, false)!;
        merged.computeBoundingBox();
        const lift = -merged.boundingBox!.min.y;
        merged.translate(0, lift, 0);
        merged.computeBoundingBox();
        merged.computeBoundingSphere();
        for (const c of centres) c.y += lift;
        return [name, { geometry: merged, box: merged.boundingBox!.clone(), parts: centres }] as const;
      }),
    )
      .then((list) => new Map<string, PropModel>(list))
      .catch((err) => {
        pending = null;
        throw err;
      });
  }
  return pending;
}
