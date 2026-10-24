// Loads the character and weapon GLBs once (GLTFLoader + meshopt decoder),
// converts their PBR materials to the game's flat Lambert look, hides the
// props baked into some characters (Pistol/Sword) and prepares the weapon
// templates. Rigs clone from these sources (see characters/modelRig.ts).

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { CHARACTER_IDS, type CharacterId } from "../characters/characterChoice";
import { prepareWeaponTemplate, liftColor, WEAPON_POSES, type GunId } from "../characters/weaponPose";

export interface CharacterSource {
  /** Skinned source scene; never added to the world — instance it with SkeletonUtils.clone. */
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
}

export interface CharacterAssets {
  characters: Record<CharacterId, CharacterSource>;
  /** Weapon templates oriented for the Wrist.R socket; `.clone()` them per holder. */
  weapons: Record<GunId, THREE.Group>;
}

const BASE_URL = "/models";
/** Props embedded in some character GLBs — we attach our own guns instead. */
const EMBEDDED_PROPS = new Set(["Pistol", "Sword"]);

const lambertCache = new Map<string, THREE.MeshLambertMaterial>();

/**
 * glTF colour factors are linear, but the game renders with colour
 * management off and a linear output (see game.ts), i.e. material colours are
 * used as display values. Converting to sRGB keeps the authored look instead
 * of rendering everything too dark.
 */
function toLambert(src: THREE.Material, floor = 0): THREE.MeshLambertMaterial {
  const color = liftColor(((src as THREE.MeshStandardMaterial).color ?? new THREE.Color(1, 1, 1)).clone().convertLinearToSRGB(), floor);
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
function convertMaterials(root: THREE.Object3D, floor = 0): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => toLambert(m, floor)) : toLambert(mesh.material, floor);
  });
}

function removeEmbeddedProps(root: THREE.Object3D): void {
  const props: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (EMBEDDED_PROPS.has(o.name)) props.push(o);
  });
  for (const p of props) p.removeFromParent();
}

function createLoader(): GLTFLoader {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

async function loadAll(): Promise<CharacterAssets> {
  const loader = createLoader();
  const charEntries = CHARACTER_IDS.map(async (id) => {
    const gltf = await loader.loadAsync(`${BASE_URL}/characters/${id}.glb`);
    removeEmbeddedProps(gltf.scene);
    convertMaterials(gltf.scene);
    return [id, { scene: gltf.scene, clips: gltf.animations }] as const;
  });
  const weaponEntries = (Object.keys(WEAPON_POSES) as GunId[]).map(async (id) => {
    const gltf = await loader.loadAsync(`${BASE_URL}/weapons/${WEAPON_POSES[id].file}.glb`);
    convertMaterials(gltf.scene, WEAPON_POSES[id].colorFloor);
    gltf.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    return [id, prepareWeaponTemplate(gltf.scene, id)] as const;
  });
  const [characters, weapons] = await Promise.all([Promise.all(charEntries), Promise.all(weaponEntries)]);
  return {
    characters: Object.fromEntries(characters) as Record<CharacterId, CharacterSource>,
    weapons: Object.fromEntries(weapons) as Record<GunId, THREE.Group>,
  };
}

let pending: Promise<CharacterAssets> | null = null;

/** Loads (once per page) every character + weapon model. Rejects if any file fails; a later call retries. */
export function loadCharacterAssets(): Promise<CharacterAssets> {
  if (!pending) {
    pending = loadAll().catch((err) => {
      pending = null;
      throw err;
    });
  }
  return pending;
}
