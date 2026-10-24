// Debug top-down render of the generated map.
//
//   npx tsx scripts/map/preview.ts [out.svg]
//
// Writes an SVG (terrain shading + landuse + roads by class + buildings +
// trees + spawns + traffic lights) and, when Chrome is available through
// playwright-core, a PNG next to it. Defaults to the OS temp directory so
// nothing is written into the repository.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseCampusMap } from "../../src/game/map/loader";
import { heightAt, normalAt, polygonCentroid } from "../../src/game/map/queries";
import type { LanduseKind, RoadClass, TreeSpecies, Vec2 } from "../../src/game/map/types";

const root = path.resolve(import.meta.dirname, "../..");
const outSvg = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "campus-map-preview.svg"));
const map = parseCampusMap(readFileSync(path.join(root, "public/maps/campus-el-carmen.json"), "utf8"));

const { minX, minZ, maxX, maxZ } = map.bounds;
const W = maxX - minX;
const H = maxZ - minZ;
const px = (x: number) => (x - minX).toFixed(1);
const pz = (z: number) => (z - minZ).toFixed(1);
const pathOf = (pts: Vec2[], close: boolean) =>
  pts.map(([x, z], i) => `${i ? "L" : "M"}${px(x)} ${pz(z)}`).join("") + (close ? "Z" : "");

const parts: string[] = [];

// Terrain: 12 m blocks coloured by height with a NW-lit hillshade.
const BLOCK = 12;
const { minHeight, maxHeight } = map.terrain;
for (let z = minZ; z < maxZ; z += BLOCK) {
  for (let x = minX; x < maxX; x += BLOCK) {
    const cx = x + BLOCK / 2;
    const cz = z + BLOCK / 2;
    const t = (heightAt(map.terrainGrid, cx, cz) - minHeight) / Math.max(1, maxHeight - minHeight);
    const [nx, ny, nz] = normalAt(map.terrainGrid, cx, cz);
    // Light from the north-west, slightly exaggerated relief.
    const shade = Math.max(0, Math.min(1, 0.75 + 6 * (-nx * -0.6 + -nz * -0.6) * (1 - ny + 0.02)));
    const r = Math.round((90 + 120 * t) * shade);
    const g = Math.round((120 + 90 * t) * shade);
    const b = Math.round((80 + 60 * t) * shade);
    parts.push(`<rect x="${px(x)}" y="${pz(z)}" width="${BLOCK}" height="${BLOCK}" fill="rgb(${r},${g},${b})"/>`);
  }
}

const LANDUSE_COLORS: Partial<Record<LanduseKind, string>> = {
  grass: "#8fc46a",
  park: "#6fb35a",
  garden: "#7cc070",
  pitch: "#4f9f6f",
  water: "#4a90d9",
  swimming_pool: "#53b6e8",
  parking: "#9a9a9a",
  playground: "#d6c27a",
  track: "#c0603f",
  industrial: "#b8a7b0",
  residential: "#c9bfb3",
  allotments: "#a8c27a",
  farmland: "#d8d39a",
};
for (const l of map.landuse) {
  parts.push(`<path d="${pathOf(l.points, true)}" fill="${LANDUSE_COLORS[l.kind] ?? "#999"}" fill-opacity="0.75"/>`);
}

const ROAD_COLORS: Partial<Record<RoadClass, string>> = {
  motorway: "#e05a47",
  motorway_link: "#e07a67",
  primary: "#f0a040",
  primary_link: "#f0a040",
  secondary: "#f3d36b",
  secondary_link: "#f3d36b",
  tertiary: "#fff3a8",
  tertiary_link: "#fff3a8",
  residential: "#ffffff",
  service: "#e8e8e8",
  pedestrian: "#d9cfc0",
  footway: "#c46a5a",
  cycleway: "#5a7ac4",
  steps: "#7a3a2a",
  path: "#a07a50",
};
// Wider classes first so footways draw on top.
const roads = map.roads.map((r, i) => ({ r, i })).sort((a, b) => b.r.width - a.r.width || a.i - b.i);
for (const { r } of roads) {
  const color = ROAD_COLORS[r.class] ?? "#cccccc";
  const footLike = r.lanes === 0;
  parts.push(
    `<path d="${pathOf(r.points, false)}" fill="none" stroke="${color}" stroke-width="${footLike ? 1.4 : r.width}" ` +
      `stroke-linecap="round" stroke-linejoin="round"${r.tunnel ? ' stroke-dasharray="4 3"' : ""}/>`,
  );
}

