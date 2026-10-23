// Simple box-built weapon meshes attached to a human rig's right hand, plus the
// arm pose used while armed/aiming. Shared by the local player and remote players.

import * as THREE from "three";
import type { WeaponId } from "@shared/protocol";
import { lam } from "../world/materials";
import type { HumanRig } from "../player/human";

function buildPistolMesh(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.18), lam(0x1c1c1e));
  body.position.set(0, -0.02, 0.05);
  g.add(body);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.1, 0.06), lam(0x2a2a2a));
  grip.position.set(0, -0.09, -0.02);
  g.add(grip);
  return g;
}

function buildM4Mesh(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.55), lam(0x2b2b28));
  body.position.set(0, 0, 0.2);
  g.add(body);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.2, 0.07), lam(0x1a1a1a));
  mag.position.set(0, -0.14, 0.08);
  mag.rotation.x = 0.25;
  g.add(mag);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.22), lam(0x3a3a36));
  stock.position.set(0, -0.01, -0.22);
  g.add(stock);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.1), lam(0x111111));
  sight.position.set(0, 0.06, 0.15);
  g.add(sight);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.04), lam(0x2a2a2a));
  grip.position.set(0, -0.1, -0.02);
  g.add(grip);
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
