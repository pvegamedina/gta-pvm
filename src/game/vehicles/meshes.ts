// Vehicle instances: the runtime Vehicle record used by player physics,
// traffic AI and remote players, built from the catalogue spec + a model
// template (vehicleAssets.ts). Geometries and materials are shared; each car
// only owns its Object3D tree. visualVeh() animates wheels (roll + steer),
// lamps (head / tail / brake / reverse) and the police light bar.
// Shadows come from one merged proxy per vehicle (shadowProxy.ts) on the
// shadow-only layer instead of from each of its ~10 parts.

import * as THREE from "three";
import { advanceWheelSpin, sirenFlash, vehicleLightState, type TailLight } from "./animation";
import { VEHICLE_CATALOG } from "./catalog";
import { LAMP_ON, paintMaterial, vehicleTemplate, type PartRole, type PartTemplate } from "./vehicleAssets";
import type { VehicleMode, VehicleSpec, VehicleTypeKey } from "./types";
import type { Driver } from "./roadNetwork";
import { shadowProxyBoxes } from "./shadowProxy";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type { VehicleMode } from "./types";

/** Traffic AI state (vehicles/traffic.ts): where the car is on the road network and how it drives. */
export interface TrafficAiState {
  driver: Driver;
  /** Personal speed factor (cautious < 1 < sporty). */
  temper: number;
  /** Acceleration (m/s²). */
  acc: number;
  /** Seconds spent blocked behind something while it should be moving. */
  stuck: number;
  /** Seconds left ignoring other AI cars after being stuck (unjams gridlocks). */
  ghost: number;
}

interface Lamp {
  mesh: THREE.Mesh;
  off: THREE.Material;
}

/** The parts of a vehicle's scene graph that animate. */
export interface VehicleVisual {
  /** Spin groups (rotation.x = roll angle) of every wheel / axle. */
  spin: THREE.Object3D[];
  /** Steering pivots of the front wheels (rotation.y = steer angle). */
  steer: THREE.Object3D[];
  head: Lamp[];
  tail: Lamp[];
  reverse: Lamp[];
  barRed: Lamp[];
  barBlue: Lamp[];
  /** Built from the procedural stand-in (swap for the GLB once it loads). */
  fallback: boolean;
  /** Last applied lamp state (materials are only reassigned on change). */
  lit: { head: boolean; tail: TailLight; reverse: boolean; red: boolean; blue: boolean };
  /** A parked car whose final pose/lamps were applied (the game skips it until it moves again). */
  settled: boolean;
}

export interface Vehicle {
  type: VehicleTypeKey;
  spec: VehicleSpec;
  root: THREE.Group;
  /** Pitches/rolls with the suspension; holds the body meshes and the hitbox. */
  body: THREE.Group;
  /** Invisible box registered as the shootable (cheap raycasts instead of the GLB triangles). */
  hitbox: THREE.Mesh;
  visual: VehicleVisual;
  x: number;
  z: number;
  y: number;
  yaw: number;
  vx: number;
  vz: number;
  speed: number;
  steer: number;
  steerVis: number;
  /** Wheel roll angle (rad, wrapped). */
  spin: number;
  mode: VehicleMode;
  braking: boolean;
  /** Light bar + siren on (police only). */
  siren: boolean;
  /** Light-bar flash clock (s). */
  sirenT: number;
  ai: TrafficAiState | null;
  pitch: number;
  roll: number;
  /** Body pitch/roll from the ground slope under the wheels (added to pitch/roll). */
  tPitch: number;
  tRoll: number;
  prevF: number;
  /** Body tint (display sRGB); also sent over the network. Ignored by livery types. */
  color: number;
  /** Network id when this is another player's vehicle (local vehicles leave this null). */
  remoteOwnerId?: string;
}

const hitboxGeos = new Map<VehicleTypeKey, THREE.BoxGeometry>();
const hitboxMaterial = new THREE.MeshBasicMaterial();
/** Hitbox bottom above the ground (m): shots under the chassis pass. */
const HITBOX_FLOOR = 0.25;

function hitboxGeometry(spec: VehicleSpec): THREE.BoxGeometry {
  let g = hitboxGeos.get(spec.key);
  if (!g) {
    const h = spec.H - HITBOX_FLOOR;
    g = new THREE.BoxGeometry(spec.W, h, spec.L).translate(0, HITBOX_FLOOR + h / 2, spec.zc);
    hitboxGeos.set(spec.key, g);
  }
  return g;
}

/**
 * Layer seen only by the sun's shadow camera (world/environment.ts enables
 * it there; the view cameras keep the default layer 0): shadow proxies.
 */
export const SHADOW_ONLY_LAYER = 1;

const proxyGeos = new Map<VehicleTypeKey, THREE.BufferGeometry>();
const proxyMaterial = new THREE.MeshBasicMaterial();

/** One merged low-poly caster per vehicle type (shadowProxy.ts layout). */
function shadowProxy(spec: VehicleSpec): THREE.Mesh {
  let g = proxyGeos.get(spec.key);
  if (!g) {
    const boxes = shadowProxyBoxes(spec).map((b) => new THREE.BoxGeometry(b.w, b.h, b.l).translate(0, b.y, b.z));
    g = boxes.length === 1 ? boxes[0] : mergeGeometries(boxes)!;
    proxyGeos.set(spec.key, g);
  }
  const m = new THREE.Mesh(g, proxyMaterial);
  m.name = "vehicleShadow";
  m.castShadow = true;
  m.layers.set(SHADOW_ONLY_LAYER);
  return m;
}

