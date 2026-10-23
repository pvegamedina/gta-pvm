// Procedural buildings, parks, plazas and parking lots. Call order of rng() must
// stay identical to the legacy game so every client reproduces the same city.

import * as THREE from "three";
import { G, BLOCK, SPECIAL, bc, WORLD } from "../core/constants";
import type { Rng } from "../core/rng";
import { lam, inst } from "./materials";
import type { CollisionGrid } from "./colliders";
import type { CityState } from "./cityState";
import type { Environment } from "./environment";
import type { ShootableRegistry } from "../combat/shootables";

const facade: ({ map: THREE.CanvasTexture; lit: THREE.CanvasTexture } | null)[] = [null, null, null];
const bMatCache: Record<string, THREE.MeshLambertMaterial> = {};
const PAL = [
  [0xf2e3c6, 0xe9c9a0, 0xd9b8a0, 0xc9d6c3, 0xe6e0d8, 0xd6a79a],
  [0x9fb4c8, 0x7e93a6, 0xb8c4cf, 0x6f8294, 0xa8b6a8],
  [0xd8cdb8, 0xcfb8a0, 0xb8b8c0, 0xd6c0b0, 0xc4d0d6],
];

function facadeTex(kind: number, lit: boolean, rng: Rng): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d")!;
  x.fillStyle = lit ? "#000" : kind === 1 ? "#c9d3dc" : "#ffffff";
  x.fillRect(0, 0, 128, 128);
  for (let r = 0; r < 4; r++) {
    for (let cc = 0; cc < 4; cc++) {
      const px = cc * 32;
      const py = r * 32;
      let wx: number, wy: number, ww: number, wh: number;
      if (kind === 0) {
        wx = px + 7;
        wy = py + 8;
        ww = 18;
        wh = 16;
      } else if (kind === 1) {
        wx = px + 1;
        wy = py + 5;
        ww = 30;
        wh = 20;
      } else {
        wx = px + 4;
        wy = py + 6;
        ww = 24;
        wh = 20;
      }
      if (lit) {
        if (rng.rnd() < 0.4) {
          x.fillStyle = rng.pick(["#ffd98a", "#ffe7b0", "#fff1d0", "#9fd0ff"]);
          x.fillRect(wx, wy, ww, wh);
        }
      } else {
        x.fillStyle = kind === 1 ? "#2c4a66" : "#2a3a4c";
        x.fillRect(wx, wy, ww, wh);
        x.fillStyle = "rgba(255,255,255,0.18)";
        x.beginPath();
        x.moveTo(wx, wy + wh);
        x.lineTo(wx + ww * 0.5, wy);
        x.lineTo(wx + ww * 0.8, wy);
        x.lineTo(wx + ww * 0.3, wy + wh);
        x.fill();
        if (kind !== 1) {
          x.fillStyle = "rgba(0,0,0,0.25)";
          x.fillRect(wx - 1, wy + wh, ww + 2, 2);
        }
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function bMat(kind: number, color: number, rng: Rng, env: Environment): THREE.MeshLambertMaterial {
  if (!facade[kind]) facade[kind] = { map: facadeTex(kind, false, rng), lit: facadeTex(kind, true, rng) };
  const k = kind + "_" + color;
  if (!bMatCache[k]) {
    const f = facade[kind]!;
    const m = new THREE.MeshLambertMaterial({ color, map: f.map, emissive: 0xffffff, emissiveMap: f.lit, emissiveIntensity: 0 });
    bMatCache[k] = m;
    env.registerBuildingMat(m);
  }
  return bMatCache[k];
}

let buildingIdCounter = 0;

function addBuilding(
  scene: THREE.Scene,
  grid: CollisionGrid,
  rng: Rng,
  env: Environment,
  shootables: ShootableRegistry,
  x: number,
  z: number,
  w: number,
  d: number,
  h: number,
  kind: number,
  bcx: number,
  bcz: number,
): void {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  for (let f = 0; f < 6; f++) {
    if (f === 2 || f === 3) continue;
    const fw = f < 2 ? d : w;
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * (fw / 12), uv.getY(i) * (h / 13));
    }
  }
  uv.needsUpdate = true;
  const side = bMat(kind, rng.pick(PAL[kind]), rng, env);
  const roof = lam(0x5d5f63);
  const m = new THREE.Mesh(geo, [side, side, roof, roof, side, side]);
  m.position.set(x, 0.25 + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  shootables.add(m, { kind: "building", refId: buildingIdCounter++ });
  grid.addBox(x, z, w / 2, d / 2, h + 0.25);
  const top = 0.25 + h;
  if (kind === 0) {
    const rg = new THREE.ConeGeometry(0.7071, 1, 4);
    rg.rotateY(Math.PI / 4);
    const r = new THREE.Mesh(rg, lam(rng.pick([0x9c4a3a, 0x7a4030, 0x6b5a4a])));
    const rh = rng.rr(2.5, 4);
    r.scale.set(w * 1.03, rh, d * 1.03);
    r.position.set(x, top + rh / 2, z);
    r.castShadow = true;
    scene.add(r);
  } else {
    if (kind === 1 && h > 45 && rng.rnd() < 0.6) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(w * 0.55, h * 0.1, d * 0.55), lam(0x8a95a0));
      c.position.set(x, top + h * 0.05, z);
      c.castShadow = true;
      scene.add(c);
    }
    for (let i = 0; i < 2; i++) {
      const ac = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 2), lam(0x9a9a9a));
      ac.position.set(x + rng.rr(-w / 3, w / 3), top + 0.5, z + rng.rr(-d / 3, d / 3));
      scene.add(ac);
    }
  }
  if (kind > 0 && rng.rnd() < 0.75) {
    const px = x - bcx;
    const pz = z - bcz;
    const alongX = Math.abs(px) > Math.abs(pz);
    const sg = rng.pick([0xff4f6d, 0x2ec4b6, 0xffbe0b, 0x8338ec, 0x3a86ff, 0xfb5607]);
    const fl = alongX ? d : w;
    const len = Math.min(8, fl * 0.7);
    const sm = new THREE.Mesh(
      new THREE.BoxGeometry(alongX ? 0.2 : len, 0.9, alongX ? len : 0.2),
      new THREE.MeshBasicMaterial({ color: sg }),
    );
    sm.position.set(
      alongX ? x + Math.sign(px || 1) * (w / 2 + 0.08) : x,
      4.2,
      alongX ? z : z + Math.sign(pz || 1) * (d / 2 + 0.08),
    );
    scene.add(sm);
  }
}

