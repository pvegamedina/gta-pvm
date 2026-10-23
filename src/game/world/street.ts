// Street furniture: lamp posts, trees, benches, hydrants, bins, speed-limit signs
// and curb parking slots. Appends to the shared trees/benches lists from buildings.

import * as THREE from "three";
import { G, P, HALF, rc } from "../core/constants";
import type { Rng } from "../core/rng";
import { lam, inst, radialTex } from "./materials";
import type { CollisionGrid } from "./colliders";
import type { CityState } from "./cityState";
import type { Environment } from "./environment";
import { groundY } from "./colliders";

export function buildStreet(scene: THREE.Scene, rng: Rng, grid: CollisionGrid, city: CityState, env: Environment): void {
  const lamps: { x: number; y: number; z: number; ry: number; bx: number; bz: number }[] = [];
  const pools: { x: number; y: number; z: number }[] = [];
  const signs: { x: number; y: number; z: number; ry: number }[] = [];
  const signPoles: { x: number; y: number; z: number }[] = [];
  const hyd: { x: number; y: number; z: number }[] = [];
  const bins: { x: number; y: number; z: number }[] = [];

  for (let axis = 0; axis < 2; axis++) {
    for (let r = 0; r <= G; r++) {
      for (let k = 0; k < G; k++) {
        const a0 = rc(k);
        const rAxisVal = rc(r);
        [0.3, 0.5, 0.7].forEach((f, idx) => {
          const s = (idx + k + r) % 2 ? 1 : -1;
          const pp = axis === 0 ? { x: a0 + P * f, z: rAxisVal + s * (HALF + 0.9) } : { x: rAxisVal + s * (HALF + 0.9), z: a0 + P * f };
          const bp = axis === 0 ? { x: a0 + P * f, z: rAxisVal + s * (HALF - 0.3) } : { x: rAxisVal + s * (HALF - 0.3), z: a0 + P * f };
          lamps.push({ x: pp.x, y: 3.75, z: pp.z, ry: axis === 0 ? Math.PI / 2 : 0, bx: bp.x, bz: bp.z });
          grid.addCirc(pp.x, pp.z, 0.25);
          pools.push({ x: bp.x, y: 0.045, z: bp.z }, { x: bp.x, y: 0.275, z: bp.z });
        });
        [0.22, 0.4, 0.6, 0.78].forEach((f, idx) => {
          const s = (idx + k) % 2 ? 1 : -1;
          const p = axis === 0 ? { x: a0 + P * f, z: rAxisVal + s * (HALF + 1.6) } : { x: rAxisVal + s * (HALF + 1.6), z: a0 + P * f };
          city.treeList.push({ x: p.x, z: p.z, s: rng.rr(0.85, 1.2), y: groundY(p.x, p.z) });
        });
        for (const s of [-1, 1]) {
          const dirv = s;
          const f = dirv > 0 ? 0.2 : 0.8;
          const p = axis === 0 ? { x: a0 + P * f, z: rAxisVal + s * (HALF + 0.8) } : { x: rAxisVal + s * (HALF + 0.8), z: a0 + P * f };
          signPoles.push({ x: p.x, y: 1.6, z: p.z });
          const nx = axis === 0 ? -dirv : 0;
          const nz = axis === 0 ? 0 : s > 0 ? 1 : -1;
          signs.push({ x: p.x + nx * 0.06, y: 3.0, z: p.z + nz * 0.06, ry: Math.atan2(nx, nz) });
          grid.addCirc(p.x, p.z, 0.15);
          if (rng.rnd() < 0.45) {
            const side = s > 0 ? 1 : -1;
            const f2 = 0.35 + rng.rnd() * 0.3;
            const q = axis === 0 ? { x: a0 + P * f2, z: rAxisVal + side * 7.5 } : { x: rAxisVal + side * 7.5, z: a0 + P * f2 };
            const dx = axis === 0 ? side : 0;
            const dz = axis === 0 ? 0 : -side;
            const yaw = Math.atan2(dx, dz);
            city.streetSlots.push({ x: q.x, z: q.z, yaw });
            if (rng.rnd() < 0.35) {
              const q2 = axis === 0 ? { x: a0 + P * (f2 + 0.09), z: rAxisVal + side * 7.5 } : { x: rAxisVal + side * 7.5, z: a0 + P * (f2 + 0.09) };
              city.streetSlots.push({ x: q2.x, z: q2.z, yaw });
            }
          }
        }
        if (rng.rnd() < 0.5) {
          const s = rng.rnd() < 0.5 ? 1 : -1;
          const f = rng.rr(0.25, 0.75);
          const p = axis === 0 ? { x: a0 + P * f, z: rAxisVal + s * (HALF + 0.7) } : { x: rAxisVal + s * (HALF + 0.7), z: a0 + P * f };
          hyd.push({ x: p.x, y: 0.6, z: p.z });
          grid.addCirc(p.x, p.z, 0.3);
        }
        if (rng.rnd() < 0.4) {
          const s = rng.rnd() < 0.5 ? 1 : -1;
          const f = rng.rr(0.25, 0.75);
          const p = axis === 0 ? { x: a0 + P * f, z: rAxisVal + s * (HALF + 0.7) } : { x: rAxisVal + s * (HALF + 0.7), z: a0 + P * f };
          bins.push({ x: p.x, y: 0.7, z: p.z });
          grid.addCirc(p.x, p.z, 0.35);
        }
      }
    }
  }

  const bulbM = new THREE.MeshBasicMaterial({ color: 0x888877 });
  env.lightMats.bulb = bulbM;
  const poolM = new THREE.MeshBasicMaterial({
    map: radialTex([
      [0, "rgba(255,220,150,0.9)"],
      [1, "rgba(255,200,120,0)"],
    ]),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0,
  });
  env.lightMats.pool = poolM;
  inst(scene, new THREE.CylinderGeometry(0.1, 0.12, 7.5, 8), lam(0x3b4046), lamps, false);
  inst(
    scene,
    new THREE.BoxGeometry(0.12, 0.12, 1.4),
    lam(0x3b4046),
    lamps.map((l) => ({ x: (l.x + l.bx) / 2, y: 7.4, z: (l.z + l.bz) / 2, ry: l.ry === 0 ? 0 : Math.PI / 2 })),
    false,
  );
  inst(scene, new THREE.BoxGeometry(0.5, 0.18, 0.5), bulbM, lamps.map((l) => ({ x: l.bx, y: 7.3, z: l.bz })), false);
  const pg = new THREE.PlaneGeometry(18, 18);
  pg.rotateX(-Math.PI / 2);
  inst(scene, pg, poolM, pools, false);
  inst(scene, new THREE.CylinderGeometry(0.05, 0.05, 3.2, 6), lam(0x777777), signPoles, false);

  const sc = document.createElement("canvas");
  sc.width = sc.height = 64;
  const sx = sc.getContext("2d")!;
  sx.fillStyle = "#fff";
  sx.beginPath();
  sx.arc(32, 32, 31, 0, 7);
  sx.fill();
  sx.fillStyle = "#d62020";
  sx.beginPath();
  sx.arc(32, 32, 26, 0, 7);
  sx.fill();
  sx.fillStyle = "#fff";
  sx.beginPath();
  sx.arc(32, 32, 19, 0, 7);
  sx.fill();
  sx.fillStyle = "#111";
  sx.font = "bold 24px Arial";
  sx.textAlign = "center";
  sx.textBaseline = "middle";
  sx.fillText("50", 32, 34);
  const stx = new THREE.CanvasTexture(sc);
  inst(scene, new THREE.PlaneGeometry(0.8, 0.8), new THREE.MeshBasicMaterial({ map: stx, transparent: true, alphaTest: 0.4 }), signs, false);
  inst(scene, new THREE.CylinderGeometry(0.16, 0.16, 0.7, 8), lam(0xc0281c), hyd, false);
  inst(scene, new THREE.CylinderGeometry(0.32, 0.28, 0.9, 8), lam(0x2f6b3a), bins, false);

  const trunk = city.treeList.map((t) => ({ x: t.x, y: t.y, z: t.z, sx: t.s, sy: t.s, sz: t.s }));
  const tg = new THREE.CylinderGeometry(0.22, 0.3, 2.6, 6);
  tg.translate(0, 1.3, 0);
  inst(scene, tg, lam(0x6b4a2b), trunk, true);
  [0x3f7d34, 0x4d8f3a].forEach((col, ci) => {
    const grp = city.treeList.filter((_t, i) => i % 2 === ci);
    const big = new THREE.IcosahedronGeometry(2.0, 0);
    big.translate(0, 3.8, 0);
    const sm = new THREE.IcosahedronGeometry(1.3, 0);
    sm.translate(0.3, 5.5, 0.2);
    const it = grp.map((t) => ({ x: t.x, y: t.y, z: t.z, sx: t.s, sy: t.s, sz: t.s, ry: t.x }));
    inst(scene, big, lam(col), it, true);
    inst(scene, sm, lam(col), it, true);
  });
  city.treeList.forEach((t) => grid.addCirc(t.x, t.z, 0.5));

  const seats = city.benchList.map((b) => ({ x: b.x, y: 0.7, z: b.z, ry: b.ry }));
  inst(scene, new THREE.BoxGeometry(1.8, 0.12, 0.5), lam(0x7a5a3a), seats, true);
  inst(
    scene,
    new THREE.BoxGeometry(1.8, 0.5, 0.1),
    lam(0x7a5a3a),
    city.benchList.map((b) => ({ x: b.x, y: 1.0, z: b.z, ry: b.ry })),
    true,
  );
  city.benchList.forEach((b) => grid.addCirc(b.x, b.z, 0.7));
}

export function buildScenery(scene: THREE.Scene): void {
  const hm = lam(0x4a6b4a);
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2 + Math.random() * 0.2;
    const d = 620 + Math.random() * 200;
    const h = 50 + Math.random() * 90;
    const r = 90 + Math.random() * 80;
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), hm);
    m.position.set(Math.cos(a) * d, h / 2 - 5, Math.sin(a) * d);
    scene.add(m);
  }
}
