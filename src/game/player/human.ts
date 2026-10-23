// Low-poly human mesh (torso/head/limbs) shared by the local player, remote
// players and pedestrians. Exposes limb groups for walk/aim pose animation.

import * as THREE from "three";
import { lam } from "../world/materials";

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
  torso: THREE.Mesh;
}

export function makeHuman(c: HumanColors): HumanRig {
  const g = new THREE.Group();
  const skin = lam(c.skin);
  const shirt = lam(c.shirt);
  const pants = lam(c.pants);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.62, 0.26), shirt);
  torso.position.y = 1.2;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.24, 0.22), skin);
  head.position.y = 1.65;
  g.add(head);
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 0.25), lam(c.hair));
  hair.position.set(0, 1.77, -0.01);
  g.add(hair);
  const mk = (x: number, y: number, geo: THREE.BufferGeometry, mat: THREE.Material, oy: number): THREE.Group => {
    const p = new THREE.Group();
    p.position.set(x, y, 0);
    const m = new THREE.Mesh(geo, mat);
    m.position.y = oy;
    p.add(m);
    g.add(p);
    return p;
  };
  const lLeg = mk(-0.11, 0.88, new THREE.BoxGeometry(0.19, 0.86, 0.21), pants, -0.43);
  const rLeg = mk(0.11, 0.88, new THREE.BoxGeometry(0.19, 0.86, 0.21), pants, -0.43);
  const shoe = new THREE.BoxGeometry(0.2, 0.08, 0.3);
  [lLeg, rLeg].forEach((l) => {
    const s = new THREE.Mesh(shoe, lam(c.shoe));
    s.position.set(0, -0.84, 0.04);
    l.add(s);
  });
  const lArm = mk(-0.3, 1.47, new THREE.BoxGeometry(0.13, 0.56, 0.15), shirt, -0.27);
  const rArm = mk(0.3, 1.47, new THREE.BoxGeometry(0.13, 0.56, 0.15), shirt, -0.27);
  [lArm, rArm].forEach((a) => {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.14), skin);
    h.position.y = -0.6;
    a.add(h);
  });
  return { group: g, lLeg, rLeg, lArm, rArm, torso };
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
