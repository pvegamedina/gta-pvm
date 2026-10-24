// Traffic lights at the map's signalled junctions: one pole + head on the
// right-hand kerb of every approach, beside its painted stop line, facing the
// oncoming traffic, with its lamps showing that approach's phase
// (vehicles/roadNetwork.ts signalState, the same function the traffic AI
// obeys). Poles/heads are instanced; the lamps are one InstancedMesh per
// colour slot with per-instance colours. Once the transport-pack props load,
// useModel() swaps the procedural pole + box for the TrafficLight model and
// moves the lamps onto its lenses.

import * as THREE from "three";
import { lam, inst } from "./materials";
import type { CollisionGrid } from "./colliders";
import { signalState, type RoadNetwork, type SignalColor } from "../vehicles/roadNetwork";
import type { PropModel } from "../assets/props";

const LIT: Record<SignalColor, number> = { R: 0xff2a2a, Y: 0xffc21a, G: 0x2aff5a };
const DIM: Record<SignalColor, number> = { R: 0x3a0808, Y: 0x3a2d05, G: 0x063a14 };
const SLOTS: SignalColor[] = ["R", "Y", "G"];
/** Pole height and head centre above the ground. */
const HEAD_Y = 4.4;
/** Height (m) the TrafficLight model is scaled to. */
const MODEL_HEIGHT = 4.6;

export interface Signals {
  /** Refreshes the lamp colours for game time `t` (s). */
  update(t: number): void;
  /** Number of signal heads (one per approach). */
  readonly count: number;
  /** Replaces the procedural poles with the TrafficLight model (null keeps them). */
  useModel(model: PropModel | null): void;
}

interface Head {
  junction: number;
  group: 0 | 1;
  /** Pole base and the direction the head faces (towards the approaching cars). */
  x: number;
  y: number;
  z: number;
  facing: number;
}

export function buildSignals(scene: THREE.Scene, net: RoadNetwork, height: (x: number, z: number) => number, grid: CollisionGrid): Signals {
  const heads: Head[] = [];
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
    // Beside the painted stop line (markings.ts), or just short of the lane end when unpainted.
    const back = Math.max(1, net.stopSetback(e) - 0.5);
    const px = end[0] + rx * out - fx * back;
    const pz = end[1] + rz * out - fz * back;
    const gy = height(px, pz);
    grid.addCirc(px, pz, 0.2, gy, HEAD_Y + 0.8);
    heads.push({ junction: j, group: net.approachGroup(e), x: px, y: gy, z: pz, facing: yaw + Math.PI });
  }

  // Procedural stand-in: pole + box head; lamps on the box face.
  const poles = inst(scene, new THREE.CylinderGeometry(0.1, 0.1, HEAD_Y, 8), lam(0x444a50), heads.map((h) => ({ x: h.x, y: h.y + HEAD_Y / 2, z: h.z })), true);
  const boxes = inst(scene, new THREE.BoxGeometry(0.5, 1.5, 0.42), lam(0x16181b), heads.map((h) => ({ x: h.x, y: h.y + HEAD_Y, z: h.z, ry: h.facing })), true);
  const lampGeo = new THREE.SphereGeometry(0.17, 8, 6);
  const lampPositions = (offsets: [number, number, number][]) =>
    SLOTS.map((_, n) =>
      heads.map((h) => {
        // offsets: [forward (towards the cars), up, right] relative to the pole base.
        const [f, u, r] = offsets[n];
        const fx = Math.sin(h.facing);
        const fz = Math.cos(h.facing);
        return { x: h.x + fx * f - fz * r, y: h.y + u, z: h.z + fz * f + fx * r };
      }),
    );
  const boxOffsets: [number, number, number][] = [
    [0.24, HEAD_Y + 0.45, 0],
    [0.24, HEAD_Y, 0],
    [0.24, HEAD_Y - 0.45, 0],
  ];
  const initial = lampPositions(boxOffsets);
  const lampMeshes = SLOTS.map((_, n) => {
    const m = inst(scene, lampGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), initial[n], false);
    for (let i = 0; i < heads.length; i++) m.setColorAt(i, new THREE.Color(DIM[SLOTS[n]]));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    return m;
  });
  const last: SignalColor[] = heads.map(() => "R");
  const color = new THREE.Color();
  let first = true;
  const dummy = new THREE.Object3D();

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
    useModel(model) {
      if (!model || heads.length === 0 || model.parts.length < 4) return;
      const s = MODEL_HEIGHT / Math.max(0.1, model.box.max.y - model.box.min.y);
      // The model's lenses face -x: turn -x towards the cars (rotation = facing + 90 degrees).
      const items = heads.map((h) => ({ x: h.x, y: h.y, z: h.z, ry: h.facing + Math.PI / 2, sx: s, sy: s, sz: s }));
      inst(scene, model.geometry, new THREE.MeshLambertMaterial({ vertexColors: true, name: "TrafficLight" }), items, true);
      poles.visible = false;
      boxes.visible = false;
      // Lens order in the model: green (lowest), yellow, red -> our slots R, Y, G. Lamps sit just in front of the lenses.
      // Local -x is forward and local +z is to the left of the facing direction.
      const lens = (k: number): [number, number, number] => [-model.parts[k].x * s + 0.05, model.parts[k].y * s, -model.parts[k].z * s];
      const offsets = [lens(3), lens(2), lens(1)];
      const moved = lampPositions(offsets);
      const r = (0.09 * s) / 2.4;
      SLOTS.forEach((_, n) => {
        moved[n].forEach((p, i) => {
          dummy.position.set(p.x, p.y, p.z);
          dummy.scale.setScalar(Math.max(0.6, r / 0.17));
          dummy.updateMatrix();
          lampMeshes[n].setMatrixAt(i, dummy.matrix);
        });
        lampMeshes[n].instanceMatrix.needsUpdate = true;
      });
    },
  };
}
