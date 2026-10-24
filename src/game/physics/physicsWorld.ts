// Local, visual-only rigid-body world (Rapier) for ragdoll corpses. Nothing
// here is networked or affects gameplay: every client simulates its own
// bodies. Holds the static city (ground, raised blocks, the CollisionGrid's
// boxes/cylinders), kinematic proxies of the cars (synced every step so
// driving into a corpse shoves it) and the corpse collision-group slots.
// Rapier (WASM, inlined in the compat build) is loaded lazily via loadRapier().

import type RAPIER_NS from "@dimforge/rapier3d-compat";
import { G, BLOCK, bc, STEP } from "../core/constants";
import type { CollisionGrid } from "../world/colliders";

export type Rapier = typeof RAPIER_NS;
type World = InstanceType<Rapier["World"]>;
type RigidBody = InstanceType<Rapier["RigidBody"]>;
type Collider = InstanceType<Rapier["Collider"]>;

/**
 * Loads and initializes Rapier once. Resolves to null when the WASM can't be
 * initialized — callers then keep the animation-only death behaviour.
 */
let pending: Promise<Rapier | null> | null = null;
export function loadRapier(): Promise<Rapier | null> {
  if (!pending) {
    pending = import("@dimforge/rapier3d-compat")
      .then(async (mod) => {
        const R = ((mod as { default?: Rapier }).default ?? mod) as Rapier;
        await R.init();
        return R;
      })
      .catch((err: unknown) => {
        console.warn("[physics] Rapier failed to initialize, ragdolls disabled", err);
        return null;
      });
  }
  return pending;
}

// ---- Collision groups (Rapier InteractionGroups: memberships << 16 | filter) ----
const BIT_STATIC = 1 << 0;
const BIT_CARS = 1 << 1;
/** Corpse slots use bits 2..15: a corpse never collides with itself (its parts
 * overlap at the joints), but does collide with corpses in other slots. */
const FIRST_CORPSE_BIT = 2;
export const CORPSE_SLOTS = 14;
const ALL_CORPSE_BITS = ((1 << CORPSE_SLOTS) - 1) << FIRST_CORPSE_BIT;
const groups = (member: number, filter: number) => ((member & 0xffff) << 16) | (filter & 0xffff);
const STATIC_GROUPS = groups(BIT_STATIC, 0xffff);
const CAR_GROUPS = groups(BIT_CARS, ALL_CORPSE_BITS);
/** Query filter that only sees ragdoll parts (bullets hitting corpses). */
export const CORPSE_QUERY_GROUPS = groups(0xffff, ALL_CORPSE_BITS);

export function corpseGroups(slot: number): number {
  const bit = 1 << (FIRST_CORPSE_BIT + (slot % CORPSE_SLOTS));
  return groups(bit, BIT_STATIC | BIT_CARS | (ALL_CORPSE_BITS & ~bit));
}

/** Minimal vehicle shape the kinematic car proxies need (local + remote cars). */
export interface PhysicsVehicle {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Catalogue dimensions: length, width, height and the body's centre along z. */
  spec: { L: number; W: number; H: number; zc: number };
}

interface CarProxy {
  body: RigidBody;
  lastStep: number;
}

export interface CorpseRayHit {
  collider: Collider;
  distance: number;
}

/** Tallest a CircleCollider (trees/poles, h = 99 in the grid) is mirrored. */
const CIRCLE_MAX_HEIGHT = 4;

export class PhysicsWorld {
  readonly world: World;
  private cars = new Map<PhysicsVehicle, CarProxy>();
  private stepIndex = 0;
  private nextSlot = 0;

  constructor(readonly R: Rapier) {
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = STEP;
    // Ragdoll chains converge much better with a few more solver iterations.
    this.world.numSolverIterations = 8;
  }

