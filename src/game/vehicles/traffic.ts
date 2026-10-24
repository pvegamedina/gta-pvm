// Traffic AI on the campus road graph: each car follows its lane along the
// directed road edges (right-hand traffic, one-ways respected), picks a
// random exit at junctions (no U-turns unless the road ends), slows for
// bends, keeps its distance to the car / on-foot player ahead and stops at
// red lights at the mapped signalled junctions. Cars are spawned around the
// player and recycled when they drift far away. Parked cars line residential
// streets and fill the mapped car parks. Buses only appear on main roads and
// cruise slower; an ambulance now and then runs with its siren on.
// Uses Math.random() deliberately — traffic is local-only ambient behaviour.

import * as THREE from "three";
import { angDiff, angLerp, clamp } from "../core/math";
import { groundY } from "../world/ground";
import { addVeh, removeVeh, type Vehicle } from "./meshes";
import { VEHICLE_CATALOG, isMainRoad, pickTint, pickTrafficType, pickVehicleType } from "./catalog";
import type { SpawnPool, VehicleTypeKey } from "./types";
import {
  advanceDriver,
  createDriver,
  distanceToStop,
  driverPosition,
  signalState,
  turnAhead,
  type RoadNetwork,
} from "./roadNetwork";
import { terrainPose } from "./terrainPose";
import type { CampusMap } from "../map/loader";
import type { RoadClass, Vec2 } from "../map/types";
import { bboxOf, pointInPolygon } from "../map/geometry";
import { cumulativeLengths, offsetPolyline } from "../world/campus/ribbon";

/** Livery cars (taxi, police) ignore the colour; it is still sent over the network. */
const LIVERY_COLOR = 0xffffff;

// ---- Tunables -------------------------------------------------------------
/** AI cars kept alive around the player. */
export const TRAFFIC_COUNT = 26;
/** New cars appear between these distances (m) from the player. */
const SPAWN_MIN = 70;
const SPAWN_MAX = 260;
/** Cars farther than this are recycled. */
const DESPAWN = 330;
/** Parked cars per mapped car park, and along residential kerbs in total. */
const PARKED_PER_LOT = 4;
const PARKED_KERBSIDE = 22;
/** Lateral acceleration (m/s²) allowed in bends. */
const BEND_ACCEL = 3.2;
/** Braking (m/s²) used to stop at lights. */
const STOP_DECEL = 4;
/** Cruise speed (m/s) by road class (multiplied by the driver's temper). */
const CRUISE: Partial<Record<RoadClass, number>> = {
  motorway: 24,
  motorway_link: 15,
  trunk: 20,
  trunk_link: 13,
  primary: 15,
  primary_link: 11,
  secondary: 13.5,
  secondary_link: 10,
  tertiary: 12,
  tertiary_link: 9,
  unclassified: 10,
  residential: 9,
  living_street: 5,
  service: 6,
};
/** How often each class gets new cars (main roads busier). */
const SPAWN_WEIGHT: Partial<Record<RoadClass, number>> = {
  motorway: 2,
  primary: 3,
  secondary: 3,
  tertiary: 3,
  residential: 1.5,
  unclassified: 1.5,
  service: 0.3,
};

/** Share of traffic ambulances that drive with the light bar and siren on. */
const AMBULANCE_SIREN_SHARE = 0.4;
/** Cruise-speed boost of an emergency vehicle running its siren. */
const SIREN_SPEED = 1.2;

/** A catalogue vehicle (random for `pool` unless `type` is given), with a random body tint when its type takes one. */
function addRandomVeh(scene: THREE.Scene, pool: SpawnPool, x: number, z: number, yaw: number, mode: "ai" | "parked", type: VehicleTypeKey = pickVehicleType(Math.random, pool)): Vehicle {
  return addVeh(scene, type, pickTint(VEHICLE_CATALOG[type], Math.random) ?? LIVERY_COLOR, x, z, yaw, mode);
}

export interface FootPlayerRef {
  mode: "foot" | "car";
  x: number;
  z: number;
}

const _pos = { x: 0, z: 0, yaw: 0 };
const _pose = { y: 0, pitch: 0, roll: 0 };

