// Landuse detail drawn as geometry: crisp line markings on the sports
// pitches (pitchLines.ts, by OSM sport), draped on the terrain as thin white
// strips merged into one mesh (one draw call). The pitch colours themselves
// stay in the baked ground painting (mapPainter.ts).

import * as THREE from "three";
import type { CampusMap } from "../../map/loader";
import { appendArrays, buildRibbon, emptyArrays } from "./ribbon";
import { pitchMarkings } from "./pitchLines";

/** Line width (m) and lift above the terrain. */
const LINE_WIDTH = 0.12;
const LINE_LIFT = 0.03;

export interface PitchLinesBuild {
  mesh: THREE.Mesh | null;
  stats: { pitches: number; lines: number; triangles: number };
}

export function buildPitchLines(map: CampusMap, height: (x: number, z: number) => number): PitchLinesBuild {
  const arrays = emptyArrays();
  let pitches = 0;
  let lines = 0;
  for (const l of map.landuse) {
    if (l.kind !== "pitch") continue;
    const marks = pitchMarkings(l.points, l.sport);
    if (marks.length === 0) continue;
    pitches++;
    for (const line of marks) {
      appendArrays(arrays, buildRibbon(line, { left: -LINE_WIDTH / 2, right: LINE_WIDTH / 2, across: 1, maxSegment: 2, height: (x, z) => height(x, z), lift: LINE_LIFT }));
      lines++;
    }
  }
  if (arrays.indices.length === 0) return { mesh: null, stats: { pitches, lines, triangles: 0 } };
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(arrays.positions, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(arrays.normals, 3));
  g.setIndex(new THREE.Uint32BufferAttribute(arrays.indices, 1));
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xe8e8e2, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  mesh.receiveShadow = true;
  mesh.name = "landuse:pitchLines";
  return { mesh, stats: { pitches, lines, triangles: arrays.indices.length / 3 } };
}
