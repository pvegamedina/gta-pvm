// Street furniture from furniturePlacement.ts: street lamps (procedural pole
// + arm + head, a glowing lens and a light pool on the ground at night, plus
// a few real point lights pooled around the camera), benches and bins,
// MegaKit bollards and planters, bike racks with parked bicycles and traffic
// cones. One InstancedMesh per prop kind for the whole campus; small props
// only keep the instances near the camera (the instance buffer is compacted
// every few metres of camera movement), so each kind is one draw call and
// far props cost nothing. Solid props get circle colliders.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { CollisionGrid } from "../colliders";
import type { Environment } from "../environment";
import { radialTex } from "../materials";
import type { MegakitAssets } from "../../assets/megakit";
import type { PropAssets } from "../../assets/props";
import { appendArrays, buildDisc, emptyArrays } from "./ribbon";
import type { PropKind, PropPlacement } from "./furniturePlacement";
import { DistanceInstances } from "../distanceInstances";

/** Small props (benches, bins, bikes, cones, bollards, planters) are drawn within this distance (m). */
export const PROP_VIEW = 170;
/** Real point lights moved to the lamps nearest the camera. */
export const LAMP_LIGHTS = 4;
const LAMP_HEIGHT = 7.6;
const LAMP_ARM = 1.7;
const POOL_RADIUS = 5.5;
/** Ground lift (m) per prop kind (sidewalk top for lamps, paving for bollards...). */
const LIFT: Record<PropKind, number> = { lamp: 0.15, bench: 0.02, bin: 0.02, bollard: 0.04, planter: 0.04, bicycle: 0.02, cone: 0.02 };
/** Model scale of the transport-pack props (their OBJ units are not metres). */
const BIKE_SCALE = 0.34;
const CONE_SCALE = 0.55;
/** Bicycle frame colours. */
const BIKE_COLORS = [0xc0392b, 0x2c3e50, 0x27ae60, 0xd8d8d8, 0x2980b9, 0xf1c40f, 0x111111];

export interface FurnitureBuild {
  group: THREE.Group;
  /** Distance culling of small props + pooled lamp lights; call every frame. */
  update(x: number, z: number, nightF: number, all?: boolean): void;
  stats: { counts: Partial<Record<PropKind, number>>; drawCalls: number; lights: number };
}

function coloured(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (k !== "position" && k !== "normal") out.deleteAttribute(k);
  const c = new THREE.Color(color);
  const n = out.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  out.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return out;
}

/** Lamp body: tapered pole, arm reaching over the road (+z) and the head. */
function lampGeometry(): THREE.BufferGeometry {
  const metal = 0x4b5257;
  return mergeGeometries([
    coloured(new THREE.CylinderGeometry(0.06, 0.1, LAMP_HEIGHT, 8).translate(0, LAMP_HEIGHT / 2, 0), metal),
    coloured(new THREE.BoxGeometry(0.07, 0.07, LAMP_ARM).translate(0, LAMP_HEIGHT - 0.05, LAMP_ARM / 2), metal),
    coloured(new THREE.BoxGeometry(0.34, 0.14, 0.7).translate(0, LAMP_HEIGHT - 0.12, LAMP_ARM), 0x3a3f43),
  ])!;
}

function benchGeometry(): THREE.BufferGeometry {
  const wood = 0x8a5a33;
  const metal = 0x2d3033;
  return mergeGeometries([
    coloured(new THREE.BoxGeometry(1.8, 0.07, 0.42).translate(0, 0.45, 0), wood),
    coloured(new THREE.BoxGeometry(1.8, 0.36, 0.06).rotateX(-0.18).translate(0, 0.72, -0.22), wood),
    coloured(new THREE.BoxGeometry(0.07, 0.45, 0.46).translate(-0.75, 0.225, 0), metal),
    coloured(new THREE.BoxGeometry(0.07, 0.45, 0.46).translate(0.75, 0.225, 0), metal),
  ])!;
}

function binGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    coloured(new THREE.CylinderGeometry(0.24, 0.22, 0.82, 10).translate(0, 0.41, 0), 0x3d5a45),
    coloured(new THREE.CylinderGeometry(0.26, 0.26, 0.06, 10).translate(0, 0.85, 0), 0x2a2d2f),
  ])!;
}

function shrubGeometry(): THREE.BufferGeometry {
  return coloured(new THREE.IcosahedronGeometry(0.75, 0).scale(1, 0.7, 1).translate(0, 0.95, 0), 0x3f6b2c);
}