function buildPark(scene: THREE.Scene, rng: Rng, city: CityState, cx: number, cz: number): void {
  const g = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK - 6, BLOCK - 6), lam(0x4f8a3c));
  g.rotation.x = -Math.PI / 2;
  g.position.set(cx, 0.26, cz);
  g.receiveShadow = true;
  scene.add(g);
  const pm = lam(0xcdbf9a);
  const p1 = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK - 6, 4), pm);
  const p2 = new THREE.Mesh(new THREE.PlaneGeometry(4, BLOCK - 6), pm);
  p1.rotation.x = p2.rotation.x = -Math.PI / 2;
  p1.position.set(cx, 0.27, cz);
  p2.position.set(cx, 0.271, cz);
  scene.add(p1, p2);
  for (let n = 0; n < 22; n++) {
    const x = cx + rng.rr(-25, 25);
    const z = cz + rng.rr(-25, 25);
    if (Math.abs(x - cx) < 3.5 || Math.abs(z - cz) < 3.5) continue;
    city.treeList.push({ x, z, s: rng.rr(0.9, 1.4), y: 0.25 });
  }
  ([
    [-9, 3.2],
    [9, -3.2],
    [3.2, -9],
    [-3.2, 9],
  ] as [number, number][]).forEach((b) => city.benchList.push({ x: cx + b[0], z: cz + b[1], ry: Math.abs(b[0]) > Math.abs(b[1]) ? 0 : Math.PI / 2 }));
}

function buildPlaza(scene: THREE.Scene, rng: Rng, city: CityState, grid: CollisionGrid, cx: number, cz: number): void {
  const g = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK - 6, BLOCK - 6), lam(0xd8d0bc));
  g.rotation.x = -Math.PI / 2;
  g.position.set(cx, 0.26, cz);
  g.receiveShadow = true;
  scene.add(g);
  const st = lam(0xb8b0a0);
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.4, 0.9, 24), st);
  basin.position.set(cx, 0.71, cz);
  basin.castShadow = true;
  scene.add(basin);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 0.05, 24), lam(0x4aa8d8, { emissive: 0x113344 }));
  water.position.set(cx, 1.16, cz);
  scene.add(water);
  const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 2.4, 12), st);
  pil.position.set(cx, 2.2, cz);
  pil.castShadow = true;
  scene.add(pil);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(2, 1, 0.5, 16), st);
  bowl.position.set(cx, 3.5, cz);
  scene.add(bowl);
  grid.addCirc(cx, cz, 5.5);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    city.treeList.push({ x: cx + Math.cos(a) * 16, z: cz + Math.sin(a) * 16, s: rng.rr(1, 1.3), y: 0.25 });
    if (i % 2 === 0) city.benchList.push({ x: cx + Math.cos(a + 0.4) * 11, z: cz + Math.sin(a + 0.4) * 11, ry: -a - 0.4 + Math.PI / 2 });
  }
}