/** Settles a car's height and body tilt on the ground under its wheels (smoothed unless `snap`). */
export function settleOnGround(v: Vehicle, dt: number, snap = false): void {
  const s = v.spec;
  terrainPose((x, z) => groundY(x, z, v.y + 1), v.x, v.z, v.yaw, s.wb / 2, s.W * 0.42, _pose);
  // Quick follow (wheels stay on the ground over slope changes) with a touch of suspension lag.
  const k = snap ? 1 : Math.min(1, dt * 22);
  const kt = snap ? 1 : Math.min(1, dt * 16);
  v.y += (_pose.y - v.y) * k;
  v.tPitch += (_pose.pitch - v.tPitch) * kt;
  v.tRoll += (_pose.roll - v.tRoll) * kt;
}

function cruiseFor(net: RoadNetwork, edge: number): number {
  return CRUISE[net.roads[net.edges[edge].road].class] ?? 9;
}

export function updateAI(v: Vehicle, dt: number, vehicles: Vehicle[], net: RoadNetwork, t: number, player: FootPlayerRef): boolean {
  const a = v.ai!;
  const d = a.driver;
  const prevYaw = v.yaw;
  let target = cruiseFor(net, d.onLink && d.nextEdge >= 0 ? d.nextEdge : d.edge) * a.temper * v.spec.aiSpeed * (v.siren ? SIREN_SPEED : 1);

  // Bends: limit speed so the lateral acceleration stays reasonable.
  const look = 8 + v.speed * 1.4;
  const turn = turnAhead(d, net, look);
  if (turn > 0.08) target = Math.min(target, Math.max(4, Math.sqrt((BEND_ACCEL * look) / turn)));

  // Traffic lights.
  const dStopRaw = distanceToStop(d, net);
  let red = false;
  if (dStopRaw < 60) {
    const j = net.stopJunction(d.edge);
    const st = signalState(net.junctionOffset(j), net.approachGroup(d.edge), t);
    // Distance the car's centre can still cover: its nose stops just behind the stop line.
    const dStop = dStopRaw - (v.spec.L / 2 + 0.3);
    if (dStop > -1 && (st === "R" || (st === "Y" && dStop > (v.speed * v.speed) / 10))) {
      target = Math.min(target, Math.sqrt(Math.max(0, dStop) * 2 * STOP_DECEL));
      red = true;
    }
  }

  // Gap to whatever is ahead (other cars, the on-foot player).
  const fx = Math.sin(v.yaw);
  const fz = Math.cos(v.yaw);
  let gapMin = 1e9;
  const ahead = 7 + v.speed * 1.4;
  for (const u of vehicles) {
    if (u === v) continue;
    if (a.ghost > 0 && u.mode === "ai") continue;
    const rx = u.x - v.x;
    const rz = u.z - v.z;
    if (Math.abs(rx) > ahead + 6 || Math.abs(rz) > ahead + 6) continue;
    const al = rx * fx + rz * fz;
    if (al < 0.5 || al > ahead + 4) continue;
    const lat = Math.abs(rx * -fz + rz * fx);
    if (lat < (u.spec.W + v.spec.W) / 2 + 0.35) {
      const gap = al - (u.spec.L + v.spec.L) / 2;
      if (gap < gapMin) gapMin = gap;
    }
  }
  if (player.mode === "foot") {
    const rx = player.x - v.x;
    const rz = player.z - v.z;
    const al = rx * fx + rz * fz;
    if (al > 0.5 && al < ahead + 4 && Math.abs(rx * -fz + rz * fx) < 1.6) {
      const gap = al - v.spec.L / 2 - 0.5;
      if (gap < gapMin) gapMin = gap;
    }
  }
  if (gapMin < 1e8) target = Math.min(target, Math.sqrt(Math.max(0, gapMin - 2.0) * 10));
  if (v.speed < 0.3 && gapMin < 1e8 && !red) a.stuck += dt;
  else a.stuck = 0;
  if (a.stuck > 8) {
    a.ghost = 4;
    a.stuck = 0;
  }
  if (a.ghost > 0) a.ghost -= dt;

  if (target > v.speed) v.speed = Math.min(target, v.speed + a.acc * dt);
  else v.speed = Math.max(target, v.speed - 9 * dt);
  v.braking = target < v.speed - 0.5 || (red && v.speed < 0.5);

  if (!advanceDriver(d, net, v.speed * dt, Math.random)) return false;
  driverPosition(d, _pos);
  v.x = _pos.x;
  v.z = _pos.z;
  v.yaw = angLerp(v.yaw, _pos.yaw, Math.min(1, dt * 10));
  const dy = angDiff(prevYaw, v.yaw) / dt;
  v.steerVis = clamp(Math.atan((dy * v.spec.wb) / Math.max(2, v.speed)), -0.5, 0.5);
  v.vx = Math.sin(v.yaw) * v.speed;
  v.vz = Math.cos(v.yaw) * v.speed;
  settleOnGround(v, dt);
  return true;
}

