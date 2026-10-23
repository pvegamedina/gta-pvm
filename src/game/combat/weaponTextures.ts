// Procedural brushed-metal-ish canvas texture for weapon bodies, plus small
// flat accent materials for sights/selectors/trigger guards. Generated once
// and cached per tint color.

import * as THREE from "three";

const cache: Record<string, THREE.MeshLambertMaterial> = {};
let sharedMap: THREE.CanvasTexture | null = null;

function metalCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 64;
  const x = c.getContext("2d")!;
  const g = x.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, "#606066");
  g.addColorStop(0.15, "#2e2e32");
  g.addColorStop(0.5, "#1a1a1c");
  g.addColorStop(0.85, "#2a2a2e");
  g.addColorStop(1, "#505058");
  x.fillStyle = g;
  x.fillRect(0, 0, 8, 64);
  for (let i = 0; i < 60; i++) {
    x.fillStyle = `rgba(255,255,255,${Math.random() * 0.06})`;
    x.fillRect(Math.random() * 8, Math.random() * 64, 8, 1);
  }
  return c;
}

function getMetalMap(): THREE.CanvasTexture {
  if (!sharedMap) {
    sharedMap = new THREE.CanvasTexture(metalCanvas());
    sharedMap.wrapS = sharedMap.wrapT = THREE.RepeatWrapping;
  }
  return sharedMap;
}

/** Gunmetal material with a subtle brushed highlight, cached per tint color. */
export function gunmetal(color: number): THREE.MeshLambertMaterial {
  const k = "m" + color;
  return cache[k] || (cache[k] = new THREE.MeshLambertMaterial({ color, map: getMetalMap() }));
}

/** Flat accent material (sights, selectors, trigger, guards) — no texture. */
export function accentMat(color: number): THREE.MeshLambertMaterial {
  const k = "a" + color;
  return cache[k] || (cache[k] = new THREE.MeshLambertMaterial({ color }));
}
