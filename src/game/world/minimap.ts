// Minimap: a pre-rendered top-down city texture, rotated/panned to follow the
// camera each frame. Also draws AI/parked vehicles and remote players as dots.

import { G, WORLD, HALF, ROAD, BLOCK, SPECIAL, rc, bc } from "../core/constants";

const MAPR = 270;
const MAPS = 2;

export interface MinimapDot {
  x: number;
  z: number;
  color: string;
  r: number;
}

export function buildMapTexture(): HTMLCanvasElement {
  const mapC = document.createElement("canvas");
  mapC.width = mapC.height = MAPR * 2 * MAPS;
  const x = mapC.getContext("2d")!;
  const w = (v: number) => (v + MAPR) * MAPS;
  x.fillStyle = "#3c6a35";
  x.fillRect(0, 0, mapC.width, mapC.height);
  x.fillStyle = "#2f3238";
  for (let i = 0; i <= G; i++) {
    x.fillRect(w(-WORLD), w(rc(i) - HALF), WORLD * 2 * MAPS, ROAD * MAPS);
    x.fillRect(w(rc(i) - HALF), w(-WORLD), ROAD * MAPS, WORLD * 2 * MAPS);
  }
  for (let i = 0; i < G; i++) {
    for (let j = 0; j < G; j++) {
      const sp = SPECIAL[i + "," + j];
      x.fillStyle = "#bdb8a8";
      x.fillRect(w(bc(i) - 30), w(bc(j) - 30), BLOCK * MAPS, BLOCK * MAPS);
      x.fillStyle = sp === "park" ? "#4f8a3c" : sp === "plaza" ? "#e0d8c4" : sp === "lot" ? "#3a3c40" : "#8d8f96";
      const m = sp ? 27 : 25;
      x.fillRect(w(bc(i) - m), w(bc(j) - m), m * 2 * MAPS, m * 2 * MAPS);
    }
  }
  return mapC;
}

export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  mapC: HTMLCanvasElement,
  camYaw: number,
  camX: number,
  camZ: number,
  headingYaw: number,
  dots: MinimapDot[],
): void {
  const c = ctx;
  const cx = 90;
  const cy = 90;
  const z = 0.8;
  const px = camX;
  const pz = camZ;
  const fx = Math.sin(camYaw);
  const fz = Math.cos(camYaw);
  const rx = -Math.cos(camYaw);
  const rz = Math.sin(camYaw);
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, 180, 180);
  c.save();
  c.beginPath();
  c.arc(cx, cy, 88, 0, Math.PI * 2);
  c.clip();
  c.fillStyle = "#1b2a1a";
  c.fillRect(0, 0, 180, 180);
  c.setTransform(z * rx, -z * fx, z * rz, -z * fz, cx - z * (rx * px + rz * pz), cy + z * (fx * px + fz * pz));
  c.drawImage(mapC, -MAPR, -MAPR, MAPR * 2, MAPR * 2);
  for (const dot of dots) {
    c.fillStyle = dot.color;
    c.beginPath();
    c.arc(dot.x, dot.z, dot.r, 0, Math.PI * 2);
    c.fill();
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
  const hx = Math.sin(headingYaw);
  const hz2 = Math.cos(headingYaw);
  const sx = hx * rx + hz2 * rz;
  const sy = -(hx * fx + hz2 * fz);
  c.translate(cx, cy);
  c.rotate(Math.atan2(sx, -sy));
  c.fillStyle = "#ff3b3b";
  c.strokeStyle = "#fff";
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(0, -9);
  c.lineTo(6, 7);
  c.lineTo(0, 3);
  c.lineTo(-6, 7);
  c.closePath();
  c.fill();
  c.stroke();
  c.restore();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = "#fff";
  c.font = "bold 13px Arial";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText("N", cx + -rz * 76, cy + fz * 76);
}
