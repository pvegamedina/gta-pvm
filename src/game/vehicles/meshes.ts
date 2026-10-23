// Vehicle meshes: merged body/glass/lights geometry per type, wheel pivots, and
// the runtime Vehicle record used by both player physics and traffic AI.

import * as THREE from "three";
import { lam } from "../world/materials";
import { TYPES, type VehicleSpec, type VehicleTypeKey } from "./types";

export type VehicleMode = "player" | "ai" | "parked";

export interface TrafficAiState {
  dx: number;
  dz: number;
  ix: number;
  iz: number;
  turn: TurnGeom | null;
  dec: "S" | "L" | "R" | null;
  cruise: number;
  acc: number;
  stuck: number;
  ghost: number;
}

export interface TurnGeom {
  nx: number;
  nz: number;
  P: { x: number; z: number };
  S: { x: number; z: number };
  T: { x: number; z: number };
  r: number;
  nix: number;
  niz: number;
  u: number;
}

export interface Vehicle {
  type: VehicleTypeKey;
  spec: VehicleSpec;
  root: THREE.Group;
  body: THREE.Group;
  tailMat: THREE.MeshLambertMaterial;
  wheels: THREE.Mesh[];
  pivots: THREE.Group[];
  x: number;
  z: number;
  y: number;
  yaw: number;
  vx: number;
  vz: number;
  speed: number;
  steer: number;
  steerVis: number;
  spin: number;
  mode: VehicleMode;
  braking: boolean;
  ai: TrafficAiState | null;
  pitch: number;
  roll: number;
  prevF: number;
  color: number;
  /** Network id when this is another player's vehicle (local vehicles leave this null). */
  remoteOwnerId?: string;
}

function mergeGeos(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const ng = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  ng.forEach((g) => (n += g.attributes.position.count));
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  let o = 0;
  ng.forEach((g) => {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    o += g.attributes.position.count;
  });
  const m = new THREE.BufferGeometry();
  m.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  m.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  return m;
}

interface CarGeos {
  body: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  tail: THREE.BufferGeometry;
}

const carGeoCache: Partial<Record<VehicleTypeKey, CarGeos>> = {};
const wheelGeoCache: Record<number, THREE.CylinderGeometry> = {};
export const glassMat = lam(0x1a2c3c);
export const tireMats = [lam(0x151515), lam(0x9a9a9a), lam(0x9a9a9a)];
export const headMat = new THREE.MeshLambertMaterial({ color: 0xfff2c0, emissive: 0xfff2c0, emissiveIntensity: 0.3 });

function carGeos(tk: VehicleTypeKey): CarGeos {
  const cached = carGeoCache[tk];
  if (cached) return cached;
  const s = TYPES[tk];
  const body: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const head: THREE.BufferGeometry[] = [];
  const tail: THREE.BufferGeometry[] = [];
  body.push(new THREE.BoxGeometry(s.W, s.bh, s.L).translate(0, s.by + s.bh / 2, 0));
  body.push(new THREE.BoxGeometry(s.W + 0.04, 0.2, 0.16).translate(0, s.by + 0.12, s.L / 2));
  body.push(new THREE.BoxGeometry(s.W + 0.04, 0.2, 0.16).translate(0, s.by + 0.12, -s.L / 2));
  if (s.cargo) body.push(new THREE.BoxGeometry(s.W * 0.98, s.cargo.h, s.cargo.l).translate(0, s.by + s.bh + s.cargo.h / 2, -s.L / 2 + s.cargo.l / 2 + 0.05));
  const cg = new THREE.BoxGeometry(s.W * 0.9, s.ch, s.cl);
  const pos = cg.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) {
      if (pos.getZ(i) > 0) pos.setZ(i, pos.getZ(i) - s.slope);
      else pos.setZ(i, pos.getZ(i) + s.slope * 0.5);
    }
  }
  cg.computeVertexNormals();
  cg.translate(0, s.by + s.bh + s.ch / 2, s.cz);
  glass.push(cg);
  body.push(new THREE.BoxGeometry(s.W * 0.88, 0.06, s.cl - s.slope * 1.5).translate(0, s.by + s.bh + s.ch + 0.03, s.cz - s.slope * 0.25));
  if (s.spoiler) body.push(new THREE.BoxGeometry(s.W * 0.9, 0.08, 0.4).translate(0, s.by + s.bh + 0.35, -s.L / 2 + 0.2));
  if (s.sign) head.push(new THREE.BoxGeometry(0.7, 0.2, 0.3).translate(0, s.by + s.bh + s.ch + 0.18, s.cz - s.slope * 0.25));
  const hx = s.W / 2 - 0.35;
  const hy = s.by + s.bh * 0.6;
  head.push(
    new THREE.BoxGeometry(0.32, 0.16, 0.06).translate(hx, hy, s.L / 2 + 0.01),
    new THREE.BoxGeometry(0.32, 0.16, 0.06).translate(-hx, hy, s.L / 2 + 0.01),
  );
  tail.push(
    new THREE.BoxGeometry(0.4, 0.14, 0.06).translate(hx, hy, -s.L / 2 - 0.01),
    new THREE.BoxGeometry(0.4, 0.14, 0.06).translate(-hx, hy, -s.L / 2 - 0.01),
  );
  return (carGeoCache[tk] = { body: mergeGeos(body), glass: mergeGeos(glass), head: mergeGeos(head), tail: mergeGeos(tail) });
}

