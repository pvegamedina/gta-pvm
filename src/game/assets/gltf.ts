// Shared glTF loading helpers for every GLB the game uses (characters,
// weapons, vehicles): a GLTFLoader with the meshopt decoder, and conversion
// of the PBR materials to the game's flat Lambert look.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { liftColor } from "../characters/weaponPose";

export const MODELS_URL = "/models";

export function createGltfLoader(): GLTFLoader {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

/**
 * glTF colour factors are linear, but the game renders with colour
 * management off and a linear output (see game.ts), i.e. material colours are
 * used as display values. Converting to sRGB keeps the authored look instead
 * of rendering everything too dark.
 */
export function displayColor(src: THREE.Material, floor = 0): THREE.Color {
  return liftColor(((src as THREE.MeshStandardMaterial).color ?? new THREE.Color(1, 1, 1)).clone().convertLinearToSRGB(), floor);
}

const lambertCache = new Map<string, THREE.MeshLambertMaterial>();

/** Shared Lambert material with `src`'s display colour (one per colour); disposes `src`. */
export function toLambert(src: THREE.Material, floor = 0): THREE.MeshLambertMaterial {
  const color = displayColor(src, floor);
  const key = color.getHexString();
  let mat = lambertCache.get(key);
  if (!mat) {
    mat = new THREE.MeshLambertMaterial({ color, name: src.name });
    lambertCache.set(key, mat);
  }
  src.dispose();
  return mat;
}

/** `floor` lifts near-black colours (gunmetal) so they keep some shading. */
export function convertMaterials(root: THREE.Object3D, floor = 0): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => toLambert(m, floor)) : toLambert(mesh.material, floor);
  });
}
