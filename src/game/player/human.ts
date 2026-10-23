// Low-poly human mesh (torso/head/limbs) shared by the local player, remote
// players and pedestrians. Exposes limb groups for walk/aim pose animation.

import * as THREE from "three";
import { lam } from "../world/materials";
import { fabricMat } from "./humanTextures";

export interface HumanColors {
  skin: number;
  shirt: number;
  pants: number;
  hair: number;
  shoe: number;
}

export interface HumanRig {
  group: THREE.Group;
  lLeg: THREE.Group;
  rLeg: THREE.Group;
  lArm: THREE.Group;
  rArm: THREE.Group;
  /** Right hand (child of rArm, at the end of the arm) — held weapons attach here. */
  rHand: THREE.Group;
  torso: THREE.Mesh;
}

/** Adds a wrist accent + a two-part shoe (sole + upper) onto an existing limb mesh. */
function addLegDetail(legMesh: THREE.Mesh, shoeMat: THREE.Material, soleMat: THREE.Material): void {
  const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.22), shoeMat);
  cuff.position.set(0, -0.41, 0.01);
  legMesh.add(cuff);
  const sole = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.035, 0.31), soleMat);
  sole.position.set(0, -0.455, 0.045);
  legMesh.add(sole);
  const upper = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.08, 0.26), shoeMat);
  upper.position.set(0, -0.415, 0.03);
  legMesh.add(upper);
}

/**
 * Adds a wrist accent (nested inside the arm mesh) plus a hand (palm + thumb)
 * as a sibling of the arm mesh. Returns the hand so weapons can be held in it.
 */
function addArmDetail(armGroup: THREE.Group, armMesh: THREE.Mesh, skin: THREE.Material): THREE.Group {
  const wrist = new THREE.Mesh(new THREE.BoxGeometry(0.135, 0.06, 0.155), skin);
  wrist.position.y = -0.26;
  armMesh.add(wrist);

  const hand = new THREE.Group();
  hand.position.y = -0.62;
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.11, 0.15), skin);
  hand.add(palm);
  const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.08), skin);
  thumb.position.set(0.09, 0.02, 0.03);
  hand.add(thumb);
  armGroup.add(hand);
  return hand;
}

export function makeHuman(c: HumanColors): HumanRig {
  const g = new THREE.Group();
  const skin = lam(c.skin);
  const shirt = fabricMat(c.shirt);
  const pants = fabricMat(c.pants);
  const shoeMat = lam(c.shoe);
  const soleMat = lam(0x111111);

  // Torso: tapered chest + waist (waist is a child of torso, so it leans with
  // it), with small shoulder caps bridging to the arm pivots.
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.4, 0.26), shirt);
  torso.position.y = 1.31;
  g.add(torso);

  const waist = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.24, 0.24), pants);
  waist.position.set(0, -0.32, 0);
  torso.add(waist);

  const shoulderGeo = new THREE.BoxGeometry(0.09, 0.13, 0.24);
  [-1, 1].forEach((side) => {
    const cap = new THREE.Mesh(shoulderGeo, shirt);
    cap.position.set(side * 0.27, 0.16, 0);
    torso.add(cap);
  });

  // Neck bridges the torso top to the head.
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.08, 6), skin);
  neck.position.y = 1.53;
  g.add(neck);

  // Head: cranium + smaller jaw, less cube-like than a single box.
  const head = new THREE.Group();
  head.position.y = 1.67;
  g.add(head);
  const cranium = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.17, 0.21), skin);
  cranium.position.y = 0.05;
  head.add(cranium);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.09, 0.18), skin);
  jaw.position.set(0, -0.08, 0.01);
  head.add(jaw);
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.235, 0.1, 0.22), lam(c.hair));
  hair.position.set(0, 0.125, -0.01);
  head.add(hair);

  const mk = (x: number, y: number, geo: THREE.BufferGeometry, mat: THREE.Material, oy: number): [THREE.Group, THREE.Mesh] => {
    const p = new THREE.Group();
    p.position.set(x, y, 0);
    const m = new THREE.Mesh(geo, mat);
    m.position.y = oy;
    p.add(m);
    g.add(p);
    return [p, m];
  };

  const [lLeg, lLegMesh] = mk(-0.11, 0.88, new THREE.BoxGeometry(0.19, 0.86, 0.21), pants, -0.43);
  const [rLeg, rLegMesh] = mk(0.11, 0.88, new THREE.BoxGeometry(0.19, 0.86, 0.21), pants, -0.43);
  addLegDetail(lLegMesh, shoeMat, soleMat);
  addLegDetail(rLegMesh, shoeMat, soleMat);

  const [lArm, lArmMesh] = mk(-0.3, 1.47, new THREE.BoxGeometry(0.13, 0.56, 0.15), shirt, -0.27);
  const [rArm, rArmMesh] = mk(0.3, 1.47, new THREE.BoxGeometry(0.13, 0.56, 0.15), shirt, -0.27);
  addArmDetail(lArm, lArmMesh, skin);
  const rHand = addArmDetail(rArm, rArmMesh, skin);

  return { group: g, lLeg, rLeg, lArm, rArm, rHand, torso };
}

export function randomPedColors(): HumanColors {
  const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  return {
    skin: pick([0xe0ac84, 0xc68642, 0x8d5524, 0xf1c27d]),
    shirt: pick([0x3a86ff, 0xff006e, 0xffbe0b, 0x8338ec, 0x2ec4b6, 0x999999, 0xe9e9e9, 0x333333]),
    pants: pick([0x2b3a55, 0x333333, 0x6b4a2b, 0x4a5a3a]),
    hair: pick([0x111111, 0x3a2a1a, 0x8a6a3a, 0xaaaaaa]),
    shoe: 0x222222,
  };
}