function wheelGeo(wr: number): THREE.CylinderGeometry {
  return wheelGeoCache[wr] || (wheelGeoCache[wr] = new THREE.CylinderGeometry(wr, wr, 0.28, 14).rotateZ(Math.PI / 2));
}

export function addVeh(scene: THREE.Scene, tk: VehicleTypeKey, color: number, x: number, z: number, yaw: number, mode: VehicleMode): Vehicle {
  const s = TYPES[tk];
  const cg = carGeos(tk);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const bm = new THREE.Mesh(cg.body, lam(tk === "taxi" ? 0xf2c500 : color));
  bm.castShadow = true;
  body.add(bm);
  body.add(new THREE.Mesh(cg.glass, glassMat));
  body.add(new THREE.Mesh(cg.head, headMat));
  const tailMat = new THREE.MeshLambertMaterial({ color: 0x550000, emissive: 0xff1111, emissiveIntensity: 0.3 });
  body.add(new THREE.Mesh(cg.tail, tailMat));
  const wheels: THREE.Mesh[] = [];
  const pivots: THREE.Group[] = [];
  ([
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ] as [number, number][]).forEach((p) => {
    const piv = new THREE.Group();
    piv.position.set(p[0] * (s.W / 2 - 0.1), s.wr, (p[1] * s.wb) / 2);
    const w = new THREE.Mesh(wheelGeo(s.wr), tireMats);
    piv.add(w);
    root.add(piv);
    wheels.push(w);
    if (p[1] > 0) pivots.push(piv);
  });
  scene.add(root);
  const v: Vehicle = {
    type: tk,
    spec: s,
    root,
    body,
    tailMat,
    wheels,
    pivots,
    x,
    z,
    y: 0,
    yaw,
    vx: 0,
    vz: 0,
    speed: 0,
    steer: 0,
    steerVis: 0,
    spin: 0,
    mode,
    braking: false,
    ai: null,
    pitch: 0,
    roll: 0,
    prevF: 0,
    color,
  };
  root.position.set(x, 0, z);
  root.rotation.y = yaw;
  return v;
}

export function visualVeh(v: Vehicle, dt: number, nightF: number): void {
  v.root.position.set(v.x, v.y, v.z);
  v.root.rotation.y = v.yaw;
  v.spin += (v.speed * dt) / v.spec.wr;
  for (let i = 0; i < 4; i++) v.wheels[i].rotation.x = v.spin;
  v.pivots[0].rotation.y = v.steerVis;
  v.pivots[1].rotation.y = v.steerVis;
  v.body.rotation.x = v.pitch;
  v.body.rotation.z = v.roll;
  v.tailMat.emissiveIntensity = 0.25 + nightF * 0.6 + (v.braking ? 1.8 : 0);
}

export function removeVeh(scene: THREE.Scene, v: Vehicle): void {
  scene.remove(v.root);
}
