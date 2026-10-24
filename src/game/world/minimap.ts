// Minimap: a pre-rendered top-down painting of the campus map (landuse,
// roads by class, buildings, campus outline), rotated/panned to follow the
// camera each frame. Also draws AI/parked vehicles and remote players as dots.

import type { CampusMap } from "../map/loader";
import { MINIMAP_PALETTE, paintMap } from "./campus/mapPainter";

/** Pixels per metre of the pre-rendered minimap texture. */
const MAP_PX_PER_M = 1.25;
/** Minimap zoom (screen px per metre). */
const ZOOM = 0.8;

export interface MinimapDot {
  x: number;
  z: number;
  color: string;
  r: number;
}

/** The painted map plus the world rectangle it covers. */
export interface MinimapTexture {
  canvas: HTMLCanvasElement;
  minX: number;
  minZ: number;
  width: number;
  height: number;
}

export function buildMapTexture(map: CampusMap): MinimapTexture {
  const t = map.terrainGrid;
  const width = (t.width - 1) * t.cellSize;
  const height = (t.height - 1) * t.cellSize;
  const canvas = paintMap(map, MINIMAP_PALETTE, Math.round(width * MAP_PX_PER_M), Math.round(height * MAP_PX_PER_M));
  return { canvas, minX: t.originX, minZ: t.originZ, width, height };
}

export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  tex: MinimapTexture | null,
  camYaw: number,
  camX: number,
  camZ: number,
  headingYaw: number,
  dots: MinimapDot[],
): void {
  const c = ctx;
  const cx = 90;
  const cy = 90;
  const z = ZOOM;
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
  c.fillStyle = "#2a3324";
  c.fillRect(0, 0, 180, 180);
  // World -> screen: the camera's forward points up, its right points right.
  c.setTransform(z * rx, -z * fx, z * rz, -z * fz, cx - z * (rx * px + rz * pz), cy + z * (fx * px + fz * pz));
  if (tex) c.drawImage(tex.canvas, tex.minX, tex.minZ, tex.width, tex.height);
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
