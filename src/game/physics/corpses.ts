// Persistent corpses (Dark-Souls style): when a ped or player dies, its rig
// is DETACHED from the living entity and handed over here, so the entity can
// respawn with a fresh rig while the old body stays on the ground. With
// Rapier available and a skinned rig, the body becomes a physical ragdoll
// (physics/ragdoll.ts) — no death animation; otherwise (procedural fallback
// rig, or Rapier failed to load) it plays its death animation once and stays.
// A fresh ragdoll "dies" with muscles (physics/muscles.ts): partial strength
// holding the death pose, fading to limp over ~1-1.8 s with protective
// reflexes, the struck limb limp at once (car rams: an almost instant drop).
// At most CORPSE_CAP corpses persist: beyond that the oldest fades out over
// CORPSE_FADE_S and is freed (bodies, colliders, cloned materials, skeleton).

import * as THREE from "three";
import type { CharacterRig, RigUpdate } from "../characters/characterRig";
import type { WeaponId } from "@shared/protocol";
import { CorpseRoster } from "./corpseRoster";
import { Ragdoll } from "./ragdoll";
import { shotImpulse, type Vec3 } from "./deathImpulse";
import type { DeathCause } from "./muscles";
import type { PhysicsVehicle, PhysicsWorld } from "./physicsWorld";

export const CORPSE_CAP = 20;
export const CORPSE_FADE_S = 1.5;
/** Animated (non-physics) corpses stop updating once their death clip is over. */
const ANIMATED_DEATH_S = 3;
/** A ragdoll slower than this (m/s) for SETTLE_S seconds is put to sleep —
 * piles of touching bodies can jitter just above Rapier's own thresholds. */
const SETTLE_SPEED = 0.12;
const SETTLE_S = 1.2;

export interface CorpseSpawn {
  rig: CharacterRig;
  /** The character's velocity at the moment of death (m/s). */
  velocity: Vec3;
  /** Killing blow applied at a world point (shot direction, punch...). */
  impulse?: { impulse: Vec3; point: Vec3 } | null;
  /** How the character died (muscle fade style); default "shot" with an impulse, else "generic". */
  cause?: DeathCause;
  /** Seed of the death's randomness (default: random). */
  seed?: number;
  /** Debug: hold the pose at this strength instead of dying (optionally with the pelvis pinned). */
  hold?: { strength: number; pinned?: boolean };
}

export interface CorpseHandle {
  /** Writes the body's pelvis (or the rig's position) into `out`; false once the corpse is gone. */
  focus(out: THREE.Vector3): boolean;
  /** The physical ragdoll (null for animated corpses). */
  readonly ragdoll: Ragdoll | null;
}

interface Corpse {
  rig: CharacterRig;
  ragdoll: Ragdoll | null;
  age: number;
  /** Seconds the ragdoll has been nearly still (forced sleep after SETTLE_S). */
  calm: number;
  /** Per-corpse material clones made when the fade starts (shared ones can't fade alone). */
  fadeMats: THREE.Material[] | null;
}

const DEAD: RigUpdate = { speed: 0, ground: true, weapon: "fists", aiming: false, alive: false };

export interface CorpseShotHit {
  point: THREE.Vector3;
  distance: number;
}

export class CorpseManager {
  private corpses: Corpse[] = [];
  private readonly roster = new CorpseRoster<Corpse>({ cap: CORPSE_CAP, fadeSeconds: CORPSE_FADE_S });
  private physics: PhysicsWorld | null = null;

  constructor(private readonly scene: THREE.Scene) {}

  /** Enables ragdolls once Rapier is ready (corpses spawned before stay animated). */
  setPhysics(pw: PhysicsWorld | null): void {
    this.physics = pw;
  }

  get hasPhysics(): boolean {
    return this.physics !== null;
  }

  get count(): number {
    return this.corpses.length;
  }

