// Vehicle model templates: loads every catalogue GLB once and splits it into
// shareable parts — body meshes tagged by role (paint / head / tail / light
// bar), wheels re-pivoted on their own centre (so they spin on the axle and
// the front ones steer about a vertical axis) and generated reverse lamps.
// Instances (meshes.ts) reuse the geometries and the shared materials; only
// tinted paint gets a per-colour material. Until the GLBs arrive (or if they
// fail) a procedural box template with the same layout stands in.

import * as THREE from "three";
import { createGltfLoader, displayColor, toLambert } from "../assets/gltf";
import { VEHICLE_CATALOG, VEHICLE_TYPE_KEYS } from "./catalog";
import type { VehicleSpec, VehicleTypeKey } from "./types";

/** What a body part does at runtime. */
export type PartRole = "paint" | "head" | "tail" | "reverse" | "barRed" | "barBlue" | "other";

export interface PartTemplate {
  geometry: THREE.BufferGeometry;
  /** Material in the unlit / untinted state (shared). */
  material: THREE.Material;
  role: PartRole;
  /** Paint brightness factor for two-tone bodies (paint role only). */
  shade: number;
  /** Transform in model space (body parts) or relative to the wheel centre (wheel parts). */
  matrix: THREE.Matrix4;
}

export interface WheelTemplate {
  /** Wheel (or rear axle) centre in model space. */
  centre: THREE.Vector3;
  front: boolean;
  parts: PartTemplate[];
}

export interface VehicleTemplate {
  body: PartTemplate[];
  wheels: WheelTemplate[];
  /** "glb" once the model is loaded, "fallback" for the procedural stand-in. */
  source: "glb" | "fallback";
}

/** Lit-state materials, shared by every vehicle (MeshBasic = unlit, reads as glowing). */
export const LAMP_ON: Record<"head" | "tailRun" | "tailBrake" | "reverse" | "barRed" | "barBlue", THREE.MeshBasicMaterial> = {
  head: new THREE.MeshBasicMaterial({ color: 0xfff4d6, name: "HeadlightsOn" }),
  tailRun: new THREE.MeshBasicMaterial({ color: 0xb8241a, name: "TailLightsRun" }),
  tailBrake: new THREE.MeshBasicMaterial({ color: 0xff3a26, name: "TailLightsBrake" }),
  reverse: new THREE.MeshBasicMaterial({ color: 0xffffff, name: "ReverseOn" }),
  barRed: new THREE.MeshBasicMaterial({ color: 0xff1a1a, name: "LightBarRedOn" }),
  barBlue: new THREE.MeshBasicMaterial({ color: 0x2a5cff, name: "LightBarBlueOn" }),
};

/** Reverse lamp lens when off: clear glass. */
const REVERSE_OFF = new THREE.MeshLambertMaterial({ color: 0x7a7a7a, name: "ReverseOff" });
/** Reverse lamp size in model units (width, height, depth). */
const REVERSE_LAMP_SIZE = [0.12, 0.05, 0.04] as const;

const paintCache = new Map<string, THREE.MeshLambertMaterial>();

/** Shared body material for a tint colour (display sRGB) and shade. */
export function paintMaterial(color: number, shade: number): THREE.MeshLambertMaterial {
  const key = `${color}:${shade}`;
  let m = paintCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(shade), name: "Paint" });
    paintCache.set(key, m);
  }
  return m;
}

const templates = new Map<VehicleTypeKey, VehicleTemplate>();
const fallbacks = new Map<VehicleTypeKey, VehicleTemplate>();

/** The loaded GLB template of a type, or the procedural stand-in while it is not available. */
export function vehicleTemplate(key: VehicleTypeKey): VehicleTemplate {
  const t = templates.get(key);
  if (t) return t;
  let f = fallbacks.get(key);
  if (!f) {
    f = buildFallback(VEHICLE_CATALOG[key]);
    fallbacks.set(key, f);
  }
  return f;
}

