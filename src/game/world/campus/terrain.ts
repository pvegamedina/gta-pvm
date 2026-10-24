// Terrain mesh: the map heightfield as one indexed BufferGeometry (≈94k
// vertices / 186k triangles for the campus), textured with the baked ground
// painting and tinted earthier on steep slopes. Receives shadows; it does
// not cast them (the sun is never low enough for hills to matter here).

import * as THREE from "three";
import type { CampusMap } from "../../map/loader";
import { buildTerrainArrays } from "./terrainMesh";
import { GROUND_PALETTE, paintMap } from "./mapPainter";

/** Ground texture resolution (px); ≈0.6 m per texel over the 1.2 km campus. */
const GROUND_TEX_SIZE = 2048;

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
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  mesh.name = "terrain";
  return mesh;
}
