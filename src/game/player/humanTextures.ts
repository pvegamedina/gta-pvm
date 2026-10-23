// Procedural fabric-ish canvas texture for clothing on the human rig. One small
// texture is generated once and reused (tinted per color) since the game
// renders many pedestrians and remote players sharing the same palette.

import * as THREE from "three";

const cache: Record<number, THREE.MeshLambertMaterial> = {};
let sharedMap: THREE.CanvasTexture | null = null;

function fabricCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const x = c.getContext("2d")!;
  x.fillStyle = "#ffffff";
  x.fillRect(0, 0, 32, 32);
  for (let i = 0; i < 160; i++) {
    const v = 140 + Math.random() * 100;
    x.fillStyle = `rgba(${v | 0},${v | 0},${v | 0},0.45)`;
    x.fillRect(Math.random() * 32, Math.random() * 32, 1, 1);
  }
  x.strokeStyle = "rgba(0,0,0,0.07)";
  for (let i = 0; i < 32; i += 3) {
    x.beginPath();
    x.moveTo(0, i + 0.5);
    x.lineTo(32, i + 0.5);
    x.stroke();
  }
  return c;
}

function getFabricMap(): THREE.CanvasTexture {
  if (!sharedMap) {
    sharedMap = new THREE.CanvasTexture(fabricCanvas());
    sharedMap.wrapS = sharedMap.wrapT = THREE.RepeatWrapping;
    sharedMap.repeat.set(2, 2);
  }
  return sharedMap;
}

/** Tinted fabric material for shirts/pants, cached per color. */
export function fabricMat(color: number): THREE.MeshLambertMaterial {
  return cache[color] || (cache[color] = new THREE.MeshLambertMaterial({ color, map: getFabricMap() }));
}