// ---------------- GLB -> template ----------------

type NodeKind = "body" | "rear" | "fl" | "fr";

function nodeKind(name: string): NodeKind {
  if (/BackWheels/i.test(name)) return "rear";
  if (/FrontLeftWheel/i.test(name)) return "fl";
  if (/FrontRightWheel/i.test(name)) return "fr";
  return "body";
}

function roleOf(spec: VehicleSpec, materialName: string): { role: PartRole; shade: number } {
  const slot = spec.model.paint.find((p) => p.material === materialName);
  if (slot) return { role: "paint", shade: slot.shade ?? 1 };
  if (materialName === "Headlights") return { role: "head", shade: 1 };
  if (materialName === "TailLights") return { role: "tail", shade: 1 };
  if (materialName === "BlueLights") return { role: "barBlue", shade: 1 };
  return { role: "other", shade: 1 };
}

/** Index buffer of a geometry (sequential when it has none). */
function indexOf(g: THREE.BufferGeometry): ArrayLike<number> {
  if (g.index) return g.index.array;
  const n = g.attributes.position.count;
  const seqIdx = new Uint32Array(n);
  for (let i = 0; i < n; i++) seqIdx[i] = i;
  return seqIdx;
}

/** Same vertex attributes, only the triangles in `tris` (indices into the triangle list). */
function subGeometry(g: THREE.BufferGeometry, idx: ArrayLike<number>, tris: number[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(g.attributes)) out.setAttribute(name, g.attributes[name]);
  const arr = new Uint32Array(tris.length * 3);
  tris.forEach((t, i) => {
    arr[i * 3] = idx[t * 3];
    arr[i * 3 + 1] = idx[t * 3 + 1];
    arr[i * 3 + 2] = idx[t * 3 + 2];
  });
  out.setIndex(new THREE.BufferAttribute(arr, 1));
  return out;
}

/** Splits a geometry into the triangles below / above a model-space height (light bar on the roof). */
function splitByHeight(g: THREE.BufferGeometry, matrix: THREE.Matrix4, minY: number): [THREE.BufferGeometry | null, THREE.BufferGeometry | null] {
  const pos = g.attributes.position;
  const idx = indexOf(g);
  const e = matrix.elements;
  const yOf = (i: number) => e[1] * pos.getX(i) + e[5] * pos.getY(i) + e[9] * pos.getZ(i) + e[13];
  const below: number[] = [];
  const above: number[] = [];
  for (let t = 0; t < idx.length / 3; t++) {
    const y = (yOf(idx[t * 3]) + yOf(idx[t * 3 + 1]) + yOf(idx[t * 3 + 2])) / 3;
    (y > minY ? above : below).push(t);
  }
  return [below.length ? subGeometry(g, idx, below) : null, above.length ? subGeometry(g, idx, above) : null];
}

/** Model-space bounds of some parts. */
function partsBox(parts: PartTemplate[]): THREE.Box3 {
  const box = new THREE.Box3();
  const b = new THREE.Box3();
  for (const p of parts) {
    if (!p.geometry.boundingBox) p.geometry.computeBoundingBox();
    box.union(b.copy(p.geometry.boundingBox!).applyMatrix4(p.matrix));
  }
  return box;
}

/** Model-space bounds of the vertices of `parts` on one side (sign of x) of the centre line, behind `maxZ`. */
function sideBox(parts: PartTemplate[], side: 1 | -1, maxZ: number): THREE.Box3 {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const p of parts) {
    const pos = p.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(p.matrix);
      if (v.x * side > 0.02 && v.z < maxZ) box.expandByPoint(v);
    }
  }
  return box;
}

/**
 * Reverse lamps: a small clear lens on the inner part of each tail-light
 * cluster, standing slightly proud of its rearmost surface (the lamp
 * overlays the tail light, so it is always visible from behind).
 */
