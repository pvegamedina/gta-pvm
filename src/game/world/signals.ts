// Traffic signal poles/heads/lamps at every intersection, plus their G/Y/R state
// machine (shared by traffic AI and the player via `lightState`).

import * as THREE from "three";
import { G, HALF, DIRS, inR, rc } from "../core/constants";
import { lam, inst, polyMat } from "./materials";
import type { CollisionGrid } from "./colliders";
import { lightState } from "./environment";

type SignalColor = "R" | "Y" | "G";
const SIGC: Record<SignalColor, [number, number]> = { R: [0xff2a2a, 0x3a0808], Y: [0xffc21a, 0x3a2d05], G: [0x2aff5a, 0x063a14] };

export interface Signals {
  update(tod: number): void;
}

export function buildSignals(scene: THREE.Scene, grid: CollisionGrid): Signals {
  const poles: { x: number; y: number; z: number }[] = [];
  const heads: { x: number; y: number; z: number; ry: number }[] = [];
  const lamps: [{ x: number; y: number; z: number }[][], { x: number; y: number; z: number }[][]] = [
    [[], [], []],
    [[], [], []],
  ];
  const stripes: { x: number; y: number; z: number; ry: number }[] = [];
  const stops: { x: number; y: number; z: number; ry: number; sx: number }[] = [];

  for (let i = 0; i <= G; i++) {
    for (let j = 0; j <= G; j++) {
      const cx = rc(i);
      const cz = rc(j);
      for (const dv of DIRS) {
        const dx = dv[0];
        const dz = dv[1];
        if (!inR(i - dx, j - dz)) continue;
        const rx = -dz;
        const rz = dx;
        const axis = dx !== 0 ? 0 : 1;
        const px = cx - dx * (HALF + 1.0) + rx * (HALF + 0.9);
        const pz = cz - dz * (HALF + 1.0) + rz * (HALF + 0.9);
        const hy = 0.25 + 4.55;
        poles.push({ x: px, y: 2.45, z: pz });
        heads.push({ x: px, y: hy, z: pz, ry: Math.atan2(-dx, -dz) });
        [0.45, 0, -0.45].forEach((o, n) => lamps[axis][n].push({ x: px - dx * 0.24, y: hy + o, z: pz - dz * 0.24 }));
        grid.addCirc(px, pz, 0.2);
        for (let s = -7.8; s <= 7.81; s += 1.3) {
          stripes.push({ x: cx - dx * (HALF + 1.65) + rx * s, y: 0.05, z: cz - dz * (HALF + 1.65) + rz * s, ry: dx !== 0 ? 0 : Math.PI / 2 });
        }
        stops.push({ x: cx - dx * (HALF + 4.6) + rx * 4.5, y: 0.05, z: cz - dz * (HALF + 4.6) + rz * 4.5, ry: dx !== 0 ? Math.PI / 2 : 0, sx: 8 });
      }
    }
  }
  const wm = polyMat(0xe8e8e0);
  inst(scene, new THREE.BoxGeometry(2.7, 0.02, 0.55), wm, stripes, false);
  inst(scene, new THREE.BoxGeometry(1, 0.02, 0.4), wm, stops, false);
  inst(scene, new THREE.CylinderGeometry(0.1, 0.1, 4.4, 8), lam(0x444a50), poles, false);
  inst(scene, new THREE.BoxGeometry(0.5, 1.5, 0.42), lam(0x16181b), heads, false);
  const lg = new THREE.SphereGeometry(0.17, 8, 6);
  const keys: SignalColor[] = ["R", "Y", "G"];
  const sigMat: [Record<SignalColor, THREE.MeshBasicMaterial>, Record<SignalColor, THREE.MeshBasicMaterial>] = [
    {} as Record<SignalColor, THREE.MeshBasicMaterial>,
    {} as Record<SignalColor, THREE.MeshBasicMaterial>,
  ];
  for (let ax = 0; ax < 2; ax++) {
    for (let n = 0; n < 3; n++) {
      const key = keys[n];
      sigMat[ax][key] = new THREE.MeshBasicMaterial({ color: SIGC[key][1] });
      inst(scene, lg, sigMat[ax][key], lamps[ax][n], false);
    }
  }

  return {
    update(tod: number) {
      for (let ax = 0; ax < 2; ax++) {
        const st = lightState(tod, ax as 0 | 1);
        for (const k of keys) sigMat[ax][k].color.setHex(st === k ? SIGC[k][0] : SIGC[k][1]);
      }
    },
  };
}