  /** Ground (top at y=0) plus the 0.25 m raised city blocks/sidewalks (see world/colliders.ts groundY). */
  addGround(): void {
    this.addStaticBox(0, -0.5, 0, 3000, 0.5, 3000);
    for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) this.addStaticBox(bc(i), 0.125, bc(j), BLOCK / 2, 0.125, BLOCK / 2);
  }

  /** Mirrors every CollisionGrid collider (buildings, kiosks, fountains, trees, poles, benches). */
  addGridColliders(grid: CollisionGrid): void {
    for (const c of grid.all()) {
      if (c.t === 0) this.addStaticBox(c.x, c.h / 2, c.z, c.hx, c.h / 2, c.hz);
      else {
        const h = Math.min(c.h, CIRCLE_MAX_HEIGHT);
        const desc = this.R.ColliderDesc.cylinder(h / 2, c.r).setTranslation(c.x, h / 2, c.z).setCollisionGroups(STATIC_GROUPS).setFriction(0.8);
        this.world.createCollider(desc);
      }
    }
  }

  addStaticBox(x: number, y: number, z: number, hx: number, hy: number, hz: number): void {
    const desc = this.R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setCollisionGroups(STATIC_GROUPS).setFriction(0.9);
    this.world.createCollider(desc);
  }

  /** Collision-group slot for the next corpse (cycles through CORPSE_SLOTS). */
  allocCorpseSlot(): number {
    const s = this.nextSlot;
    this.nextSlot = (this.nextSlot + 1) % CORPSE_SLOTS;
    return s;
  }

  /**
   * Moves the kinematic car proxies to the cars' current transforms. Cars
   * synced on the previous step move smoothly (Rapier derives their velocity,
   * so they push corpses); new or stale ones teleport. Proxies of cars that
   * are no longer listed are removed.
   */
  syncVehicles(lists: readonly (readonly PhysicsVehicle[])[]): void {
    const R = this.R;
    for (const list of lists) {
      for (const v of list) {
        let proxy = this.cars.get(v);
        const fresh = !proxy;
        if (!proxy) {
          const s = v.spec;
          const bottom = 0.18;
          // Up to the roof (minus a little: the glasshouse is narrower than the body).
          const top = s.H * 0.95;
          const body = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(v.x, v.y, v.z));
          const col = R.ColliderDesc.cuboid(s.W / 2, (top - bottom) / 2, s.L / 2)
            .setTranslation(0, (top + bottom) / 2, s.zc)
            .setCollisionGroups(CAR_GROUPS)
            .setFriction(0.6);
          this.world.createCollider(col, body);
          proxy = { body, lastStep: -10 };
          this.cars.set(v, proxy);
        }
        const half = v.yaw / 2;
        const rot = { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
        if (!fresh && proxy.lastStep === this.stepIndex - 1) {
          proxy.body.setNextKinematicTranslation({ x: v.x, y: v.y, z: v.z });
          proxy.body.setNextKinematicRotation(rot);
        } else {
          proxy.body.setTranslation({ x: v.x, y: v.y, z: v.z }, false);
          proxy.body.setRotation(rot, false);
        }
        proxy.lastStep = this.stepIndex;
      }
    }
    for (const [v, proxy] of this.cars) {
      if (proxy.lastStep === this.stepIndex) continue;
      this.world.removeRigidBody(proxy.body);
      this.cars.delete(v);
    }
  }

  /** Advances the simulation by one fixed STEP. */
  step(): void {
    this.world.step();
    this.stepIndex++;
  }

  /** Closest ragdoll part hit by a ray (dir normalized), within maxDist. */
  castCorpseRay(origin: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, maxDist: number): CorpseRayHit | null {
    const ray = new this.R.Ray(origin, dir);
    const hit = this.world.castRay(ray, maxDist, true, undefined, CORPSE_QUERY_GROUPS);
    return hit ? { collider: hit.collider, distance: hit.timeOfImpact } : null;
  }

  removeBody(body: RigidBody): void {
    this.world.removeRigidBody(body);
  }

  dispose(): void {
    this.cars.clear();
    this.world.free();
  }
}