function reverseLamps(tails: PartTemplate[]): PartTemplate[] {
  const out: PartTemplate[] = [];
  if (tails.length === 0) return out;
  // Only the rear face (some liveries reuse the tail-light material elsewhere on the body).
  const maxZ = partsBox(tails).min.z + 0.3;
  for (const side of [-1, 1] as const) {
    const bb = sideBox(tails, side, maxZ);
    if (bb.isEmpty()) continue;
    const xIn = Math.min(Math.abs(bb.min.x), Math.abs(bb.max.x));
    const xOut = Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x));
    const w = THREE.MathUtils.clamp((xOut - xIn) * 0.32, REVERSE_LAMP_SIZE[0] * 0.5, REVERSE_LAMP_SIZE[0]);
    const h = THREE.MathUtils.clamp((bb.max.y - bb.min.y) * 0.5, REVERSE_LAMP_SIZE[1] * 0.6, REVERSE_LAMP_SIZE[1]);
    const d = REVERSE_LAMP_SIZE[2];
    const geo = new THREE.BoxGeometry(w, h, d);
    const matrix = new THREE.Matrix4().makeTranslation(side * (xIn + w / 2 + 0.01), (bb.min.y + bb.max.y) / 2, bb.min.z + d / 2 - 0.022);
    out.push({ geometry: geo, material: REVERSE_OFF, role: "reverse", shade: 1, matrix });
  }
  return out;
}

function templateFromGltf(spec: VehicleSpec, scene: THREE.Object3D): VehicleTemplate {
  scene.updateMatrixWorld(true);
  const body: PartTemplate[] = [];
  const wheels: WheelTemplate[] = [];
  const minY = spec.model.lightBar?.minY;
  for (const node of [...scene.children]) {
    const kind = nodeKind(node.name);
    const parts: PartTemplate[] = [];
    node.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = mesh.material as THREE.Material;
      const { role, shade } = kind === "body" ? roleOf(spec, src.name) : { role: "other" as const, shade: 1 };
      const offColor = displayColor(src);
      const material = toLambert(src);
      const matrix = mesh.matrixWorld.clone();
      if (minY !== undefined && (role === "tail" || role === "barBlue")) {
        const [below, above] = splitByHeight(mesh.geometry, matrix, minY);
        // Lights above the roof line form the bar; tail-light material up there is its red half.
        if (below) parts.push({ geometry: below, material, role: role === "tail" ? "tail" : "other", shade, matrix });
        if (above) parts.push({ geometry: above, material: new THREE.MeshLambertMaterial({ color: offColor }), role: role === "tail" ? "barRed" : "barBlue", shade, matrix });
        return;
      }
      parts.push({ geometry: mesh.geometry, material, role, shade, matrix });
    });
    if (kind === "body") {
      body.push(...parts);
      continue;
    }
    // Re-pivot: wheel parts are expressed relative to the wheel's own bounding-box centre.
    const centre = partsBox(parts).getCenter(new THREE.Vector3());
    const toCentre = new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z);
    for (const p of parts) p.matrix = toCentre.clone().multiply(p.matrix);
    wheels.push({ centre, front: kind !== "rear", parts });
  }
  body.push(...reverseLamps(body.filter((p) => p.role === "tail")));
  return { body, wheels, source: "glb" };
}

/** Warns (dev aid) when a GLB's measured body differs from the catalogue geometry. */
function checkMeasurements(spec: VehicleSpec, t: VehicleTemplate): void {
  const bb = partsBox(t.body.filter((p) => p.role !== "reverse"));
  const g = spec.model.geometry.body;
  const off = Math.max(...[0, 1, 2].map((i) => Math.max(Math.abs(bb.min.getComponent(i) - g.min[i]), Math.abs(bb.max.getComponent(i) - g.max[i]))));
  if (off > 0.03) console.warn(`[vehicles] ${spec.key}: model bounds differ from the catalogue by ${off.toFixed(3)} m`, bb);
}

