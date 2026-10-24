// Traffic lights at the map's signalled junctions: one pole + head on the
// right-hand kerb of every approach, facing the oncoming traffic, with its
// lamps showing that approach's phase (vehicles/roadNetwork.ts signalState,
// the same function the traffic AI obeys). Poles/heads are instanced; the
// lamps are one InstancedMesh per colour slot with per-instance colours.

import * as THREE from "three";
import { lam, inst } from "./materials";
import type { CollisionGrid } from "./colliders";
import { signalState, type RoadNetwork, type SignalColor } from "../vehicles/roadNetwork";

const LIT: Record<SignalColor, number> = { R: 0xff2a2a, Y: 0xffc21a, G: 0x2aff5a };
const DIM: Record<SignalColor, number> = { R: 0x3a0808, Y: 0x3a2d05, G: 0x063a14 };
const SLOTS: SignalColor[] = ["R", "Y", "G"];
/** Pole height and head centre above the ground. */
const HEAD_Y = 4.4;

export interface Signals {
  /** Refreshes the lamp colours for game time `t` (s). */
  update(t: number): void;
  /** Number of signal heads (one per approach). */
  readonly count: number;
}

interface Head {
  junction: number;
  group: 0 | 1;
}

export function buildSignals(scene: THREE.Scene, net: RoadNetwork, height: (x: number, z: number) => number, grid: CollisionGrid): Signals {
  const heads: Head[] = [];
  const poles: { x: number; y: number; z: number }[] = [];
  const boxes: { x: number; y: number; z: number; ry: number }[] = [];
  const lamps: { x: number; y: number; z: number }[][] = [[], [], []];
  const seen = new Set<string>();
  for (let e = 0; e < net.edges.length; e++) {
    const j = net.stopJunction(e);
    if (j < 0) continue;
    const edge = net.edges[e];
    // One head per road approach (dual lanes / duplicate edges share it).
    const key = `${j}:${edge.road}:${edge.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const lanes = net.lanesOf(e);
    const lane = net.lanePath(e, lanes - 1);
    const end = lane.pts[lane.pts.length - 1];
    const yaw = net.endBearing(e);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    // Right-hand side of travel, out to the kerb.
    const rx = -fz;
    const rz = fx;
    const road = net.roads[edge.road];
    const out = road.width / 2 - net.laneOffset(e, lanes - 1) + 0.9;
    const px = end[0] + rx * out - fx * 1.0;
    const pz = end[1] + rz * out - fz * 1.0;
    const gy = height(px, pz);
    poles.push({ x: px, y: gy + HEAD_Y / 2, z: pz });
    // The head faces the approaching cars (against the travel direction).
    boxes.push({ x: px, y: gy + HEAD_Y, z: pz, ry: yaw + Math.PI });
    [0.45, 0, -0.45].forEach((o, n) => lamps[n].push({ x: px - fx * 0.24, y: gy + HEAD_Y + o, z: pz - fz * 0.24 }));
    grid.addCirc(px, pz, 0.2, gy, HEAD_Y + 0.8);
    heads.push({ junction: j, group: net.approachGroup(e) });
  }
  inst(scene, new THREE.CylinderGeometry(0.1, 0.1, HEAD_Y, 8), lam(0x444a50), poles, true);
  inst(scene, new THREE.BoxGeometry(0.5, 1.5, 0.42), lam(0x16181b), boxes, true);
  const lampGeo = new THREE.SphereGeometry(0.17, 8, 6);
  const lampMeshes = SLOTS.map((_, n) => {
    const m = inst(scene, lampGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), lamps[n], false);
    for (let i = 0; i < lamps[n].length; i++) m.setColorAt(i, new THREE.Color(DIM[SLOTS[n]]));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    return m;
  });
  const last: SignalColor[] = heads.map(() => "R");
  const color = new THREE.Color();
  let first = true;

  return {
    count: heads.length,
    update(t: number) {
      let dirty = first;
      heads.forEach((h, i) => {
        const st = signalState(net.junctionOffset(h.junction), h.group, t);
        if (!first && st === last[i]) return;
        last[i] = st;
        dirty = true;
        SLOTS.forEach((slot, n) => lampMeshes[n].setColorAt(i, color.setHex(st === slot ? LIT[slot] : DIM[slot])));
      });
      first = false;
      if (dirty) for (const m of lampMeshes) if (m.instanceColor) m.instanceColor.needsUpdate = true;
    },
  };
}
