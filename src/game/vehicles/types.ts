// Vehicle type definitions shared by the catalogue (catalog.ts), the renderer
// (meshes.ts / vehicleAssets.ts), the physics proxies and the network layer.
// Pure types only — the data lives in catalog.ts.

/** Who drives a vehicle: the local player, traffic AI, or nobody. */
export type VehicleMode = "player" | "ai" | "parked";

/** Catalogue keys. They travel over the network as `CarState.type` (see resolveVehicleType for old strings). */
export type VehicleTypeKey = "sedan" | "hatch" | "suv" | "sport" | "coupe" | "taxi" | "police" | "bus" | "school_bus" | "ambulance";

export type Vec3Tuple = readonly [number, number, number];

/**
 * Measurements of a GLB in its own model space (metres before `scale`),
 * taken from the node transforms + accessor bounds (see the Phase 2 report):
 * +z is forward, +x is the car's left, y is up.
 */
export interface ModelGeometry {
  /** Bounds of the body node. */
  body: { min: Vec3Tuple; max: Vec3Tuple };
  /** Wheel centres on the z axis (front and rear axle) and their radius. */
  frontAxleZ: number;
  rearAxleZ: number;
  wheelRadius: number;
  /** Lowest point of the wheels (the model is lifted so this touches the ground). */
  wheelBottom: number;
}

/** A body material re-coloured per instance (normal cars); `shade` darkens secondary paint (two-tone bodies). */
export interface PaintSlot {
  material: string;
  shade?: number;
}

export interface VehicleModel {
  /** Public URL of the meshopt-compressed GLB. */
  file: string;
  /** Uniform scale from model units to game metres. */
  scale: number;
  geometry: ModelGeometry;
  /** Material names that take the body tint (empty for liveries). */
  paint: readonly PaintSlot[];
  /**
   * Roof light bar: triangles of the light materials above this model-space
   * height belong to the bar (flashing), the rest are ordinary tail lights.
   */
  lightBar?: { minY: number };
  /**
   * Re-orientation applied to the GLB scene before anything is measured or
   * split: a yaw (rad) then a translation (model units), so that +z is
   * forward and the body is centred on the origin (the geometry above is in
   * this frame).
   */
  orient?: { rotateY: number; offset: Vec3Tuple };
  /** Extra scale along the length applied to the body and the axle positions, not the wheels (stubby low-poly buses). */
  stretch?: number;
  /**
   * Material names of the body primitives in order, with their display
   * colours, for GLBs whose materials were lost in the OBJ conversion (the
   * Public Transport Pack); "wheel" colours the wheel meshes.
   */
  primitives?: { body: readonly string[]; colors: Readonly<Record<string, number>>; wheel: number };
  /** One material used for both head and tail lamps: triangles in front of the centre are headlights. */
  lampMaterial?: string;
  /** Generated roof light bar (model space): roof height, position along z and half width of each lamp. */
  roofBar?: { y: number; z: number; half: number };
}

/** Pool a spawn draws from: moving traffic or parking slots. */
export type SpawnPool = "traffic" | "parked";

/** Everything gameplay, rendering, audio and physics need to know about one vehicle type. */
export interface VehicleSpec {
  key: VehicleTypeKey;
  /** Player-facing name (HUD). */
  name: string;
  model: VehicleModel;
  /** Real dimensions (m): length, width, height above the ground, and the body's centre along z. */
  L: number;
  W: number;
  H: number;
  zc: number;
  /** Wheel radius and wheelbase (m). */
  wr: number;
  wb: number;
  /** Mass (kg): weights car-vs-car separation. */
  mass: number;
  /** Top speed (m/s), throttle acceleration and service-brake deceleration (m/s²). */
  max: number;
  acc: number;
  brake: number;
  /** Reverse: top speed (m/s) and acceleration (m/s²). */
  reverseMax: number;
  reverseAcc: number;
  /** Steering lock (rad) at standstill and at top speed, steer-in and self-centring rates (rad/s). */
  steerLock: number;
  steerLockFast: number;
  steerRate: number;
  steerReturn: number;
  /** Engine profile key (audio/engine.ts ENGINE_PROFILES). */
  engine: string;
  /** Collision circles: radius and their centres along the car's z axis (CollisionGrid + car-vs-car). */
  rad: number;
  offs: readonly number[];
  /** Exit door: side (+1 = left, the driver's side in Spain) and position along z. */
  door: { side: 1 | -1; z: number };
  /** Chase camera: look-at height above the car and base distance. */
  camera: { height: number; distance: number };
  /** Body colours to pick from, or null to keep the model's livery. */
  tint: readonly number[] | null;
  /** Relative spawn weights. */
  spawn: Record<SpawnPool, number>;
  /** Has a light bar + siren (toggled with a long press of H). */
  siren: boolean;
  /** Traffic only spawns it on main roads (primary / secondary / tertiary). */
  mainRoadsOnly: boolean;
  /** Traffic cruise-speed factor (buses drive slower). */
  aiSpeed: number;
}