let pending: Promise<void> | null = null;

/** Loads (once per page) every catalogue GLB into a template. Rejects if any fails; a later call retries. */
export function loadVehicleAssets(): Promise<void> {
  if (!pending) {
    const loader = createGltfLoader();
    pending = Promise.all(
      VEHICLE_TYPE_KEYS.map(async (key) => {
        const spec = VEHICLE_CATALOG[key];
        const gltf = await loader.loadAsync(spec.model.file);
        const t = templateFromGltf(spec, gltf.scene);
        checkMeasurements(spec, t);
        return [key, t] as const;
      }),
    )
      .then((list) => {
        for (const [key, t] of list) templates.set(key, t);
      })
      .catch((err) => {
        pending = null;
        throw err;
      });
  }
  return pending;
}

// ---------------- Procedural stand-in ----------------

const FALLBACK_MATS = {
  paint: new THREE.MeshLambertMaterial({ color: 0x8a8f96 }),
  glass: new THREE.MeshLambertMaterial({ color: 0x1a2c3c }),
  head: new THREE.MeshLambertMaterial({ color: 0xd8c9a0 }),
  tail: new THREE.MeshLambertMaterial({ color: 0x7a1010 }),
  tyre: new THREE.MeshLambertMaterial({ color: 0x151515 }),
};

function boxPart(w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material, role: PartRole): PartTemplate {
  return { geometry: new THREE.BoxGeometry(w, h, d), material, role, shade: 1, matrix: new THREE.Matrix4().makeTranslation(x, y, z) };
}

/** Box body + cylinder wheels laid out from the catalogue geometry (model units). */
function buildFallback(spec: VehicleSpec): VehicleTemplate {
  const g = spec.model.geometry;
  const [x0, y0, z0] = g.body.min;
  const [x1, y1, z1] = g.body.max;
  const W = x1 - x0;
  const L = z1 - z0;
  const zc = (z0 + z1) / 2;
  const lowH = (y1 - y0) * 0.55;
  const body: PartTemplate[] = [
    boxPart(W, lowH, L, 0, y0 + lowH / 2, zc, FALLBACK_MATS.paint, "paint"),
    boxPart(W * 0.86, y1 - y0 - lowH, L * 0.5, 0, y0 + lowH + (y1 - y0 - lowH) / 2, zc - L * 0.05, FALLBACK_MATS.glass, "other"),
  ];
  const lampY = y0 + lowH * 0.65;
  for (const side of [-1, 1]) {
    body.push(boxPart(W * 0.18, 0.08, 0.04, side * W * 0.32, lampY, z1 + 0.01, FALLBACK_MATS.head, "head"));
    body.push(boxPart(W * 0.2, 0.07, 0.04, side * W * 0.32, lampY, z0 - 0.01, FALLBACK_MATS.tail, "tail"));
  }
  body.push(...reverseLamps(body.filter((p) => p.role === "tail")));
  const r = g.wheelRadius;
  const cy = g.wheelBottom + r;
  const track = W / 2 - 0.14;
  const wheelGeo = new THREE.CylinderGeometry(r, r, 0.2, 14).rotateZ(Math.PI / 2);
  const tyre = (x: number): PartTemplate => ({ geometry: wheelGeo, material: FALLBACK_MATS.tyre, role: "other", shade: 1, matrix: new THREE.Matrix4().makeTranslation(x, 0, 0) });
  return {
    body,
    wheels: [
      { centre: new THREE.Vector3(0, cy, g.rearAxleZ), front: false, parts: [tyre(-track), tyre(track)] },
      { centre: new THREE.Vector3(track, cy, g.frontAxleZ), front: true, parts: [tyre(0)] },
      { centre: new THREE.Vector3(-track, cy, g.frontAxleZ), front: true, parts: [tyre(0)] },
    ],
    source: "fallback",
  };
}
