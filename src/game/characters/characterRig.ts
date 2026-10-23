// Common interface for every animated human in the game (local player,
// remote players, pedestrians). Two implementations: the GLB character
// models (modelRig.ts) and the procedural box human used as a fallback when
// the models fail to load (proceduralRig.ts).

import type * as THREE from "three";
import type { WeaponId } from "@shared/protocol";
import type { HumanColors } from "../player/human";
import type { CharacterId } from "./characterChoice";

/** Per-frame gameplay state that drives a rig's animation. */
export interface RigUpdate {
  /** Horizontal speed (m/s). */
  speed: number;
  ground: boolean;
  weapon: WeaponId;
  aiming: boolean;
  alive: boolean;
  /** Forces the run cycle (fleeing pedestrians). */
  running?: boolean;
}

export interface CharacterRig {
  /**
   * Root positioned/rotated by gameplay (feet at the origin, facing +Z).
   * Contains the visuals (excluded from raycasts) plus an invisible hitbox,
   * so it can be registered as-is in the ShootableRegistry.
   */
  readonly group: THREE.Group;
  readonly kind: "model" | "procedural";
  /** Advances animation and keeps the held weapon in sync with `state.weapon`. */
  update(dt: number, state: RigUpdate): void;
  /** Plays a punch (fists) or a brief shooting pose (guns). */
  triggerAttack(weapon: WeaponId): void;
  /** Writes the held gun's barrel-tip world position into `out`; false when unarmed. */
  muzzleWorldPosition(out: THREE.Vector3): boolean;
  /** Stops animation and detaches the rig from the scene. Shared GPU assets are kept. */
  dispose(): void;
}

/** What to build: the model rig uses `character`, the procedural fallback `colors`. */
export interface RigSpec {
  character: CharacterId;
  colors: HumanColors;
  castShadow: boolean;
}

export type RigFactory = (spec: RigSpec) => CharacterRig;
