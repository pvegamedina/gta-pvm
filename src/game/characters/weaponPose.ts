// How the GLB weapon models sit in a character's hand: which file, scale,
// grip point, barrel height and orientation relative to the Quaternius
// "Wrist.R" bone. The bone's +Y runs along the fingers (forward while aiming)
// and its -X points up, while the weapon models (Quaternius Ultimate Gun Pack
// via obj2gltf) are authored barrel-along-+X / sights-up-+Y at arbitrary
// scale and pivot — so the template is rotated +90° about Z, shrunk to hand
// size, and the grip/muzzle are expressed as fractions of the model's bounding
// box. Swapping a model is a config change here (file + fractions + length).

import * as THREE from "three";
import type { WeaponId } from "@shared/protocol";

export type GunId = Exclude<WeaponId, "fists">;

/** Name of the empty Object3D marking the barrel tip (bullets/flash spawn there). */
export const MUZZLE_NAME = "muzzle";

export interface WeaponPose {
  /** GLB basename under /models/weapons/. */
  file: string;
  /** Desired in-hand length in metres (the model's X extent is scaled to it). */
  length: number;
  /** Where the hand wraps the grip, as fractions (0..1) of the model's bbox: x along the barrel (0 = butt), y up, z across. */
  gripFrac: readonly [number, number, number];
  /** Height of the bore at the front face, as a fraction of the bbox height. */
  muzzleFracY: number;
  /** Where that grip point lands in the wrist bone's local space (m). */
  handOffset: [number, number, number];
  /** Euler rotation (wrist space) applied to the model. */
  rotation: [number, number, number];
  /** Minimum display brightness of the (near-black) materials so they don't read as flat black blobs. */
  colorFloor: number;
}

export const WEAPON_POSES: Record<GunId, WeaponPose> = {
  // Ultimate Gun Pack "Pistol_5" (polymer pistol): ~1.82 x 1.20 x 0.27 units.
  pistol: {
    file: "pistol",
    length: 0.24,
    gripFrac: [0.2, 0.55, 0.5],
    muzzleFracY: 0.86,
    // Tuned visually: grip column inside the fist, index finger by the trigger.
    handOffset: [-0.03, 0.1, -0.02],
    rotation: [0, 0, Math.PI / 2],
    colorFloor: 0.16,
  },
  // Ultimate Gun Pack "AssaultRifle2_1" (M4A1 with carry handle): ~5.17 x 1.79 x 0.35 units.
  m4: {
    file: "rifle",
    length: 0.86,
    gripFrac: [0.29, 0.48, 0.5],
    muzzleFracY: 0.76,
    // Tuned visually: pistol grip in the fist (receiver above the hand, magazine ahead of it).
    handOffset: [-0.045, 0.02, -0.02],
    rotation: [0, 0, Math.PI / 2],
    colorFloor: 0.16,
  },
};

/**
 * Lifts a display colour whose brightest channel is below `floor` by adding
 * the difference to every channel (keeps the hue tint). Returns `c`.
 */
export function liftColor(c: THREE.Color, floor: number): THREE.Color {
  const max = Math.max(c.r, c.g, c.b);
  if (max >= floor) return c;
  const d = floor - max;
  return c.setRGB(c.r + d, c.g + d, c.b + d);
}

/**
 * Wraps a loaded weapon scene into a template group ready to be cloned under
 * a Wrist.R socket: scaled to `pose.length` along its X extent, grip moved to
 * `pose.handOffset`, barrel/sights rotated into the wrist frame, plus a
 * MUZZLE_NAME marker at the barrel tip.
 */
export function prepareWeaponTemplate(source: THREE.Object3D, weapon: GunId): THREE.Group {
  const pose = WEAPON_POSES[weapon];
  source.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(source);
  const size = box.getSize(new THREE.Vector3());
  const scale = pose.length / Math.max(1e-6, size.x);
  const at = (f: readonly [number, number, number]) => new THREE.Vector3(box.min.x + f[0] * size.x, box.min.y + f[1] * size.y, box.min.z + f[2] * size.z);
  const grip = at(pose.gripFrac);

  // offset: scales the model and moves its grip point onto the holder origin.
  const offset = new THREE.Group();
  offset.scale.setScalar(scale);
  offset.position.copy(grip).multiplyScalar(-scale);
  offset.add(source);
  // Barrel tip: front face of the model, at the bore height, centred across.
  const muzzle = new THREE.Object3D();
  muzzle.name = MUZZLE_NAME;
  muzzle.position.copy(at([1, pose.muzzleFracY, 0.5]));
  offset.add(muzzle);

  // holder: orients the model in the wrist frame and places the grip in the palm.
  const holder = new THREE.Group();
  holder.name = `weapon:${weapon}`;
  holder.rotation.set(...pose.rotation);
  holder.position.set(...pose.handOffset);
  holder.add(offset);
  return holder;
}
