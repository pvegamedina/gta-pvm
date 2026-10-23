// Grouped low-poly weapon meshes (slide/barrel/sights for the pistol,
// stock/handguard/carry-handle for the M4) attached to a human rig's right
// hand, plus the arm pose used while armed/aiming. Shared by the local
// player and remote players.

import * as THREE from "three";
import type { WeaponId } from "@shared/protocol";
import type { HumanRig } from "../player/human";
import { gunmetal, accentMat } from "./weaponTextures";

function buildPistolMesh(): THREE.Group {
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

  return g;
}

function buildM4Mesh(): THREE.Group {
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

  return g;
}

export interface WeaponMeshHandle {
  group: THREE.Group;
  weapon: WeaponId;
}

/** Attaches the weapon mesh for `weapon` to `rig`'s right hand; removes any previous one. */
export function setHeldWeapon(rig: HumanRig, prev: WeaponMeshHandle | null, weapon: WeaponId): WeaponMeshHandle | null {
  if (prev) rig.rArm.children[0]?.remove(prev.group);
  const handGroup = rig.rArm.children[0] as THREE.Object3D | undefined; // the hand mesh added in makeHuman
  if (weapon === "fists" || !handGroup) return null;
  const group = weapon === "pistol" ? buildPistolMesh() : buildM4Mesh();
  group.rotation.y = Math.PI / 2;
  handGroup.add(group);
  return { group, weapon };
}

/** Raises the arms into an aiming pose; blends back to the walk pose when not aiming/armed. */
export function applyAimPose(rig: HumanRig, aiming: boolean, armed: boolean): void {
  if (aiming && armed) {
    rig.rArm.rotation.x = -1.55;
    rig.rArm.rotation.z = 0;
    rig.lArm.rotation.x = -1.45;
    rig.lArm.rotation.z = 0.25;
    rig.torso.rotation.x = 0.05;
  }
}
