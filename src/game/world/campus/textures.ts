// Procedural canvas textures for the campus (browser only): facade tiles
// (4 bays x 4 storeys per texture so lit windows vary at night), road
// surfaces with lane markings, paving, sidewalk slabs, zebra crossings, roof
// gravel and concrete. Mostly light/neutral so per-building vertex tints
// give the colour; one texture per style keeps the draw calls low.
//
// Phase 4b will swap the facades for MegaKit modules; these are the
// replaceable "good enough" stand-ins.

import * as THREE from "three";

/** Bays / storeys covered by one facade texture (UVs are scaled to match). */
export const FACADE_TILES = 4;

export type FacadeStyle = "campus" | "residential" | "commercial" | "sports";

/** Small deterministic PRNG so textures look the same on every load. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function toTexture(c: HTMLCanvasElement, anisotropy: number, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = anisotropy;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** Speckle noise over the whole canvas (brightness jitter ±amp). */
function speckle(x: CanvasRenderingContext2D, w: number, h: number, amp: number, rnd: () => number, count = (w * h) / 6): void {
  for (let i = 0; i < count; i++) {
    const v = (rnd() - 0.5) * 2 * amp;
    x.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    x.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
  }
}

export interface FacadeTextures {
  map: THREE.CanvasTexture;
  /** Lit windows (night), used as emissiveMap. */
  emissive: THREE.CanvasTexture;
}

/**
 * One facade texture: FACADE_TILES x FACADE_TILES cells, each one window bay
 * by one storey. Walls are near-white (the vertex tint colours them).
 */
export function facadeTextures(style: FacadeStyle, anisotropy: number): FacadeTextures {
  const S = 128; // px per cell
  const N = FACADE_TILES;
  const [c, x] = canvas(S * N, S * N);
  const [e, ex] = canvas(S * N, S * N);
  const rnd = prng(style.length * 977 + 13);
  // Wall albedo ~0.65: tinted whites end up white in full sun, grey in shade.
  x.fillStyle = "#b6b4af";
  x.fillRect(0, 0, S * N, S * N);
  speckle(x, S * N, S * N, 0.05, rnd);
  ex.fillStyle = "#000";
  ex.fillRect(0, 0, S * N, S * N);
  const glass = ["#25313c", "#2b3742", "#212b34", "#303d48"];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const ox = i * S;
      const oy = j * S;
      x.fillStyle = "rgba(0,0,0,0.10)";
      // Floor slab line at the bottom of every storey.
      x.fillRect(ox, oy + S - 6, S, 6);
      let wx: number, wy: number, ww: number, wh: number;
      if (style === "campus") {
        // Wide ribbon windows with a sun-shade lintel.
        wx = ox + 6;
        ww = S - 12;
        wy = oy + 30;
        wh = 58;
        x.fillStyle = "rgba(0,0,0,0.16)";
        x.fillRect(ox, wy - 10, S, 8);
      } else if (style === "residential") {
        wx = ox + 34;
        ww = 60;
        wy = oy + 28;
        wh = 66;
      } else if (style === "sports") {
        // Tall blank panels with a high clerestory strip.
        wx = ox + 4;
        ww = S - 8;
        wy = oy + 14;
        wh = 22;
        x.fillStyle = "rgba(0,0,0,0.07)";
        x.fillRect(ox + S / 2 - 1, oy, 2, S);
      } else {
        // Commercial: metal cladding lines and a small window.
        x.fillStyle = "rgba(0,0,0,0.08)";
        for (let k = 0; k < S; k += 16) x.fillRect(ox, oy + k, S, 2);
        wx = ox + 40;
        ww = 48;
        wy = oy + 40;
        wh = 40;
      }
      x.fillStyle = glass[Math.floor(rnd() * glass.length)];
      x.fillRect(wx, wy, ww, wh);
      // Sky reflection gradient on the glass.
      const g = x.createLinearGradient(wx, wy, wx + ww, wy + wh);
      g.addColorStop(0, "rgba(255,255,255,0.22)");
      g.addColorStop(0.5, "rgba(255,255,255,0.02)");
      g.addColorStop(1, "rgba(255,255,255,0.12)");
      x.fillStyle = g;
      x.fillRect(wx, wy, ww, wh);
      // Mullions + sill.
      x.fillStyle = "rgba(150,150,150,0.95)";
      if (style === "campus") for (let k = 1; k < 3; k++) x.fillRect(wx + (ww * k) / 3 - 1, wy, 3, wh);
      else x.fillRect(wx + ww / 2 - 1, wy, 3, wh);
      x.fillStyle = "rgba(0,0,0,0.25)";
      x.fillRect(wx - 2, wy + wh, ww + 4, 4);
      if (style === "residential") {
        // Balcony railing.
        x.fillStyle = "rgba(40,40,40,0.55)";
        x.fillRect(wx - 10, wy + wh - 24, ww + 20, 3);
        for (let k = 0; k <= ww + 20; k += 8) x.fillRect(wx - 10 + k, wy + wh - 24, 2, 24);
      }
      // Night: roughly half the windows lit, warm or cool.
      if (rnd() < 0.5) {
        ex.fillStyle = rnd() < 0.7 ? "#ffd9a0" : "#d8e8ff";
        ex.fillRect(wx, wy, ww, wh);
      }
    }
  }
  return { map: toTexture(c, anisotropy), emissive: toTexture(e, anisotropy) };
}