export function buildFurniture(
  placements: readonly PropPlacement[],
  assets: { props: PropAssets | null; megakit: MegakitAssets | null },
  ground: (x: number, z: number) => number,
  grid: CollisionGrid,
  env: Environment,
): FurnitureBuild {
  const group = new THREE.Group();
  group.name = "furniture";
  const byKind = new Map<PropKind, PropPlacement[]>();
  for (const p of placements) {
    let l = byKind.get(p.kind);
    if (!l) byKind.set(p.kind, (l = []));
    l.push(p);
  }
  const counts: Partial<Record<PropKind, number>> = {};
  const near: DistanceInstances[] = [];
  const vertexMat = new THREE.MeshLambertMaterial({ vertexColors: true, name: "Furniture" });
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const matrixOf = (p: PropPlacement, scale = 1, yawOffset = 0) => {
    q.setFromAxisAngle(up, p.yaw + yawOffset);
    return new THREE.Matrix4().compose(pos.set(p.x, ground(p.x, p.z) + LIFT[p.kind], p.z), q, one.clone().multiplyScalar(scale));
  };
  const addNear = (geometry: THREE.BufferGeometry, material: THREE.Material, list: PropPlacement[], opts: { scale?: number; yawOffset?: number; color?: (p: PropPlacement, i: number) => number; shadow?: boolean } = {}) => {
    const ni = new DistanceInstances(
      geometry,
      material,
      list.map((p, i) => ({ matrix: matrixOf(p, opts.scale ?? 1, opts.yawOffset ?? 0), x: p.x, z: p.z, color: opts.color?.(p, i) })),
      0,
      PROP_VIEW,
    );
    ni.mesh.castShadow = !!opts.shadow;
    ni.mesh.receiveShadow = true;
    group.add(ni.mesh);
    near.push(ni);
    return ni;
  };
  /** Circle colliders along the prop's local x axis (benches, bikes) or one at the centre. */
  const collide = (p: PropPlacement, r: number, h: number, along = 0) => {
    const y0 = ground(p.x, p.z);
    if (along === 0) {
      grid.addCirc(p.x, p.z, r, y0, h);
      return;
    }
    const ax = Math.cos(p.yaw);
    const az = -Math.sin(p.yaw);
    for (const k of [-1, 1]) grid.addCirc(p.x + ax * along * k, p.z + az * along * k, r, y0, h);
  };

  // --- Street lamps (always drawn: lit heads matter from afar at night).
  const lamps = byKind.get("lamp") ?? [];
  counts.lamp = lamps.length;
  const heads: THREE.Vector3[] = [];
  if (lamps.length > 0) {
    const body = new THREE.InstancedMesh(lampGeometry(), vertexMat, lamps.length);
    const lensMat = new THREE.MeshBasicMaterial({ color: 0x8c8c80, name: "LampLens" });
    const lens = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.28, 0.6).rotateX(Math.PI / 2).translate(0, LAMP_HEIGHT - 0.195, LAMP_ARM), lensMat, lamps.length);
    const pools = emptyArrays();
    lamps.forEach((p, i) => {
      const m = matrixOf(p);
      body.setMatrixAt(i, m);
      lens.setMatrixAt(i, m);
      const hx = p.x + Math.sin(p.yaw) * LAMP_ARM;
      const hz = p.z + Math.cos(p.yaw) * LAMP_ARM;
      heads.push(new THREE.Vector3(hx, ground(p.x, p.z) + LIFT.lamp + LAMP_HEIGHT - 0.3, hz));
      const disc = buildDisc(hx, hz, POOL_RADIUS, 16, ground, 0.18);
      appendArrays(pools, disc);
      collide(p, 0.16, LAMP_HEIGHT);
    });
    for (const m of [body, lens]) {
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
      group.add(m);
    }
    body.castShadow = true;
    body.name = "furniture:lampBody";
    lens.name = "furniture:lampLens";
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pools.positions, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(pools.uvs, 2));
    g.setIndex(pools.indices);
    g.computeBoundingSphere();
    const poolMat = new THREE.MeshBasicMaterial({
      map: radialTex([
        [0, "rgba(255,214,150,1)"],
        [0.4, "rgba(255,200,130,0.6)"],
        [1, "rgba(255,190,120,0)"],
      ]),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -12,
      name: "LampPool",
    });
    const poolMesh = new THREE.Mesh(g, poolMat);
    poolMesh.name = "furniture:lampPools";
    poolMesh.renderOrder = 2;
    group.add(poolMesh);
    // The environment drives the lens colour and pool opacity with the time of day.
    env.lightMats.bulb = lensMat;
    env.lightMats.pool = poolMat;
  }
  const lights: THREE.PointLight[] = [];
  for (let i = 0; i < LAMP_LIGHTS && heads.length > 0; i++) {
    const l = new THREE.PointLight(0xffc98a, 0, 22, 1.1);
    l.castShadow = false;
    group.add(l);
    lights.push(l);
  }

  // --- Benches, bins, planters, bollards (MegaKit), bicycles and cones near the camera.
  const benches = byKind.get("bench") ?? [];
  counts.bench = benches.length;
  if (benches.length) addNear(benchGeometry(), vertexMat, benches);
  for (const p of benches) collide(p, 0.32, 1, 0.55);
  const bins = byKind.get("bin") ?? [];
  counts.bin = bins.length;
  if (bins.length) addNear(binGeometry(), vertexMat, bins);
  for (const p of bins) collide(p, 0.28, 1);

  const mk = assets.megakit;
  const metalMat = new THREE.MeshLambertMaterial({ map: mk?.textures.metal ?? null, color: mk?.textures.metal ? 0xffffff : 0x55595d, name: "PropMetal" });
  const bollards = byKind.get("bollard") ?? [];
  counts.bollard = bollards.length;
  const bollardGeo = mk?.modules.get("Prop_Bollard")?.get("metal") ?? new THREE.CylinderGeometry(0.11, 0.11, 0.9, 8).translate(0, 0.45, 0);
  if (bollards.length) addNear(bollardGeo, metalMat, bollards);
  for (const p of bollards) collide(p, 0.13, 0.9);
  const planterList = byKind.get("planter") ?? [];
  counts.planter = planterList.length;
  if (planterList.length) {
    const parts = mk?.modules.get("Prop_Planter_Single");
    const box = parts?.get("metal") ?? new THREE.BoxGeometry(2, 0.6, 2).translate(0, 0.3, 0);
    addNear(box, metalMat, planterList, { scale: 0.75 });
    const dirt = parts?.get("dirt");
    if (dirt && mk?.textures.dirt) addNear(dirt, new THREE.MeshLambertMaterial({ map: mk.textures.dirt, name: "PlanterDirt" }), planterList, { scale: 0.75 });
    addNear(shrubGeometry(), vertexMat, planterList, { scale: 0.75 });
  }
  for (const p of planterList) collide(p, 0.78, 1.2);

  const props = assets.props;
  const bikes = byKind.get("bicycle") ?? [];
  counts.bicycle = bikes.length;
  if (props && bikes.length) {
    for (const [variant, name] of [
      [0, "bicycle"],
      [1, "bicycle_2"],
    ] as const) {
      const model = props.get(name);
      const list = bikes.filter((b) => b.variant === variant);
      // The bikes' front wheel is at -z in the model: turn them so +z is the front.
      if (model && list.length) addNear(model.geometry, vertexMat, list, { scale: BIKE_SCALE, yawOffset: Math.PI, color: (_p, i) => BIKE_COLORS[(i * 3 + variant) % BIKE_COLORS.length] });
    }
  }
  for (const p of bikes) collide(p, 0.25, 1.1, 0);
  const cones = byKind.get("cone") ?? [];
  counts.cone = cones.length;
  const coneModel = props?.get("traffic_cone");
  if (coneModel && cones.length) addNear(coneModel.geometry, vertexMat, cones, { scale: CONE_SCALE });
  for (const p of cones) collide(p, 0.2, 0.7);

  let lightTimer = 0;
  let lastFocus = { x: Infinity, z: Infinity };
  return {
    group,
    stats: { counts, drawCalls: group.children.filter((c) => (c as THREE.Mesh).isMesh).length, lights: lights.length },
    update(x, z, nightF, all = false) {
      for (const n of near) n.update(x, z, all);
      if (lights.length === 0) return;
      // Re-pick the nearest lamps when the focus moved a bit (cheap scan of the lamp list).
      lightTimer--;
      if (lightTimer <= 0 || Math.hypot(x - lastFocus.x, z - lastFocus.z) > 4) {
        lightTimer = 15;
        lastFocus = { x, z };
        const best = heads
          .map((h, i) => ({ i, d: (h.x - x) ** 2 + (h.z - z) ** 2 }))
          .sort((a, b) => a.d - b.d)
          .slice(0, lights.length);
        best.forEach((b, k) => lights[k].position.copy(heads[b.i]));
      }
      const k = Math.max(0, (nightF - 0.25) / 0.75);
      for (const l of lights) l.intensity = k * 3.2;
    },
  };
}