function buildLot(scene: THREE.Scene, rng: Rng, city: CityState, grid: CollisionGrid, cx: number, cz: number): void {
  const g = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK - 6, BLOCK - 6), lam(0x3a3c40));
  g.rotation.x = -Math.PI / 2;
  g.position.set(cx, 0.26, cz);
  g.receiveShadow = true;
  scene.add(g);
  const lines: { x: number; y: number; z: number; ry: number; sx?: number }[] = [];
  const rows: [number, number][] = [
    [-19, 0],
    [-7, Math.PI],
    [7, 0],
    [19, Math.PI],
  ];
  rows.forEach((rw) => {
    for (let i = 0; i < 12; i++) {
      const x = cx - 17.6 + i * 3.2;
      city.lotSlots.push({ x, z: cz + rw[0], yaw: rw[1] === 0 ? 0 : Math.PI });
      lines.push({ x: x - 1.6, y: 0.275, z: cz + rw[0], ry: Math.PI / 2, sx: 1 });
    }
    lines.push({ x: cx - 17.6 + 12 * 3.2 - 1.6, y: 0.275, z: cz + rw[0], ry: Math.PI / 2 });
  });
  inst(scene, new THREE.BoxGeometry(5.5, 0.02, 0.12), lam(0xe8e8e0), lines, false);
  const k = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), lam(0xd9c9a0));
  k.position.set(cx + 22, 1.75, cz);
  k.castShadow = true;
  scene.add(k);
  grid.addBox(cx + 22, cz, 1.5, 1.5, 3.25);
}

export function buildBlocks(
  scene: THREE.Scene,
  rng: Rng,
  grid: CollisionGrid,
  city: CityState,
  env: Environment,
  shootables: ShootableRegistry,
): void {
  for (let bi = 0; bi < G; bi++) {
    for (let bj = 0; bj < G; bj++) {
      const cx = bc(bi);
      const cz = bc(bj);
      const sp = SPECIAL[bi + "," + bj];
      const slab = new THREE.Mesh(new THREE.BoxGeometry(BLOCK, 0.25, BLOCK), lam(0xa9a9a3));
      slab.position.set(cx, 0.125, cz);
      slab.receiveShadow = true;
      scene.add(slab);
      if (sp === "park") {
        buildPark(scene, rng, city, cx, cz);
        continue;
      }
      if (sp === "plaza") {
        buildPlaza(scene, rng, city, grid, cx, cz);
        continue;
      }
      if (sp === "lot") {
        buildLot(scene, rng, city, grid, cx, cz);
        continue;
      }
      const dist = Math.hypot(cx, cz) / WORLD;
      const kind = dist < 0.42 ? 1 : dist < 0.7 ? 2 : 0;
      const inner = BLOCK - 10;
      const pat = rng.pick(kind === 1 ? [0, 0, 1, 2] : [1, 2, 3, 3, 3]);
      let lots: [number, number, number, number][];
      if (pat === 0) lots = [[0, 0, inner, inner]];
      else if (pat === 1) lots = [[-13, 0, 24, inner], [13, 0, 24, inner]];
      else if (pat === 2) lots = [[0, -13, inner, 24], [0, 13, inner, 24]];
      else lots = [[-13, -13, 24, 24], [13, -13, 24, 24], [-13, 13, 24, 24], [13, 13, 24, 24]];
      lots.forEach((l) => {
        const w = l[2] - rng.rr(0, 3);
        const d = l[3] - rng.rr(0, 3);
        const h = kind === 1 ? rng.rr(26, 80) : kind === 2 ? rng.rr(14, 34) : rng.rr(7, 16);
        addBuilding(scene, grid, rng, env, shootables, cx + l[0], cz + l[1], w, d, h, kind, cx, cz);
      });
    }
  }
}
