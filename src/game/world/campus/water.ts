// Water: swimming pools and ponds as flat, slightly glossy surfaces (Phong
// with a strong specular highlight so they read as water from any angle).
// The ground texture already paints them blue underneath, so terrain poking
// through a sloped edge still looks right.

import * as THREE from "three";
import type { CampusMap } from "../../map/loader";
import { ensureCCW } from "../../map/geometry";
import { buildRoof } from "./extrude";

export function buildWater(map: CampusMap, height: (x: number, z: number) => number): THREE.Mesh | null {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const l of map.landuse) {
    if (l.kind !== "water" && l.kind !== "swimming_pool") continue;
    const ring = ensureCCW(l.points);
    if (ring.length < 3) continue;
    const hs = ring.map(([x, z]) => height(x, z)).sort((a, b) => a - b);
    // Pools sit at their median rim height; ponds at their lowest shore.
    const y = l.kind === "swimming_pool" ? hs[Math.floor(hs.length / 2)] + 0.12 : hs[0] + 0.05;
    const roof = buildRoof(ring, y);
    const base = pos.length / 3;
    pos.push(...roof.positions);
    for (const i of roof.indices) idx.push(i + base);
  }
  if (idx.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = new THREE.MeshPhongMaterial({
    color: 0x1f5f86,
    specular: 0xbfdfff,
    shininess: 120,
    transparent: true,
    opacity: 0.9,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  m.name = "water";
  return m;
}
