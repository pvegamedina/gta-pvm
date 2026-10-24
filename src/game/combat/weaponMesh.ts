// Held-weapon attachment for character rigs, plus the grouped low-poly
// procedural weapon meshes (slide/barrel/sights for the pistol, stock/
// handguard/carry-handle for the M4) and arm aim pose used by the procedural
// human fallback. Model rigs attach the GLB weapons through the same
// setHeldWeapon() with their own builder (see characters/modelRig.ts).

import * as THREE from "three";
import type { WeaponId } from "@shared/protocol";
import type { HumanRig } from "../player/human";
import { MUZZLE_NAME, type GunId } from "../characters/weaponPose";
import { gunmetal, accentMat } from "./weaponTextures";

/** Weapon model built barrel-along-+Z / sights-up-+Y, plus its grip so it can be placed in a hand. */
interface WeaponModel {
  group: THREE.Group;
  grip: THREE.Object3D;
}

function buildPistolMesh(): WeaponModel {
  const g = new THREE.Group();
  const body = gunmetal(0x1c1c1e);
  const dark = accentMat(0x0c0c0d);
  const light = accentMat(0x55555a);

  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.055, 0.2), body);
  slide.position.set(0, 0.035, 0.05);
  g.add(slide);

  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.05, 0.14), dark);
  frame.position.set(0, -0.015, 0.02);
  g.add(frame);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.05, 8), light);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.035, 0.17);
  g.add(barrel);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.1, 0.055), dark);
  grip.position.set(0, -0.09, -0.02);
  grip.rotation.x = -0.12;
  g.add(grip);

  const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.025, 0.012), light);
  trigger.position.set(0, -0.035, 0.015);
  g.add(trigger);

  // Trigger guard built from two thin bars (front + bottom) to read as a loop.
  const guardFront = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.045, 0.008), dark);
  guardFront.position.set(0, -0.055, 0.045);
  g.add(guardFront);
  const guardBottom = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.07), dark);
  guardBottom.position.set(0, -0.075, 0.012);
  g.add(guardBottom);

  const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.016, 0.012), light);
  rearSight.position.set(0, 0.07, -0.03);
  g.add(rearSight);
  const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.015, 0.01), light);
  frontSight.position.set(0, 0.068, 0.145);
  g.add(frontSight);

  return { group: g, grip };
}

function buildM4Mesh(): WeaponModel {
  const g = new THREE.Group();
  const body = gunmetal(0x2b2b28);
  const dark = accentMat(0x15150f);
  const light = accentMat(0x4a4a3e);

  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.3), body);
  receiver.position.set(0, 0, 0.05);
  g.add(receiver);

  const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.06, 0.22), dark);
  handguard.position.set(0, -0.005, 0.28);
  g.add(handguard);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.16, 8), light);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0, 0.45);
  g.add(barrel);

  const frontSightPost = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.05, 0.012), dark);
  frontSightPost.position.set(0, 0.06, 0.4);
  g.add(frontSightPost);

  // Carry handle + top rail — the silhouette detail that reads as "rifle".
  const carryHandle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.22), dark);
  carryHandle.position.set(0, 0.07, 0.02);
  g.add(carryHandle);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.015, 0.3), light);
  rail.position.set(0, 0.045, 0.05);
  g.add(rail);

  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.22, 0.075), dark);
  mag.position.set(0, -0.15, 0.03);
  mag.rotation.x = 0.28;
  g.add(mag);

  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.065, 0.24), body);
  stock.position.set(0, -0.005, -0.27);
  g.add(stock);
  const buttpad = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.08, 0.02), dark);
  buttpad.position.set(0, -0.005, -0.39);
  g.add(buttpad);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.045), dark);
  grip.position.set(0, -0.1, -0.03);
  grip.rotation.x = -0.15;
  g.add(grip);

  const selector = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.012, 0.012), light);
  selector.position.set(0.033, -0.01, -0.05);
  g.add(selector);

  return { group: g, grip };
}

export interface WeaponMeshHandle {
  group: THREE.Object3D;
  weapon: WeaponId;
}

/** Builds a gun model already oriented/offset for the socket it will be attached to. */
export type WeaponBuilder = (weapon: GunId) => THREE.Object3D;

/** Barrel tip (model space, barrel along +Z) of each procedural gun. */
const PROCEDURAL_MUZZLE_Z: Record<GunId, number> = { pistol: 0.195, m4: 0.53 };

/** Procedural pistol/M4 positioned for the procedural human's right hand (HumanRig.rHand). */
export function buildProceduralWeapon(weapon: GunId): THREE.Object3D {
  const { group, grip } = weapon === "pistol" ? buildPistolMesh() : buildM4Mesh();
  const muzzle = new THREE.Object3D();
  muzzle.name = MUZZLE_NAME;
  muzzle.position.set(0, weapon === "pistol" ? 0.035 : 0, PROCEDURAL_MUZZLE_Z[weapon]);
  group.add(muzzle);
  // The arm hangs along its local -Y (palm facing +Z), so the barrel (+Z) is
  // turned to run along the arm and the sights (+Y) end up on top once the
  // arm is raised to aim.
  group.rotation.x = Math.PI / 2;
  // Shift the model so its grip sits in the palm (the hand group's origin).
  group.position.copy(grip.position).applyEuler(group.rotation).negate();
  return group;
}

/** Attaches the weapon built by `build` to `socket`; removes any previous one. Fists hold nothing. */
export function setHeldWeapon(
  socket: THREE.Object3D,
  prev: WeaponMeshHandle | null,
  weapon: WeaponId,
  build: WeaponBuilder,
): WeaponMeshHandle | null {
  prev?.group.removeFromParent();
  if (weapon === "fists") return null;
  const group = build(weapon);
  socket.add(group);
  return { group, weapon };
}

/**
 * Raises the procedural human's arms into an aiming pose (both hands on the
 * gun). When armed with a long gun but not aiming, holds it two-handed at low
 * ready (muzzle forward-down); the pistol's one-handed carry is left to the
 * walk cycle. No-op when unarmed.
 */
export function applyAimPose(rig: HumanRig, aiming: boolean, armed: boolean, weapon?: WeaponId): void {
  if (aiming && armed) {
    rig.rArm.rotation.x = -1.55;
    rig.rArm.rotation.z = 0;
    rig.lArm.rotation.x = -1.45;
    rig.lArm.rotation.z = 0.25;
    rig.torso.rotation.x = 0.05;
  } else if (armed && weapon === "m4") {
    rig.rArm.rotation.x = -0.95;
    rig.rArm.rotation.z = 0;
    rig.lArm.rotation.x = -1.15;
    rig.lArm.rotation.z = 0.4;
  }
}
