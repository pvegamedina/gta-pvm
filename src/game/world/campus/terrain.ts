// Terrain mesh: the map heightfield as one indexed BufferGeometry (≈94k
// vertices / 186k triangles for the campus), textured with the baked ground
// painting and tinted earthier on steep slopes. Receives shadows; it does
// not cast them (the sun is never low enough for hills to matter here).
//
// Phase 4b: a tiling detail texture (blades / clumps of grass, soil grain)
// multiplies the 0.6 m/px painting in world space every DETAIL_TILE metres,
// so lawns and fields read as grass up close instead of a soft blur, plus a
// large-scale variation layer that breaks up flat colour on big fields.

import * as THREE from "three";
import type { CampusMap } from "../../map/loader";
import { buildTerrainArrays } from "./terrainMesh";
import { GROUND_PALETTE, paintMap } from "./mapPainter";

/** Ground texture resolution (px); ≈0.6 m per texel over the 1.2 km campus. */
const GROUND_TEX_SIZE = 2048;
/** Metres per repeat of the fine detail texture, and of the coarse variation layer. */
const DETAIL_TILE = 3;
const VARIATION_TILE = 37;

/** Tileable grass / soil detail (grey around 0.5: x2 in the shader keeps the mean colour). */
function detailTexture(anisotropy: number): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const x = c.getContext("2d")!;
  x.fillStyle = "rgb(128,128,128)";
  x.fillRect(0, 0, S, S);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Short strokes (blades / grain), drawn wrapped so the tile repeats seamlessly.
  for (let i = 0; i < 9000; i++) {
    const px = rnd() * S;
    const py = rnd() * S;
    const len = 2 + rnd() * 5;
    const a = -Math.PI / 2 + (rnd() - 0.5) * 1.2;
    const v = Math.round(128 + (rnd() - 0.5) * 90);
    x.strokeStyle = `rgba(${v},${v},${v},0.55)`;
    x.lineWidth = 1;
    for (const ox of [-S, 0, S]) {
      for (const oy of [-S, 0, S]) {
        x.beginPath();
        x.moveTo(px + ox, py + oy);
        x.lineTo(px + ox + Math.cos(a) * len, py + oy + Math.sin(a) * len);
        x.stroke();
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

/** Soft tileable blotches (large-scale brightness variation). */
function variationTexture(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const x = c.getContext("2d")!;
  x.fillStyle = "rgb(128,128,128)";
  x.fillRect(0, 0, S, S);
  let seed = 777;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 40; i++) {
    const cx = rnd() * S;
    const cy = rnd() * S;
    const r = 10 + rnd() * 30;
    const v = rnd() < 0.5 ? "rgba(160,160,160,0.35)" : "rgba(96,96,96,0.35)";
    for (const ox of [-S, 0, S]) {
      for (const oy of [-S, 0, S]) {
        const g = x.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, r);
        g.addColorStop(0, v);
        g.addColorStop(1, "rgba(128,128,128,0)");
        x.fillStyle = g;
        x.fillRect(cx + ox - r, cy + oy - r, r * 2, r * 2);
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export function buildTerrainMesh(map: CampusMap, anisotropy: number): THREE.Mesh {
  const a = buildTerrainArrays(map.terrainGrid);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(a.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(a.normals, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(a.uvs, 2));
  g.setAttribute("color", new THREE.BufferAttribute(a.colors, 3));
  g.setIndex(new THREE.BufferAttribute(a.indices, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();

  const canvas = paintMap(map, GROUND_PALETTE, GROUND_TEX_SIZE, GROUND_TEX_SIZE);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = anisotropy;
  tex.flipY = true;
  const mat = new THREE.MeshLambertMaterial({ map: tex, vertexColors: true });
  // Detail layers in world space: the UVs span the whole terrain, so scale them to metres.
  const spanX = (map.terrainGrid.width - 1) * map.terrainGrid.cellSize;
  const spanZ = (map.terrainGrid.height - 1) * map.terrainGrid.cellSize;
  const detail = detailTexture(anisotropy);
  const variation = variationTexture();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.detailMap = { value: detail };
    shader.uniforms.variationMap = { value: variation };
    shader.uniforms.detailScale = { value: new THREE.Vector2(spanX / DETAIL_TILE, spanZ / DETAIL_TILE) };
    shader.uniforms.variationScale = { value: new THREE.Vector2(spanX / VARIATION_TILE, spanZ / VARIATION_TILE) };
    const header = ["uniform sampler2D detailMap;", "uniform sampler2D variationMap;", "uniform vec2 detailScale;", "uniform vec2 variationScale;"];
    const body = [
      "float dDetail = texture2D(detailMap, vMapUv * detailScale).r * 2.0;",
      "float dVar = texture2D(variationMap, vMapUv * variationScale).r * 2.0;",
      // Stronger on green ground (lawns), milder on asphalt / paving.
      "float greenish = clamp((diffuseColor.g - max(diffuseColor.r, diffuseColor.b)) * 6.0, 0.0, 1.0);",
      "diffuseColor.rgb *= mix(1.0, dDetail, 0.35 + 0.35 * greenish) * mix(1.0, dVar, 0.5 * greenish + 0.15);",
    ];
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", ["#include <common>", ...header].join("\n"))
      .replace("#include <map_fragment>", ["#include <map_fragment>", ...body].join("\n"));
  };
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  mesh.name = "terrain";
  return mesh;
}