function partMesh(p: PartTemplate, material: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(p.geometry, material);
  m.applyMatrix4(p.matrix);
  // The vehicle's shadow comes from its proxy (one draw call instead of one per part).
  m.castShadow = false;
  return m;
}

/** Scales model units to metres and lifts the wheels onto the ground. */
function modelGroup(spec: VehicleSpec): THREE.Group {
  const g = new THREE.Group();
  const s = spec.model.scale;
  g.scale.setScalar(s);
  g.position.y = -spec.model.geometry.wheelBottom * s;
  return g;
}

export function addVeh(scene: THREE.Scene, tk: VehicleTypeKey, color: number, x: number, z: number, yaw: number, mode: VehicleMode): Vehicle {
  const spec = VEHICLE_CATALOG[tk];
  const tpl = vehicleTemplate(tk);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const bodyModel = modelGroup(spec);
  body.add(bodyModel);
  const visual: VehicleVisual = {
    spin: [],
    steer: [],
    head: [],
    tail: [],
    reverse: [],
    barRed: [],
    barBlue: [],
    fallback: tpl.source === "fallback",
    lit: { head: false, tail: "off", reverse: false, red: false, blue: false },
    settled: false,
  };
  const tinted = spec.tint !== null;
  for (const p of tpl.body) {
    const mat = p.role === "paint" && tinted ? paintMaterial(color, p.shade) : p.material;
    const mesh = partMesh(p, mat);
    bodyModel.add(mesh);
    if (p.role === "head" || p.role === "tail" || p.role === "reverse" || p.role === "barRed" || p.role === "barBlue") visual[p.role].push({ mesh, off: p.material });
  }
  const wheelModel = modelGroup(spec);
  root.add(wheelModel);
  for (const w of tpl.wheels) {
    const pivot = new THREE.Group();
    pivot.position.copy(w.centre);
    const spin = new THREE.Group();
    pivot.add(spin);
    for (const p of w.parts) spin.add(partMesh(p, p.material));
    wheelModel.add(pivot);
    visual.spin.push(spin);
    if (w.front) visual.steer.push(pivot);
  }
  const hitbox = new THREE.Mesh(hitboxGeometry(spec), hitboxMaterial);
  hitbox.name = "vehicleHitbox";
  hitbox.visible = false;
  body.add(hitbox);
  body.add(shadowProxy(spec));
  scene.add(root);
  root.position.set(x, 0, z);
  root.rotation.y = yaw;
  return {
    type: tk,
    spec,
    root,
    body,
    hitbox,
    visual,
    x,
    z,
    y: 0,
    yaw,
    vx: 0,
    vz: 0,
    speed: 0,
    steer: 0,
    steerVis: 0,
    spin: 0,
    mode,
    braking: false,
    siren: false,
    sirenT: 0,
    ai: null,
    pitch: 0,
    roll: 0,
    tPitch: 0,
    tRoll: 0,
    prevF: 0,
    color,
  };
}

function setLamps(lamps: Lamp[], on: THREE.Material | null): void {
  for (const l of lamps) l.mesh.material = on ?? l.off;
}

/** Applies pose, wheel roll/steer and lamp states for this frame. */
export function visualVeh(v: Vehicle, dt: number, nightF: number): void {
  v.root.position.set(v.x, v.y, v.z);
  v.root.rotation.y = v.yaw;
  v.body.rotation.x = v.pitch + v.tPitch;
  v.body.rotation.z = v.roll + v.tRoll;
  const vis = v.visual;
  v.spin = advanceWheelSpin(v.spin, v.speed, dt, v.spec.wr);
  for (const s of vis.spin) s.rotation.x = v.spin;
  for (const p of vis.steer) p.rotation.y = v.steerVis;

  const ls = vehicleLightState({ nightF, braking: v.braking, speed: v.speed, mode: v.mode });
  const lit = vis.lit;
  if (ls.head !== lit.head) setLamps(vis.head, ls.head ? LAMP_ON.head : null);
  if (ls.tail !== lit.tail) setLamps(vis.tail, ls.tail === "brake" ? LAMP_ON.tailBrake : ls.tail === "run" ? LAMP_ON.tailRun : null);
  if (ls.reverse !== lit.reverse) setLamps(vis.reverse, ls.reverse ? LAMP_ON.reverse : null);
  const sirenOn = v.siren && v.spec.siren;
  if (sirenOn) v.sirenT += dt;
  const flash = sirenOn ? sirenFlash(v.sirenT) : { red: false, blue: false };
  if (flash.red !== lit.red) setLamps(vis.barRed, flash.red ? LAMP_ON.barRed : null);
  if (flash.blue !== lit.blue) setLamps(vis.barBlue, flash.blue ? LAMP_ON.barBlue : null);
  lit.head = ls.head;
  lit.tail = ls.tail;
  lit.reverse = ls.reverse;
  lit.red = flash.red;
  lit.blue = flash.blue;
  vis.settled = v.mode === "parked" && !sirenOn;
}

export function removeVeh(scene: THREE.Scene, v: Vehicle): void {
  scene.remove(v.root);
}
