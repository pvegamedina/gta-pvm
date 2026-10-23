// Ground plane, road strips and lane-dash markings.

import * as THREE from "three";
import { G, P, ROAD, HALF, rc } from "../core/constants";
import { lam, inst, polyMat } from "./materials";

export function buildGround(scene: THREE.Scene): void {
  const g = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), lam(0x4c7a3a));
  g.rotation.x = -Math.PI / 2;
  g.position.y = -0.02;
  g.receiveShadow = true;
  scene.add(g);

  const len = G * P + ROAD;
  const roadM = lam(0x34373d);
  for (let i = 0; i <= G; i++) {
    const a = new THREE.Mesh(new THREE.PlaneGeometry(len, ROAD), roadM);
    a.rotation.x = -Math.PI / 2;
    a.position.set(0, 0.03, rc(i));
    a.receiveShadow = true;
    scene.add(a);
    const b = new THREE.Mesh(new THREE.PlaneGeometry(ROAD, len), roadM);
    b.rotation.x = -Math.PI / 2;
    b.position.set(rc(i), 0.031, 0);
    b.receiveShadow = true;
    scene.add(b);
  }

  const whiteM = polyMat(0xe8e8e0);
  const dashes: { x: number; y: number; z: number; ry: number }[] = [];
  for (let axis = 0; axis < 2; axis++) {
    for (let r = 0; r <= G; r++) {
      for (let k = 0; k < G; k++) {
        const a0 = rc(k) + HALF + 5;
        const a1 = rc(k + 1) - HALF - 5;
        for (let a = a0; a < a1 - 2.6; a += 7) {
          dashes.push(
            axis === 0 ? { x: a + 1.3, y: 0.045, z: rc(r), ry: 0 } : { x: rc(r), y: 0.045, z: a + 1.3, ry: Math.PI / 2 },
          );
        }
      }
    }
  }
  inst(scene, new THREE.BoxGeometry(2.6, 0.02, 0.2), whiteM, dashes, false);
}