// ---------------------------------------------------------------------------
// Spawning

/** Edges new cars may appear on, weighted by road class. */
function spawnEdges(net: RoadNetwork): { edges: number[]; cum: number[] } {
  const edges: number[] = [];
  const cum: number[] = [];
  let total = 0;
  net.edges.forEach((e, i) => {
    const w = SPAWN_WEIGHT[net.roads[e.road].class] ?? 0.5;
    const len = net.lanePath(i, 0).length;
    if (len < 15 || net.roads[e.road].bridge) return;
    total += w * len;
    edges.push(i);
    cum.push(total);
  });
  return { edges, cum };
}

const spawnCache = new WeakMap<RoadNetwork, { edges: number[]; cum: number[] }>();

function randomEdge(net: RoadNetwork): number {
  let c = spawnCache.get(net);
  if (!c) spawnCache.set(net, (c = spawnEdges(net)));
  const r = Math.random() * (c.cum[c.cum.length - 1] ?? 0);
  let lo = 0;
  let hi = c.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (c.cum[mid] < r) lo = mid + 1;
    else hi = mid;
  }
  return c.edges[lo] ?? 0;
}

/** Spawns one AI car somewhere SPAWN_MIN..SPAWN_MAX m from (fx, fz); null if no free spot was found. */
export function spawnAICar(scene: THREE.Scene, vehicles: Vehicle[], net: RoadNetwork, fx: number, fz: number, minDist = SPAWN_MIN, forced?: VehicleTypeKey): Vehicle | null {
  for (let tries = 0; tries < (forced ? 400 : 40); tries++) {
    const e = randomEdge(net);
    if (forced && VEHICLE_CATALOG[forced].mainRoadsOnly && !isMainRoad(net.roads[net.edges[e].road].class)) continue;
    const lane = Math.floor(Math.random() * net.lanesOf(e));
    const path = net.lanePath(e, lane);
    const s = Math.random() * path.length;
    const driver = createDriver(net, e, lane, s, Math.random);
    driverPosition(driver, _pos);
    const dist = Math.hypot(_pos.x - fx, _pos.z - fz);
    if (dist < minDist || dist > SPAWN_MAX) continue;
    if (vehicles.some((v) => Math.abs(v.x - _pos.x) < 14 && Math.abs(v.z - _pos.z) < 14)) continue;
    const type = forced ?? pickTrafficType(Math.random, net.roads[net.edges[e].road].class);
    const v = addRandomVeh(scene, "traffic", _pos.x, _pos.z, _pos.yaw, "ai", type);
    const temper = 0.85 + Math.random() * 0.3;
    // Heavy vehicles pull away gently.
    const acc = Math.min(3.5 + Math.random() * 2, v.spec.acc * 0.8);
    v.ai = { driver, temper, acc, stuck: 0, ghost: 0 };
    if (type === "ambulance" && Math.random() < AMBULANCE_SIREN_SHARE) v.siren = true;
    v.speed = cruiseFor(net, e) * temper * v.spec.aiSpeed * 0.7;
    v.y = groundY(v.x, v.z);
    settleOnGround(v, 0, true);
    vehicles.push(v);
    return v;
  }
  return null;
}

/**
 * Keeps TRAFFIC_COUNT AI cars around (fx, fz): recycles cars that ended up
 * too far away (or ran off a dead end, flagged in `dead`) and tops up.
 * Returns the vehicles removed (so callers can unregister their hitboxes).
 */
export function maintainTraffic(scene: THREE.Scene, vehicles: Vehicle[], net: RoadNetwork, fx: number, fz: number, dead: Set<Vehicle>): Vehicle[] {
  const removed: Vehicle[] = [];
  for (let i = vehicles.length - 1; i >= 0; i--) {
    const v = vehicles[i];
    if (v.mode !== "ai") continue;
    if (dead.has(v) || Math.hypot(v.x - fx, v.z - fz) > DESPAWN) {
      removeVeh(scene, v);
      vehicles.splice(i, 1);
      removed.push(v);
    }
  }
  dead.clear();
  let ai = vehicles.filter((v) => v.mode === "ai").length;
  // A few per call so spawning never hitches a frame.
  for (let k = 0; k < 3 && ai < TRAFFIC_COUNT; k++) if (spawnAICar(scene, vehicles, net, fx, fz)) ai++;
  return removed;
}

