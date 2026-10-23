// Shared material/geometry-instancing helpers used across world and vehicle builders.

import * as THREE from "three";

const matCache: Record<string, THREE.MeshLambertMaterial> = {};
export function lam(color: number, extra?: Record<string, unknown>): THREE.MeshLambertMaterial {
  const k = color + (extra ? JSON.stringify(extra) : "");
  return matCache[k] || (matCache[k] = new THREE.MeshLambertMaterial(Object.assign({ color }, extra || {})));
}

export function polyMat(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
}

export interface InstItem {
  x: number;
  y: number;
  z: number;
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

const _d = new THREE.Object3D();
export function inst(
  scene: THREE.Scene,
  geo: THREE.BufferGeometry,
  mat: THREE.Material | THREE.Material[],
  items: InstItem[],
  cast?: boolean,
): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(items.length, 1));
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    _d.position.set(it.x, it.y, it.z);
    _d.rotation.set(it.rx || 0, it.ry || 0, it.rz || 0);
    _d.scale.set(it.sx || 1, it.sy || 1, it.sz || 1);
    _d.updateMatrix();
    m.setMatrixAt(i, _d.matrix);
  }
  m.count = items.length;
  m.instanceMatrix.needsUpdate = true;
  m.frustumCulled = false;
  m.castShadow = !!cast;
  scene.add(m);
  return m;
}

export function radialTex(stops: [number, string][]): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  stops.forEach((s) => g.addColorStop(s[0], s[1]));
  x.fillStyle = g as unknown as string;
  x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
