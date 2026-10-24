// Data-driven vehicle catalogue: one entry per drivable type (model, real
// dimensions, handling, engine profile, collision circles, camera/door
// offsets, paint and spawn weights). Dimensions are derived from measured
// model bounds x scale, so a new vehicle is one entry + its GLB:
//
//   1. drop `public/models/vehicles/<name>.glb` (body + BackWheels +
//      FrontLeftWheel + FrontRightWheel nodes, +z forward),
//   2. add its key to VehicleTypeKey (types.ts) and an entry below with the
//      measured geometry (node translation + scale x accessor bounds),
//   3. give it an engine profile key (audio/engine.ts already has bus /
//      ambulance) and spawn weights.
//
// Pure module (no three.js) so it is unit-tested and shared by every layer.

import type { ModelGeometry, PaintSlot, SpawnPool, VehicleModel, VehicleSpec, VehicleTypeKey } from "./types";

/** Body colours for tintable cars (display sRGB values, as the renderer uses colours unconverted). */
export const PAINT_COLORS: readonly number[] = [0xc0392b, 0x2980b9, 0x27ae60, 0xecf0f1, 0x2c3e50, 0x7f8c8d, 0xe67e22, 0x8e44ad, 0x1a1a1a, 0xd0d0d0, 0x16a085, 0xb03060];

/** Old handling constants (vehicles/playerCar.ts before the catalogue) — the baseline feel. */
const BASE_HANDLING = {
  brake: 26,
  reverseMax: 9,
  reverseAcc: 7,
  steerLock: 0.62,
  steerLockFast: 0.16,
  steerRate: 3.2,
  steerReturn: 5,
};

const DEFAULT_CAMERA = { height: 1.4, distance: 8.2 };
const DEFAULT_DOOR = { side: 1 as const, z: 0.2 };

/** What an entry states by hand; the rest (dimensions, colliders) is derived in buildSpec. */
interface CatalogEntry {
  name: string;
  model: VehicleModel;
  mass: number;
  max: number;
  acc: number;
  engine: string;
  tint: readonly number[] | null;
  spawn: Record<SpawnPool, number>;
  handling?: Partial<typeof BASE_HANDLING>;
  camera?: { height: number; distance: number };
  siren?: boolean;
}

function geometry(body: ModelGeometry["body"], frontAxleZ: number, rearAxleZ: number, wheelRadius: number, wheelBottom: number): ModelGeometry {
  return { body, frontAxleZ, rearAxleZ, wheelRadius, wheelBottom };
}

const paint = (...slots: PaintSlot[]): readonly PaintSlot[] => slots;

// Geometry measured from the Quaternius "Realistic Car Pack" GLBs (CC0).
const ENTRIES: Record<VehicleTypeKey, CatalogEntry> = {
  sedan: {
    name: "Sedán",
    model: {
      file: "/models/vehicles/normal_car_1.glb",
      scale: 1.06,
      geometry: geometry({ min: [-0.904, 0.171, -2.107], max: [0.904, 1.183, 2.113] }, 1.196, -1.243, 0.262, 0.006),
      paint: paint({ material: "Blue" }),
    },
    mass: 1350,
    max: 40,
    acc: 11,
    engine: "sedan",
    tint: PAINT_COLORS,
    spawn: { traffic: 26, parked: 28 },
  },
  hatch: {
    name: "Utilitario",
    model: {
      file: "/models/vehicles/normal_car_2.glb",
      scale: 1.14,
      geometry: geometry({ min: [-0.819, 0.143, -1.649], max: [0.819, 1.117, 1.66] }, 1.04, -0.955, 0.248, -0.028),
      paint: paint({ material: "LightBlue" }),
    },
    mass: 1100,
    max: 35,
    acc: 10,
    engine: "hatch",
    tint: PAINT_COLORS,
    spawn: { traffic: 22, parked: 26 },
    handling: { steerRate: 3.4 },
  },
  suv: {
    name: "SUV",
    model: {
      file: "/models/vehicles/suv.glb",
      scale: 1.04,
      geometry: geometry({ min: [-1.056, 0.236, -2.105], max: [1.056, 1.51, 2.104] }, 1.317, -1.251, 0.327, -0.018),
      paint: paint({ material: "White" }),
    },
    mass: 2100,
    max: 37,
    acc: 10,
    engine: "suv",
    tint: PAINT_COLORS,
    spawn: { traffic: 16, parked: 20 },
    handling: { brake: 23, steerLock: 0.58, steerRate: 2.9 },
    camera: { height: 1.6, distance: 8.8 },
  },
  sport: {
    name: "Deportivo",
    model: {
      file: "/models/vehicles/sports_car.glb",
      scale: 1.08,
      geometry: geometry({ min: [-0.903, 0.171, -1.985], max: [0.901, 1.145, 1.984] }, 1.188, -1.255, 0.26, -0.01),
      paint: paint({ material: "Orange" }, { material: "DarkOrange", shade: 0.9 }),
    },
    mass: 1400,
    max: 54,
    acc: 17,
    engine: "sport",
    tint: PAINT_COLORS,
    spawn: { traffic: 6, parked: 7 },
    handling: { brake: 30, steerRate: 3.6 },
  },
  coupe: {
    name: "Coupé",
    model: {
      file: "/models/vehicles/sports_car_2.glb",
      scale: 1.07,
      geometry: geometry({ min: [-0.936, 0.152, -2.029], max: [0.936, 1.187, 1.898] }, 1.186, -1.321, 0.28, -0.016),
      paint: paint({ material: "White" }),
    },
    mass: 1450,
    max: 50,
    acc: 15.5,
    engine: "sport",
    tint: PAINT_COLORS,
    spawn: { traffic: 6, parked: 7 },
    handling: { brake: 29, steerRate: 3.5 },
  },
  taxi: {
    name: "Taxi",
    model: {
      file: "/models/vehicles/taxi.glb",
      scale: 1.06,
      geometry: geometry({ min: [-0.904, 0.154, -2.007], max: [0.903, 1.3, 2.214] }, 1.296, -1.143, 0.262, -0.011),
      paint: paint(),
    },
    mass: 1400,
    max: 40,
    acc: 11,
    engine: "taxi",
    tint: null,
    spawn: { traffic: 14, parked: 8 },
  },
  police: {
    name: "Policía",
    model: {
      file: "/models/vehicles/cop.glb",
      scale: 1.16,
      geometry: geometry({ min: [-0.889, 0.09, -1.867], max: [0.889, 1.222, 1.863] }, 1.141, -1.155, 0.275, -0.016),
      paint: paint(),
      lightBar: { minY: 1.1 },
    },
    mass: 1700,
    max: 47,
    acc: 14,
    engine: "police",
    tint: null,
    spawn: { traffic: 4, parked: 2 },
    handling: { brake: 28, steerRate: 3.5 },
    camera: { height: 1.5, distance: 8.5 },
    siren: true,
  },
};