const BUILDING_COLORS: Record<string, string> = {
  university: "#5b6fb5",
  school: "#7a8fd0",
  sports: "#8e5bb5",
  retail: "#c07a3a",
  house: "#b5835b",
  residential: "#a8705b",
  roof: "#9aa0a8",
  industrial: "#8a8a8a",
  other: "#7d7d7d",
};
for (const b of map.buildings) {
  parts.push(
    `<path d="${pathOf(b.footprint, true)}" fill="${BUILDING_COLORS[b.category]}" stroke="#222" stroke-width="0.6"/>`,
  );
}

const TREE_COLORS: Record<TreeSpecies, string> = { palm: "#e2b33c", pine: "#1f5e2e", common: "#2f8f3a", bush: "#9bd46a" };
for (const t of map.trees) {
  parts.push(`<circle cx="${px(t.x)}" cy="${pz(t.z)}" r="${t.species === "bush" ? 1.5 : 2.5}" fill="${TREE_COLORS[t.species]}" stroke="#103010" stroke-width="0.4"/>`);
}

for (const l of map.trafficLights) {
  parts.push(`<rect x="${(l.x - minX - 3).toFixed(1)}" y="${(l.z - minZ - 3).toFixed(1)}" width="6" height="6" fill="#ffe000" stroke="#000" stroke-width="1"/>`);
}

for (const s of map.spawns) {
  const tx = s.x + Math.sin(s.yaw) * 9;
  const tz = s.z + Math.cos(s.yaw) * 9;
  parts.push(
    `<line x1="${px(s.x)}" y1="${pz(s.z)}" x2="${px(tx)}" y2="${pz(tz)}" stroke="#ff1744" stroke-width="1.5"/>` +
      `<circle cx="${px(s.x)}" cy="${pz(s.z)}" r="3.5" fill="#ff1744" stroke="#fff" stroke-width="1"/>`,
  );
}

if (map.campus.length) {
  parts.push(`<path d="${pathOf(map.campus, true)}" fill="none" stroke="#1030ff" stroke-width="2" stroke-dasharray="10 6"/>`);
}

// Labels for named buildings and the main named streets.
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
for (const b of map.buildings) {
  if (!b.name) continue;
  const [cx, cz] = polygonCentroid(b.footprint);
  parts.push(
    `<text x="${px(cx)}" y="${pz(cz)}" font-size="9" text-anchor="middle" font-family="Arial" fill="#000" stroke="#fff" stroke-width="2.5" paint-order="stroke">${esc(b.name)}</text>`,
  );
}
const labelled = new Set<string>();
for (const r of map.roads) {
  if (!r.name || r.lanes === 0 || labelled.has(r.name) || r.points.length < 2) continue;
  labelled.add(r.name);
  const [x, z] = r.points[Math.floor(r.points.length / 2)];
  parts.push(
    `<text x="${px(x)}" y="${pz(z)}" font-size="10" font-style="italic" font-family="Arial" fill="#802000" stroke="#fff" stroke-width="2.5" paint-order="stroke">${esc(r.name)}</text>`,
  );
}

// North arrow + scale bar.
parts.push(
  `<g transform="translate(${W - 40},50)"><path d="M0 -30 L10 0 L0 -6 L-10 0Z" fill="#000"/><text y="18" font-size="16" text-anchor="middle" font-family="Arial">N</text></g>`,
  `<g transform="translate(20,${H - 20})"><rect width="100" height="5" fill="#000"/><text y="-6" font-size="12" font-family="Arial">100 m</text></g>`,
);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>\n`;
mkdirSync(path.dirname(outSvg), { recursive: true });
writeFileSync(outSvg, svg, "utf8");
console.log(`SVG: ${outSvg}`);

// Optional PNG through the system Chrome.
try {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.goto(pathToFileURL(outSvg).href);
  const outPng = outSvg.replace(/\.svg$/i, ".png");
  await page.screenshot({ path: outPng });
  await browser.close();
  console.log(`PNG: ${outPng}`);
} catch (err) {
  console.warn(`PNG skipped (${(err as Error).message.split("\n")[0]})`);
}