/** Metres along the road covered by one road texture repeat. */
export const ROAD_TEX_LENGTH = 12;

export type RoadMarking = "twoWay" | "oneWay2" | "oneWay3" | "oneWay4" | "plain";

/**
 * Asphalt with markings. u runs across the carriageway (0 = left edge, 1 =
 * right edge), v along it (one repeat = ROAD_TEX_LENGTH metres).
 */
export function roadTexture(marking: RoadMarking, anisotropy: number): THREE.CanvasTexture {
  const W = 128;
  const H = 256;
  const [c, x] = canvas(W, H);
  const rnd = prng(marking.length * 131 + 7);
  x.fillStyle = "#34363a";
  x.fillRect(0, 0, W, H);
  speckle(x, W, H, 0.09, rnd, 5000);
  // Wheel tracks slightly darker.
  x.fillStyle = "rgba(0,0,0,0.06)";
  for (const u of [0.2, 0.32, 0.68, 0.8]) x.fillRect(u * W - 5, 0, 10, H);
  const white = "rgba(205,205,198,0.95)";
  // Solid edge lines on every carriageway.
  x.fillStyle = white;
  x.fillRect(3, 0, 3, H);
  x.fillRect(W - 6, 0, 3, H);
  const dash = (u: number) => {
    x.fillStyle = white;
    // 4 m dash every 12 m.
    x.fillRect(u * W - 1.5, 0, 3, (H * 4) / ROAD_TEX_LENGTH);
  };
  if (marking === "twoWay") dash(0.5);
  else if (marking !== "plain") {
    const n = Number(marking.slice(-1));
    for (let k = 1; k < n; k++) dash(k / n);
  }
  return toTexture(c, anisotropy);
}

/** Plain asphalt (junction fills, parking): world-mapped, 8 m per repeat. */
export function asphaltTexture(anisotropy: number): THREE.CanvasTexture {
  const [c, x] = canvas(128, 128);
  const rnd = prng(99);
  x.fillStyle = "#34363a";
  x.fillRect(0, 0, 128, 128);
  speckle(x, 128, 128, 0.09, rnd, 3000);
  return toTexture(c, anisotropy);
}

/** Interlocking paving stones (footways, pedestrian streets): 2 m per repeat. */
export function pavingTexture(anisotropy: number): THREE.CanvasTexture {
  const [c, x] = canvas(128, 128);
  const rnd = prng(5);
  x.fillStyle = "#7a746a";
  x.fillRect(0, 0, 128, 128);
  for (let j = 0; j < 8; j++) {
    for (let i = 0; i < 4; i++) {
      const off = j % 2 ? 16 : 0;
      const v = 0.9 + rnd() * 0.18;
      x.fillStyle = `rgb(${Math.round(118 * v)},${Math.round(112 * v)},${Math.round(103 * v)})`;
      x.fillRect(((i * 32 + off) % 128) + 1, j * 16 + 1, 30, 14);
    }
  }
  speckle(x, 128, 128, 0.05, rnd, 1500);
  return toTexture(c, anisotropy);
}

/** Square concrete sidewalk slabs: 2 m per repeat. */
export function sidewalkTexture(anisotropy: number): THREE.CanvasTexture {
  const [c, x] = canvas(128, 128);
  const rnd = prng(17);
  x.fillStyle = "#7e7a73";
  x.fillRect(0, 0, 128, 128);
  speckle(x, 128, 128, 0.06, rnd, 2500);
  x.fillStyle = "rgba(0,0,0,0.18)";
  for (let k = 0; k < 128; k += 32) {
    x.fillRect(k, 0, 2, 128);
    x.fillRect(0, k, 128, 2);
  }
  return toTexture(c, anisotropy);
}