/**
 * Collision circles along a vehicle of length L / width W centred at zc:
 * radius W/2 + 3 cm, end circles 3 cm inside the bumpers, and enough circles
 * in between that neighbours are at most 1.5 radii apart (3 for cars, more
 * for buses so there are no gaps).
 */
export function colliderOffsets(L: number, W: number, zc: number): { rad: number; offs: number[] } {
  const rad = W / 2 + 0.03;
  const o = Math.max(0, L / 2 - rad - 0.03);
  const n = Math.max(3, Math.ceil((2 * o) / (1.5 * rad)) + 1);
  const offs: number[] = [];
  for (let i = 0; i < n; i++) offs.push(zc - o + (2 * o * i) / (n - 1));
  return { rad, offs };
}

function buildSpec(key: VehicleTypeKey, e: CatalogEntry): VehicleSpec {
  const { scale: s, geometry: g } = e.model;
  const L = (g.body.max[2] - g.body.min[2]) * s;
  const W = (g.body.max[0] - g.body.min[0]) * s;
  const zc = ((g.body.max[2] + g.body.min[2]) / 2) * s;
  const { rad, offs } = colliderOffsets(L, W, zc);
  return {
    key,
    name: e.name,
    model: e.model,
    L,
    W,
    H: (g.body.max[1] - g.wheelBottom) * s,
    zc,
    wr: g.wheelRadius * s,
    wb: (g.frontAxleZ - g.rearAxleZ) * s,
    mass: e.mass,
    max: e.max,
    acc: e.acc,
    ...BASE_HANDLING,
    ...e.handling,
    engine: e.engine,
    rad,
    offs,
    door: DEFAULT_DOOR,
    camera: e.camera ?? DEFAULT_CAMERA,
    tint: e.tint,
    spawn: e.spawn,
    siren: e.siren ?? false,
  };
}

export const VEHICLE_TYPE_KEYS = Object.keys(ENTRIES) as VehicleTypeKey[];

export const VEHICLE_CATALOG: Record<VehicleTypeKey, VehicleSpec> = Object.fromEntries(VEHICLE_TYPE_KEYS.map((k) => [k, buildSpec(k, ENTRIES[k])])) as Record<VehicleTypeKey, VehicleSpec>;

/** Type strings from older clients (procedural fleet) or loose names, mapped to today's catalogue. */
const LEGACY_TYPES: Record<string, VehicleTypeKey> = {
  van: "suv",
  cop: "police",
  sports: "sport",
};

/** Any network/legacy type string -> a catalogue key (unknown -> sedan). */
export function resolveVehicleType(type: unknown): VehicleTypeKey {
  if (typeof type !== "string") return "sedan";
  if (Object.hasOwn(ENTRIES, type)) return type as VehicleTypeKey;
  if (Object.hasOwn(LEGACY_TYPES, type)) return LEGACY_TYPES[type];
  return "sedan";
}

export function vehicleSpec(type: string): VehicleSpec {
  return VEHICLE_CATALOG[resolveVehicleType(type)];
}

/** Weighted random type for a spawn pool (`rand` in [0, 1)). */
export function pickVehicleType(rand: () => number, pool: SpawnPool): VehicleTypeKey {
  let total = 0;
  for (const k of VEHICLE_TYPE_KEYS) total += VEHICLE_CATALOG[k].spawn[pool];
  let r = rand() * total;
  for (const k of VEHICLE_TYPE_KEYS) {
    r -= VEHICLE_CATALOG[k].spawn[pool];
    if (r < 0) return k;
  }
  return VEHICLE_TYPE_KEYS[VEHICLE_TYPE_KEYS.length - 1];
}

/** Body colour for a new car of this type, or null to keep its livery. */
export function pickTint(spec: VehicleSpec, rand: () => number): number | null {
  if (!spec.tint || spec.tint.length === 0) return null;
  return spec.tint[Math.min(spec.tint.length - 1, Math.floor(rand() * spec.tint.length))];
}

/**
 * Share of the overlap a car of mass `m` moves when it bumps into one of mass
 * `other` (the other car moves the rest): 0.7 between equal masses (the old
 * fixed split), more for the lighter car.
 */
export function pushShare(m: number, other: number): number {
  return Math.min(0.95, Math.max(0.3, other / (m + other) + 0.2));
}
