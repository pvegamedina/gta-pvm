// How the GLB weapon models sit in a character's hand: which file, scale,
// grip point, barrel height and orientation relative to the Quaternius
// "Wrist.R" bone. The bone's +Y runs along the fingers (forward while aiming)
// and its -X points up, while the weapon models (Quaternius Ultimate Gun Pack
// via obj2gltf) are authored barrel-along-+X / sights-up-+Y at arbitrary
// scale and pivot — so the template is rotated +90° about Z, shrunk to hand
// size, and the grip/muzzle are expressed as fractions of the model's bounding
// box. Swapping a model is a config change here (file + fractions + length).
//
// Each gun also describes how it is held with BOTH hands (driven by
// characters/gunHandling.ts with two-bone IK after the animation mixer): an
// aim stance (rifle shouldered, pistol isosceles) and an optional carry stance
// (rifle low-ready; the pistol keeps the animated one-handed carry), plus the
// support (left) hand placement on the gun.

import * as THREE from "three";
import type { WeaponId } from "@shared/protocol";

export type GunId = Exclude<WeaponId, "fists">;

/** Name of the empty Object3D marking the barrel tip (bullets/flash spawn there). */
export const MUZZLE_NAME = "muzzle";
/** Name of the empty Object3D marking where the support (left) palm grips the gun. */
export const SUPPORT_NAME = "support";

/**
 * Where the gun sits in a stance, expressed in the "stance frame": origin at
 * the right shoulder joint, x = character right, y = up, z = forward (the aim
 * direction, pitched with the camera when `followPitch`).
 */
export interface StancePose {
  /** Right palm / grip point relative to the right shoulder joint (m). */
  grip: [number, number, number];
  /** Barrel direction relative to the frame's forward (rad): pitch + = up, yaw + = towards the left, cant = roll about the barrel. */
  pitch: number;
  yaw: number;
  cant: number;
  /** Whether the stance frame pitches with the aim (true) or stays level (carry). */
  followPitch: boolean;
  /** Elbow pole hints (stance frame, relative to each shoulder joint, m). */
  rightElbow: [number, number, number];
  leftElbow: [number, number, number];
  /** Share of the aim pitch taken by the spine (the arms do the rest). */
  spinePitchShare: number;
  /** Torso twist (rad, + = turns left; negative blades the right shoulder back). */
  spineTwist: number;
}

/** Support (left) hand placement on the gun. */
export interface SupportHand {
  /** Contact point relative to the grip, gun frame (m): x along the barrel, y up, z to the gun's right. */
  offset: [number, number, number];
  /** Left-hand orientation relative to the gun frame (Euler XYZ, rad). The Quaternius
   * left wrist has +X along the thumb, +Y along the fingers and -Z out of the palm. */
  rotation: [number, number, number];
  /** Palm contact point in the left wrist bone's frame (m). */
  palm: [number, number, number];
  /** Finger curl per joint (rad) so the open animated hand closes around the gun. */
  curl: number;
}

/** Two-handed gun kick (scaled by WEAPON_FEEL[weapon].gunKick): barrel pitch about the grip (rad) and slide back (m). */
export interface TwoHandKick {
  pitch: number;
  back: number;
}

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
  /** Two-handed aim stance. */
  aim: StancePose;
  /** Two-handed carry stance when not aiming, or null to keep the animated one-handed carry. */
  carry: StancePose | null;
  support: SupportHand;
  kick: TwoHandKick;
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
    // Isosceles/weaver stance: both arms almost extended, gun just right of
    // the centre line at shoulder height (the camera sits over the right
    // shoulder), torso turned a touch so the short left arm can wrap the grip.
    aim: {
      grip: [-0.12, 0.0, 0.4],
      pitch: 0,
      yaw: 0,
      cant: 0,
      followPitch: true,
      rightElbow: [0.35, -1, 0],
      leftElbow: [-0.35, -1, 0],
      spinePitchShare: 0.45,
      spineTwist: -0.15,
    },
    carry: null,
    // Left palm wraps the right fist from the left side, fingers down over its front.
    // (thumb forward-up along the frame, fingers forward-down over the right fingers)
    support: { offset: [0.0, -0.025, -0.05], rotation: [Math.PI, 0, -0.6], palm: [0, 0.06, -0.025], curl: 0.55 },
    kick: { pitch: 0.3, back: 0.04 },
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
    // Shouldered: stock in the right shoulder pocket (the butt is ~0.25 m
    // behind the grip), barrel levelled along the aim, torso bladed so the
    // left hand reaches the handguard.
    aim: {
      grip: [-0.05, -0.03, 0.3],
      pitch: 0,
      yaw: 0,
      cant: 0,
      followPitch: true,
      rightElbow: [0.6, -0.5, -0.2],
      leftElbow: [-0.1, -1, 0.1],
      spinePitchShare: 0.5,
      spineTwist: -0.45,
    },
    // Low ready: stock tucked under the shoulder, muzzle down and inwards.
    carry: {
      grip: [-0.02, -0.26, 0.22],
      pitch: -0.6,
      yaw: 0.35,
      cant: 0,
      followPitch: false,
      rightElbow: [0.5, -1, -0.4],
      leftElbow: [-0.3, -1, 0.2],
      spinePitchShare: 0,
      spineTwist: -0.2,
    },
    // Left palm under the handguard, thumb along the barrel, fingers wrapping to the right.
    support: { offset: [0.2, 0.01, 0], rotation: [Math.PI / 2 + 0.35, 0, 0], palm: [0, 0.06, -0.03], curl: 0.45 },
    kick: { pitch: 0.06, back: 0.04 },
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
  // Support-hand contact: metres from the grip in the (unscaled) gun frame.
  const support = new THREE.Object3D();
  support.name = SUPPORT_NAME;
  support.position.set(...pose.support.offset);
  holder.add(support);
  return holder;
}
