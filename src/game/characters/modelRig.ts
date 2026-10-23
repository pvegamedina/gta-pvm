// CharacterRig backed by a skinned Quaternius character: a SkeletonUtils
// clone of the loaded GLB, an AnimationMixer whose actions all play at once
// with weights/times computed by the pure CharacterAnimState blend (smooth
// speed-driven locomotion, soft overlays), the GLB gun attached to the
// Wrist.R bone, and an invisible hitbox for castShot().

import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { WeaponId } from "@shared/protocol";
import type { CharacterAssets } from "../assets/characterAssets";
import { setHeldWeapon, type WeaponMeshHandle } from "../combat/weaponMesh";
import { ANIM_CLIPS, CharacterAnimState, type ClipName } from "./animationState";
import { createHitbox, excludeFromRaycast, pruneRaycastWhenHidden } from "./hitbox";
import type { CharacterRig, RigSpec, RigUpdate } from "./characterRig";
import { MUZZLE_NAME } from "./weaponPose";

/** GLTFLoader strips "." from node names, so the "Wrist.R" bone is named "WristR". */
const WEAPON_SOCKET_NAMES = ["WristR", "Wrist.R"];

export function createModelRig(assets: CharacterAssets, spec: RigSpec): CharacterRig {
  const source = assets.characters[spec.character];
  const visual = cloneSkinned(source.scene) as THREE.Group;
  visual.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = spec.castShadow;
    // Bind-pose bounds don't follow the animation; culling them makes limbs pop.
    if (mesh.isSkinnedMesh) mesh.frustumCulled = false;
  });
  const socket = WEAPON_SOCKET_NAMES.map((n) => visual.getObjectByName(n)).find(Boolean) ?? visual;

  const group = new THREE.Group();
  group.add(visual, createHitbox());
  excludeFromRaycast(visual);
  pruneRaycastWhenHidden(group);

  // Every clip plays all the time, paused: the blend state sets each action's
  // weight and time explicitly (zero-weight actions cost nothing to evaluate).
  const mixer = new THREE.AnimationMixer(visual);
  const actions = new Map<ClipName, THREE.AnimationAction>();
  const durations: Partial<Record<ClipName, number>> = {};
  for (const name of ANIM_CLIPS) {
    const clip = THREE.AnimationClip.findByName(source.clips, name);
    if (!clip) continue;
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.paused = true;
    action.setEffectiveWeight(0).play();
    actions.set(name, action);
    durations[name] = clip.duration;
  }
  const anim = new CharacterAnimState(durations);

  let weapon: WeaponId = "fists";
  let handle: WeaponMeshHandle | null = null;
  const buildWeapon = (w: "pistol" | "m4") => assets.weapons[w].clone();

  function apply(): void {
    for (const [name, action] of actions) {
      action.setEffectiveWeight(anim.weight(name));
      action.time = anim.clipTime(name);
    }
    mixer.update(0);
  }
  apply();

  function update(dt: number, s: RigUpdate): void {
    if (s.weapon !== weapon) {
      weapon = s.weapon;
      handle = setHeldWeapon(socket, handle, weapon, buildWeapon);
    }
    anim.update(dt, { speed: s.speed, armed: weapon !== "fists", aiming: s.aiming, alive: s.alive, running: s.running });
    apply();
  }

  return {
    group,
    kind: "model",
    update,
    triggerAttack: (w) => anim.trigger(w),
    muzzleWorldPosition(out) {
      const muzzle = handle?.group.getObjectByName(MUZZLE_NAME);
      if (!muzzle) return false;
      muzzle.getWorldPosition(out);
      return true;
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(visual);
      group.removeFromParent();
    },
  };
}
