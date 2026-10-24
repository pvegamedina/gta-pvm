// CharacterRig backed by a skinned Quaternius character: a SkeletonUtils
// clone of the loaded GLB, an AnimationMixer whose actions all play at once
// with weights/times computed by the pure CharacterAnimState blend (smooth
// speed-driven locomotion, soft overlays), the GLB gun attached to the
// Wrist.R bone (with a spring-driven recoil kick on every shot), and an
// invisible hitbox for castShot(). The skinned visual is exposed as
// `ragdollRoot` so a corpse can hand its skeleton to the physics ragdoll.
// Around the mixer, characters/locomotionPose.ts adds the locomotion feel
// (turn in place, strafe direction, lean / banking / landing springs, foot IK
// on the drawn ground with foot locking, head stabilisation), and
// characters/gunHandling.ts the two-handed weapon stance (IK, with sway),
// blended by the smoothed armed/aim weights.
// Every bone the ragdoll writes (plus the untracked Root and Hips) is reset to
// its bind transform before each mixer update (characters/boneSnapshot.ts), so
// a rig handed back from physics to animation never keeps a stale pose.

import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { WeaponId } from "@shared/protocol";
import type { CharacterAssets } from "../assets/characterAssets";
import { setHeldWeapon, type WeaponMeshHandle } from "../combat/weaponMesh";
import { ANIM_CLIPS, CharacterAnimState, type ClipName } from "./animationState";
import { createHitbox, excludeFromRaycast, pruneRaycastWhenHidden } from "./hitbox";
import type { CharacterRig, RigSpec, RigUpdate } from "./characterRig";
import { MUZZLE_NAME } from "./weaponPose";
import { GUN_KICK_OMEGA, RecoilSpring, WEAPON_FEEL } from "../combat/recoil";
import { GunHandling, findUpperBodyBones } from "./gunHandling";
import { BoneTransformSnapshot, findBones } from "./boneSnapshot";
import { RAGDOLL_WRITTEN_BONES } from "../physics/ragdoll";
import { LocomotionPose, findLocomotionBones } from "./locomotionPose";

/** GLTFLoader strips "." from node names, so the "Wrist.R" bone is named "WristR". */
const WEAPON_SOCKET_NAMES = ["WristR", "Wrist.R"];

// ---- One-handed held-gun recoil (scaled by WEAPON_FEEL[weapon].gunKick, spring in
// combat/recoil.ts). Faded out as the two-handed stance (with its own kick) takes over. ----
/** Barrel pitch-up (rad) at full kick: the wrist bone rotates about its Z
 * (its +Y runs along the barrel, -X points up, so +Z rotation lifts the muzzle). */
const KICK_PITCH = 0.42;
/** Slide back towards the elbow (m, along the wrist's -Y) at full kick. */
const KICK_BACK = 0.055;
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
  // Captures the bind pose, so it must run before the first mixer update.
  const upperBones = findUpperBodyBones(visual);
  const handling = upperBones ? new GunHandling(upperBones) : null;
  // Same: bind position/rotation/scale of the ragdoll-driven bones (and the
  // track-less Root/Hips), restored before every mixer update.
  const ragdollBind = new BoneTransformSnapshot(findBones(visual, [...RAGDOLL_WRITTEN_BONES, "Root", "Hips"]));
  ragdollBind.save();
  // Locomotion feel layers; every bone they write is restored above or by GunHandling.
  const locoBones = findLocomotionBones(visual);
  const loco = locoBones ? new LocomotionPose(locoBones) : null;

  let weapon: WeaponId = "fists";
  let handle: WeaponMeshHandle | null = null;
  let handleBase = new THREE.Vector3();
  let weaponDropped = false;
  const kick = new RecoilSpring(GUN_KICK_OMEGA);
  const buildWeapon = (w: "pistol" | "m4") => assets.weapons[w].clone();

  function apply(): void {
    ragdollBind.restore();
    handling?.restoreBindPose();
    for (const [name, action] of actions) {
      action.setEffectiveWeight(anim.weight(name));
      action.time = anim.clipTime(name);
    }
    mixer.update(0);
  }
  apply();

  function update(dt: number, s: RigUpdate): void {
    if (s.weapon !== weapon && !weaponDropped) {
      weapon = s.weapon;
      handle = setHeldWeapon(socket, handle, weapon, buildWeapon);
      if (handle) handleBase = handle.group.position.clone();
      kick.reset();
    }
    loco?.prepare(dt, group, s, anim.gaitPhase);
    anim.update(dt, {
      speed: s.speed,
      armed: weapon !== "fists",
      aiming: s.aiming,
      alive: s.alive,
      running: s.running,
      localX: loco?.local.x,
      localZ: loco?.local.z,
      turnRate: loco?.turn.turnRate,
    });
    apply();
    loco?.applyBody(group, anim.aliveWeight, anim.strafeChestYaw);
    kick.update(dt);
    const k = kick.value;
    // Lean + two-handed stance on top of the animated pose (the mixer rewrites
    // every bone next frame, so nothing accumulates).
    let stance = 0;
    if (handling) {
      const feel = WEAPON_FEEL[weapon].gunKick;
      stance = handling.apply(group, handle?.group ?? null, {
        weapon,
        armedWeight: anim.armedWeight,
        aimWeight: anim.aimWeight,
        aimPitch: s.aimPitch ?? 0,
        lean: loco ? loco.lean * anim.aliveWeight : s.ground ? anim.lean : 0,
        kick: feel > 0 ? k / feel : 0,
        sway: loco?.sway,
      });
    }
    // One-handed recoil for whatever share of the pose is still the animation.
    const k1 = k * (1 - stance);
    if (handle) handle.group.position.copy(handleBase).y -= k1 * KICK_BACK;
    if (Math.abs(k1) > 1e-4 && socket !== visual) socket.rotateZ(k1 * KICK_PITCH);
    loco?.finish(group, s.aimPitch ?? 0, anim.aimWeight, anim.aliveWeight);
  }

  return {
    group,
    kind: "model",
    update,
    triggerAttack(w) {
      anim.trigger(w);
      if (w !== "fists") kick.kick(WEAPON_FEEL[w].gunKick);
    },
    muzzleWorldPosition(out) {
      const muzzle = handle?.group.getObjectByName(MUZZLE_NAME);
      if (!muzzle) return false;
      muzzle.getWorldPosition(out);
      return true;
    },
    ragdollRoot: visual,
    dropWeapon() {
      handle = setHeldWeapon(socket, handle, "fists", buildWeapon);
      weapon = "fists";
      weaponDropped = true;
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(visual);
      group.removeFromParent();
      // Each SkeletonUtils clone owns its Skeleton (and its bone texture).
      visual.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && (o as THREE.SkinnedMesh).skeleton.dispose());
    },
  };
}
