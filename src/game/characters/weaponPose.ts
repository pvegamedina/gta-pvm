// How the GLB weapon models sit in a character's hand: scale, grip point and
// orientation relative to the Quaternius "Wrist.R" bone. The bone's +Y runs
// along the fingers (forward while aiming) and its -X points up, while the
// Sci-Fi weapon models are authored barrel-along-+X / sights-up-+Y at display
// scale — so the template is rotated +90° about Z and shrunk to hand size.

import * as THREE from "three";
import type { WeaponId } from "@shared/protocol";

export type GunId = Exclude<WeaponId, "fists">;

/** Name of the empty Object3D marking the barrel tip (bullets/flash spawn there). */
export const MUZZLE_NAME = "muzzle";

export interface WeaponPose {
  /** Length of the source GLB along its X axis (model units), for reference/tests. */
  modelLength: number;
  /** Desired in-hand length in metres. */
  length: number;
  /** Where the hand wraps the grip, in source-model units (determined empirically). */
  grip: [number, number, number];
  /** Where that grip point lands in the wrist bone's local space (m). */
  handOffset: [number, number, number];
  /** Euler rotation (wrist space) applied to the model. */
  rotation: [number, number, number];
}

export const WEAPON_POSES: Record<GunId, WeaponPose> = {
  pistol: {
    modelLength: 0.934,
    length: 0.3,
    grip: [0.0, 0.05, 0],
    handOffset: [0.02, 0.07, -0.02],
    rotation: [0, 0, Math.PI / 2],
  },
  m4: {
    modelLength: 1.891,
    length: 0.85,
    grip: [-0.12, 0.02, 0],
    handOffset: [0.02, 0.07, -0.02],
    rotation: [0, 0, Math.PI / 2],
  },
};

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
  const scale = pose.length / Math.max(1e-6, box.max.x - box.min.x);

  // offset: scales the model and moves its grip point onto the holder origin.
  const offset = new THREE.Group();
  offset.scale.setScalar(scale);
  offset.position.set(-pose.grip[0] * scale, -pose.grip[1] * scale, -pose.grip[2] * scale);
  offset.add(source);
  // Barrel tip: front end of the model, at its vertical centre.
  const muzzle = new THREE.Object3D();
  muzzle.name = MUZZLE_NAME;
  muzzle.position.set(box.max.x, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2);
  offset.add(muzzle);

  // holder: orients the model in the wrist frame and places the grip in the palm.
  const holder = new THREE.Group();
  holder.name = `weapon:${weapon}`;
  holder.rotation.set(...pose.rotation);
  holder.position.set(...pose.handOffset);
  holder.add(offset);
  return holder;
}