  /**
   * Takes ownership of `s.rig` (already detached from its entity) and turns it
   * into a corpse. Returns a handle whose `focus` tracks the body's pelvis.
   */
  spawn(s: CorpseSpawn): CorpseHandle {
    const rig = s.rig;
    rig.dropWeapon();
    if (!rig.group.parent) this.scene.add(rig.group);
    rig.group.visible = true;
    rig.group.updateMatrixWorld(true);
    let ragdoll: Ragdoll | null = null;
    if (this.physics && rig.ragdollRoot) {
      ragdoll = Ragdoll.create(this.physics, rig.ragdollRoot, { velocity: s.velocity, slot: this.physics.allocCorpseSlot() });
      if (ragdoll) {
        const struck = s.impulse ? ragdoll.applyImpulseAt(s.impulse.impulse, s.impulse.point) : null;
        if (s.hold) {
          ragdoll.hold(s.hold.strength);
          if (s.hold.pinned) ragdoll.setPinned(true);
        } else {
          const cause = s.cause ?? (s.impulse ? "shot" : "generic");
          ragdoll.startDeath({ cause, struck: cause === "shot" ? struck : null, seed: s.seed ?? Math.floor(Math.random() * 0x7fffffff) });
        }
      }
    }
    const corpse: Corpse = { rig, ragdoll, age: 0, calm: 0, fadeMats: null };
    this.corpses.push(corpse);
    for (const gone of this.roster.add(corpse)) this.remove(gone);
    return {
      ragdoll,
      focus: (out) => {
        if (!this.corpses.includes(corpse)) return false;
        const pelvis = corpse.ragdoll?.bodies[0];
        if (pelvis) {
          const t = pelvis.translation();
          out.set(t.x, t.y, t.z);
        } else out.copy(rig.group.position);
        return true;
      },
    };
  }

  /** One fixed physics step (only while ragdolls exist); cars push corpses, dying muscles act first. */
  step(vehicles: readonly (readonly PhysicsVehicle[])[]): void {
    const pw = this.physics;
    if (!pw || !this.corpses.some((c) => c.ragdoll)) return;
    pw.syncVehicles(vehicles);
    for (const c of this.corpses) c.ragdoll?.stepMuscles(pw.world.timestep);
    pw.step();
  }

  /** Every live ragdoll, oldest first (debug overlay). */
  ragdolls(): Ragdoll[] {
    const out: Ragdoll[] = [];
    for (const c of this.corpses) if (c.ragdoll) out.push(c.ragdoll);
    return out;
  }

  /** Per-frame: copies ragdoll poses to bones, ages animated corpses, runs fades. */
  update(dt: number): void {
    for (const c of this.corpses) {
      c.age += dt;
      if (c.ragdoll) {
        c.ragdoll.sync();
        // Not while the muscles still fade (they keep the body awake on purpose).
        if (!c.ragdoll.isSleeping() && !c.ragdoll.dying) {
          c.calm = c.ragdoll.maxSpeed() < SETTLE_SPEED ? c.calm + dt : 0;
          if (c.calm > SETTLE_S) c.ragdoll.sleep();
        }
      } else if (c.age < ANIMATED_DEATH_S) c.rig.update(dt, DEAD);
    }
    for (const done of this.roster.update(dt)) this.remove(done);
    for (const c of this.roster.fading()) this.applyFade(c, this.roster.fadeAlpha(c));
  }

  /**
   * Bullet vs corpses: the closest ragdoll part along the ray (within
   * maxDist) gets the shot's impulse. Returns the hit point, or null.
   */
  shoot(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, weapon: WeaponId): CorpseShotHit | null {
    const pw = this.physics;
    if (!pw || maxDist <= 0) return null;
    const hit = pw.castCorpseRay(origin, dir, maxDist);
    if (!hit) return null;
    const point = origin.clone().addScaledVector(dir, hit.distance);
    const owner = this.corpses.find((c) => c.ragdoll?.ownsCollider(hit.collider.handle));
    // A corpse shove is lighter than a killing blow (it's already limp).
    const imp = shotImpulse(dir, weapon);
    const k = 0.45;
    owner?.ragdoll?.applyImpulseToCollider(hit.collider.handle, { x: imp.x * k, y: imp.y * k, z: imp.z * k }, point);
    return { point, distance: hit.distance };
  }

  private applyFade(c: Corpse, alpha: number): void {
    if (!c.fadeMats) {
      c.fadeMats = [];
      const clones = new Map<THREE.Material, THREE.Material>();
      c.rig.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.visible) return;
        const swap = (m: THREE.Material) => {
          let cl = clones.get(m);
          if (!cl) {
            cl = m.clone();
            cl.transparent = true;
            cl.depthWrite = false;
            clones.set(m, cl);
            c.fadeMats!.push(cl);
          }
          return cl;
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
        mesh.castShadow = false;
      });
    }
    for (const m of c.fadeMats) m.opacity = alpha;
  }

  private remove(c: Corpse): void {
    const i = this.corpses.indexOf(c);
    if (i >= 0) this.corpses.splice(i, 1);
    c.ragdoll?.dispose();
    c.rig.dispose();
    if (c.fadeMats) for (const m of c.fadeMats) m.dispose();
  }

  /** Removes every corpse (game reset / dispose). */
  clear(): void {
    this.roster.clear();
    for (const c of [...this.corpses]) this.remove(c);
  }
}
