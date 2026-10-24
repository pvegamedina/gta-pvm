// Fallback CharacterRig built from the procedural box human (player/human.ts),
// used only when the GLB character models fail to load. Keeps the original
// sine-swing walk, aim pose, airborne pose and a simple fall-over on death.

import type { WeaponId } from "@shared/protocol";
import * as THREE from "three";
import { makeHuman } from "../player/human";
import { setHeldWeapon, applyAimPose, buildProceduralWeapon, type WeaponMeshHandle } from "../combat/weaponMesh";
import { AttackTimers } from "./animationState";
import { MUZZLE_NAME } from "./weaponPose";
import { createHitbox, excludeFromRaycast, pruneRaycastWhenHidden } from "./hitbox";
import type { CharacterRig, RigSpec, RigUpdate } from "./characterRig";
import { GUN_KICK_OMEGA, RecoilSpring, WEAPON_FEEL } from "../combat/recoil";

export function createProceduralRig(spec: RigSpec): CharacterRig {
  const human = makeHuman(spec.colors);
  if (spec.castShadow) {
    human.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
    });
  }
  const group = new THREE.Group();
  group.add(human.group, createHitbox());
  excludeFromRaycast(human.group);
  pruneRaycastWhenHidden(group);

  const attacks = new AttackTimers();
  let weapon: WeaponId = "fists";
  let handle: WeaponMeshHandle | null = null;
  let phase = Math.random() * 6;
  let weaponDropped = false;
  const kick = new RecoilSpring(GUN_KICK_OMEGA);

  function update(dt: number, s: RigUpdate): void {
    if (s.weapon !== weapon && !weaponDropped) {
      weapon = s.weapon;
      handle = setHeldWeapon(human.rHand, handle, weapon, buildProceduralWeapon);
    }
    attacks.tick(dt);
    const u = human;
    // Dead: tip the body over (the outer group keeps gameplay's transform).
    u.group.rotation.x = s.alive ? 0 : u.group.rotation.x + (Math.PI / 2 - u.group.rotation.x) * Math.min(1, dt * 4);
    if (!s.alive) return;

    phase += s.speed * dt * 4.5;
    const running = !!s.running || s.speed > 5;
    const amp = Math.min(1, s.speed / 3.4) * (running ? 1.05 : 0.6);
    const sw = Math.sin(phase) * amp;
    const armMul = running ? 1.35 : 0.9;
    const armed = weapon !== "fists";
    const aiming = armed && (s.aiming || attacks.shooting);
    if (s.ground) {
      u.lLeg.rotation.x = sw;
      u.rLeg.rotation.x = -sw;
      u.lArm.rotation.x = -sw * armMul;
      u.rArm.rotation.x = sw * armMul;
      const pump = running ? Math.cos(phase) * 0.12 : 0;
      u.lArm.rotation.z = pump;
      u.rArm.rotation.z = -pump;
    } else {
      u.lLeg.rotation.x = 0.5;
      u.rLeg.rotation.x = -0.3;
      u.lArm.rotation.x = u.rArm.rotation.x = -2.4;
      u.lArm.rotation.z = u.rArm.rotation.z = 0;
    }
    u.torso.rotation.x = running ? 0.22 : 0;
    applyAimPose(u, aiming, armed);
    const punch = attacks.punch;
    if (punch) (punch === "left" ? u.lArm : u.rArm).rotation.x = -1.5;
    // Gun kick: the raised right arm snaps up a little and recovers.
    kick.update(dt);
    if (armed) u.rArm.rotation.x -= kick.value * 0.3;
    u.group.position.y = s.ground ? Math.abs(Math.sin(phase)) * 0.05 * amp : 0;
  }

  return {
    group,
    kind: "procedural",
    update,
    triggerAttack(w) {
      attacks.trigger(w);
      if (w !== "fists") kick.kick(WEAPON_FEEL[w].gunKick);
    },
    muzzleWorldPosition(out) {
      const muzzle = handle?.group.getObjectByName(MUZZLE_NAME);
      if (!muzzle) return false;
      muzzle.getWorldPosition(out);
      return true;
    },
    ragdollRoot: null,
    dropWeapon() {
      handle = setHeldWeapon(human.rHand, handle, "fists", buildProceduralWeapon);
      weapon = "fists";
      weaponDropped = true;
    },
    dispose() {
      group.removeFromParent();
    },
  };
}