// ---------------------------------------------------------------------------
// Parked cars

interface Slot {
  x: number;
  z: number;
  yaw: number;
}

/** Parking bays on a grid inside each mapped car park (rows 5.5 m apart, bays 2.7 m wide). */
function lotSlots(map: CampusMap, perLot: number): Slot[] {
  const out: Slot[] = [];
  for (const l of map.landuse) {
    if (l.kind !== "parking") continue;
    const bb = bboxOf(l.points);
    // Align rows with the lot's longest edge.
    let best = 0;
    let yaw = 0;
    for (let i = 0; i < l.points.length; i++) {
      const [ax, az] = l.points[i];
      const [bx, bz] = l.points[(i + 1) % l.points.length];
      const len = Math.hypot(bx - ax, bz - az);
      if (len > best) {
        best = len;
        yaw = Math.atan2(bx - ax, bz - az);
      }
    }
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const cx = (bb.minX + bb.maxX) / 2;
    const cz = (bb.minZ + bb.maxZ) / 2;
    const r = Math.hypot(bb.maxX - bb.minX, bb.maxZ - bb.minZ) / 2;
    const slots: Slot[] = [];
    for (let row = -r; row <= r; row += 5.5) {
      for (let col = -r; col <= r; col += 2.7) {
        // Along the edge direction = col, across = row; cars park nose-in (perpendicular).
        const x = cx + fx * col - fz * row;
        const z = cz + fz * col + fx * row;
        if (!pointInPolygon(x, z, l.points)) continue;
        slots.push({ x, z, yaw: yaw + Math.PI / 2 + (Math.floor(row / 5.5) % 2 ? Math.PI : 0) });
      }
    }
    slots.sort(() => Math.random() - 0.5);
    out.push(...slots.slice(0, perLot));
  }
  return out;
}

/** Kerbside spots along residential streets (right-hand side, parallel). */
function streetSlots(map: CampusMap, max: number): Slot[] {
  const out: Slot[] = [];
  map.roads.forEach((r) => {
    if (r.class !== "residential" || r.bridge || r.tunnel) return;
    const side = r.width / 2 - 1.1;
    for (const sign of r.oneway ? [1] : [1, -1]) {
      const line: Vec2[] = offsetPolyline(sign === 1 ? r.points : [...r.points].reverse(), side);
      const cum = cumulativeLengths(line);
      for (let s = 8; s < cum[cum.length - 1] - 8; s += 7) {
        if (Math.random() > 0.3) continue;
        let i = 1;
        while (i < cum.length - 1 && cum[i] < s) i++;
        const f = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
        const x = line[i - 1][0] + (line[i][0] - line[i - 1][0]) * f;
        const z = line[i - 1][1] + (line[i][1] - line[i - 1][1]) * f;
        out.push({ x, z, yaw: Math.atan2(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]) });
      }
    }
  });
  out.sort(() => Math.random() - 0.5);
  return out.slice(0, max);
}

/** Parked cars: car parks + kerbsides, plus `first` (the car waiting next to the player). */
export function spawnParked(scene: THREE.Scene, vehicles: Vehicle[], map: CampusMap, first: Slot | null): void {
  const placed: Slot[] = [];
  const free = (s: Slot) => placed.every((p) => Math.hypot(p.x - s.x, p.z - s.z) > 3);
  if (first) {
    const v = addVeh(scene, "sedan", 0x2f6fd6, first.x, first.z, first.yaw, "parked");
    vehicles.push(v);
    placed.push(first);
  }
  for (const s of [...lotSlots(map, PARKED_PER_LOT), ...streetSlots(map, PARKED_KERBSIDE)]) {
    if (!free(s)) continue;
    placed.push(s);
    vehicles.push(addRandomVeh(scene, "parked", s.x, s.z, s.yaw + (Math.random() - 0.5) * 0.05, "parked"));
  }
  for (const v of vehicles) {
    if (v.mode !== "parked") continue;
    v.y = groundY(v.x, v.z);
    settleOnGround(v, 0, true);
  }
}