/** Zebra crossing: stripes along the walking direction (v), 1 m period. */
export function zebraTexture(anisotropy: number): THREE.CanvasTexture {
  const [c, x] = canvas(64, 64);
  x.fillStyle = "#34363a";
  x.fillRect(0, 0, 64, 64);
  x.fillStyle = "rgba(205,205,198,0.95)";
  x.fillRect(0, 0, 64, 32);
  return toTexture(c, anisotropy);
}

/** Gravel roof: 4 m per repeat. */
export function roofTexture(anisotropy: number): THREE.CanvasTexture {
  const [c, x] = canvas(128, 128);
  const rnd = prng(23);
  x.fillStyle = "#5e5c58";
  x.fillRect(0, 0, 128, 128);
  speckle(x, 128, 128, 0.14, rnd, 6000);
  return toTexture(c, anisotropy);
}

/** Board-marked concrete (bridge decks, pillars, kerbs, parapets). */
export function concreteTexture(anisotropy: number): THREE.CanvasTexture {
  const [c, x] = canvas(64, 64);
  const rnd = prng(31);
  x.fillStyle = "#86837d";
  x.fillRect(0, 0, 64, 64);
  speckle(x, 64, 64, 0.07, rnd, 800);
  x.fillStyle = "rgba(0,0,0,0.08)";
  x.fillRect(0, 30, 64, 2);
  return toTexture(c, anisotropy);
}

/** Terracotta roof tiles (Andalusian houses): 2 m per repeat, rows along u (the eaves). */
export function tileRoofTexture(anisotropy: number): THREE.CanvasTexture {
  const [c, x] = canvas(128, 128);
  const rnd = prng(41);
  x.fillStyle = "#9a4a30";
  x.fillRect(0, 0, 128, 128);
  // 8 rows of curved tiles, 10 per row, alternating offset; shaded lower lip.
  for (let j = 0; j < 8; j++) {
    for (let i = -1; i < 11; i++) {
      const w = 12.8;
      const ox = i * w + (j % 2 ? w / 2 : 0);
      const v = 0.85 + rnd() * 0.3;
      const g = x.createLinearGradient(ox, 0, ox + w, 0);
      g.addColorStop(0, `rgb(${Math.round(120 * v)},${Math.round(55 * v)},${Math.round(36 * v)})`);
      g.addColorStop(0.5, `rgb(${Math.round(178 * v)},${Math.round(88 * v)},${Math.round(58 * v)})`);
      g.addColorStop(1, `rgb(${Math.round(110 * v)},${Math.round(50 * v)},${Math.round(33 * v)})`);
      x.fillStyle = g;
      x.fillRect(ox, j * 16, w - 1, 14);
      x.fillStyle = "rgba(0,0,0,0.25)";
      x.fillRect(ox, j * 16 + 13, w - 1, 3);
    }
  }
  speckle(x, 128, 128, 0.06, rnd, 1500);
  return toTexture(c, anisotropy);
}

/** Straight lane arrow (white on transparent, use with alphaTest), pointing to v = 1. 1 x 3 m quad. */
export function arrowTexture(anisotropy: number): THREE.CanvasTexture {
  const [c, x] = canvas(64, 192);
  x.clearRect(0, 0, 64, 192);
  x.fillStyle = "rgba(214,214,206,1)";
  // Shaft (bottom) and head (top): canvas top = v 1 = the front of the arrow.
  x.fillRect(26, 70, 12, 116);
  x.beginPath();
  x.moveTo(32, 6);
  x.lineTo(58, 76);
  x.lineTo(6, 76);
  x.closePath();
  x.fill();
  const t = toTexture(c, anisotropy, false);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Tactile paving at dropped kerbs (Spanish red "botones" slabs): 1 m per repeat. */
export function tactileTexture(anisotropy: number): THREE.CanvasTexture {
  const [c, x] = canvas(64, 64);
  const rnd = prng(57);
  x.fillStyle = "#8e3b2c";
  x.fillRect(0, 0, 64, 64);
  speckle(x, 64, 64, 0.06, rnd, 600);
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const cx = 8 + i * 16;
      const cy = 8 + j * 16;
      x.fillStyle = "rgba(0,0,0,0.28)";
      x.beginPath();
      x.arc(cx + 1, cy + 1.5, 4.5, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = "#b5503d";
      x.beginPath();
      x.arc(cx, cy, 4.2, 0, Math.PI * 2);
      x.fill();
    }
  }
  x.fillStyle = "rgba(0,0,0,0.25)";
  x.fillRect(0, 0, 64, 1);
  x.fillRect(0, 0, 1, 64);
  return toTexture(c, anisotropy);
}
