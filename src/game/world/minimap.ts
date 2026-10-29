// Minimap: a pre-rendered top-down painting of the campus map (landuse,
// roads by class, buildings, campus outline), rotated/panned to follow the
// camera each frame. Also draws AI/parked vehicles and remote players as dots,
// and big blips (the boss) that stick to the rim when they are out of range.

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

/** A big marker drawn in screen pixels; clamped to the rim when off the minimap. */
export interface MinimapBlip {
  x: number;
  z: number;
  color: string;
  /** Radius in screen pixels. */
  r: number;
}

/** Minimap centre and radius (px) inside the 180×180 canvas. */
const CX = 90;
const CY = 90;
const RADIUS = 88;

/**
 * Where a world point lands on the minimap (canvas px), and whether it had to
 * be pulled onto the rim (`edge`) because it is farther than the minimap shows.
 */
export function blipScreenPos(x: number, z: number, camYaw: number, camX: number, camZ: number, margin: number): { sx: number; sy: number; edge: boolean } {
  const dx = x - camX;
  const dz = z - camZ;
  // Camera right -> screen right, camera forward -> screen up.
  let sx = ZOOM * (dx * -Math.cos(camYaw) + dz * Math.sin(camYaw));
  let sy = -ZOOM * (dx * Math.sin(camYaw) + dz * Math.cos(camYaw));
  const d = Math.hypot(sx, sy);
  const max = RADIUS - margin;
  const edge = d > max;
  if (edge) {
    sx *= max / d;
    sy *= max / d;
  }
  return { sx: CX + sx, sy: CY + sy, edge };
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
  blips: readonly MinimapBlip[] = [],
): void {
  const c = ctx;
  const cx = CX;
  const cy = CY;
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
  c.arc(cx, cy, RADIUS, 0, Math.PI * 2);
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
  for (const b of blips) drawBlip(c, b, blipScreenPos(b.x, b.z, camYaw, camX, camZ, b.r + 2));
}

/** A filled circle with a white ring; on the rim it gets an arrow pointing out towards the target. */
function drawBlip(c: CanvasRenderingContext2D, b: MinimapBlip, pos: { sx: number; sy: number; edge: boolean }): void {
  c.setTransform(1, 0, 0, 1, 0, 0);
  if (pos.edge) {
    const a = Math.atan2(pos.sy - CY, pos.sx - CX);
    c.save();
    c.translate(pos.sx, pos.sy);
    c.rotate(a);
    c.fillStyle = b.color;
    c.beginPath();
    c.moveTo(b.r + 6, 0);
    c.lineTo(b.r - 1, -5);
    c.lineTo(b.r - 1, 5);
    c.closePath();
    c.fill();
    c.restore();
  }
  c.fillStyle = b.color;
  c.strokeStyle = "#fff";
  c.lineWidth = 2;
  c.beginPath();
  c.arc(pos.sx, pos.sy, b.r, 0, Math.PI * 2);
  c.fill();
  c.stroke();
}
