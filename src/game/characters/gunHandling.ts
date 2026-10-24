// Procedural upper body for the skinned characters, applied after the
// AnimationMixer every frame (all Quaternius gun clips are one-handed pistol
// poses, so long guns looked wrong):
//
//  1. Start/stop lean: an additive pitch on Torso + Chest from the blend
//     state's acceleration-driven lean.
//  2. Two-handed stance (weaponPose.ts StancePose): the spine takes part of
//     the aim pitch and blades the torso, then the RIGHT arm is solved with
//     two-bone IK so the gun lands at the stance's grip point with its barrel
//     along the aim (rifle shouldered / pistol isosceles; rifle low-ready
//     carry when not aiming), including the per-shot kick.
//  3. The LEFT arm is solved to the gun's `support` marker (handguard / left
//     side of the pistol grip) with the configured hand orientation.
//
// Each stage is blended against the animated pose by the smoothed armed/aim
// weights (PoseSnapshot), so raising, lowering, switching weapon or dying
// never snaps. The gun stays a child of the right wrist, so the muzzle marker
// (bullets, flash) follows the solved pose.

import * as THREE from "three";
import type { WeaponId } from "@shared/protocol";
import { SUPPORT_NAME, WEAPON_POSES, type StancePose } from "./weaponPose";
import { PoseSnapshot, poseArm, rotateBoneWorld, worldPosition, type ArmChain } from "./upperBodyPose";

export interface UpperBodyBones {
  torso: THREE.Object3D;
  chest: THREE.Object3D;
  /** Head counter-rotates the torso twist so the eyes stay on the aim (optional). */
  head: THREE.Object3D | null;
  right: ArmChain;
  left: ArmChain;
  /** Left finger joints (Index/Middle/Ring/Pinky 1-3) curled around the gun. */
  leftFingers: THREE.Object3D[];
}

/** GLTFLoader strips "." from node names ("UpperArm.R" -> "UpperArmR"); accept both spellings. */
function bone(root: THREE.Object3D, name: string): THREE.Object3D | undefined {
  return root.getObjectByName(name.replace(/\./g, "")) ?? root.getObjectByName(name);
}

/** Finds the Quaternius spine/arm bones, or null when the model doesn't have them. */
export function findUpperBodyBones(root: THREE.Object3D): UpperBodyBones | null {
  const names = ["Torso", "Chest", "UpperArm.R", "LowerArm.R", "Wrist.R", "UpperArm.L", "LowerArm.L", "Wrist.L"];
  const b = names.map((n) => bone(root, n));
  if (b.some((x) => !x)) return null;
  const [torso, chest, ur, lr, wr, ul, ll, wl] = b as THREE.Object3D[];
  const leftFingers: THREE.Object3D[] = [];
  for (const f of ["Index", "Middle", "Ring", "Pinky"]) {
    for (let j = 1; j <= 3; j++) {
      const fb = bone(root, `${f}${j}.L`);
      if (fb) leftFingers.push(fb);
    }
  }
  return { torso, chest, head: bone(root, "Head") ?? null, right: { upper: ur, lower: lr, wrist: wr }, left: { upper: ul, lower: ll, wrist: wl }, leftFingers };
}

export interface GunHandlingInput {
  weapon: WeaponId;
  /** Smoothed 0..1 factors from CharacterAnimState. */
  armedWeight: number;
  aimWeight: number;
  /** Aim pitch (rad, + = up) the barrel levels at while aiming. */
  aimPitch: number;
  /** Start/stop lean (rad, + = forward). */
  lean: number;
  /** Normalised gun kick (~1 at the peak of a full kick). */
  kick: number;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

// Scratch objects (one controller runs at a time; nothing is kept between calls).
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _rootQ = new THREE.Quaternion();
const _gunQ = new THREE.Quaternion();
const _wristQ = new THREE.Quaternion();
const _holderRest = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _m = new THREE.Matrix4();
const _fwd = new THREE.Vector3();
const _left = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _upP = new THREE.Vector3();
const _fwdP = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _grip = new THREE.Vector3();
const _barrel = new THREE.Vector3();
const _gunUp = new THREE.Vector3();
const _gunRight = new THREE.Vector3();
const _target = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const _xAxis = new THREE.Vector3(1, 0, 0);
/** Share of the torso twist the head undoes, and of the remaining aim pitch it follows. */
const HEAD_COUNTER_TWIST = 0.9;
const HEAD_PITCH_FOLLOW = 0.8;

/** Blended stance (numeric lerp of every field). */
const _stance: StancePose = {
  grip: [0, 0, 0],
  pitch: 0,
  yaw: 0,
  cant: 0,
  followPitch: true,
  rightElbow: [0, 0, 0],
  leftElbow: [0, 0, 0],
  spinePitchShare: 0,
  spineTwist: 0,
};

function lerp3(out: [number, number, number], a: readonly number[], b: readonly number[], t: number): void {
  out[0] = mix(a[0], b[0], t);
  out[1] = mix(a[1], b[1], t);
  out[2] = mix(a[2], b[2], t);
}

function blendStance(a: StancePose, b: StancePose, t: number): StancePose {
  lerp3(_stance.grip, a.grip, b.grip, t);
  lerp3(_stance.rightElbow, a.rightElbow, b.rightElbow, t);
  lerp3(_stance.leftElbow, a.leftElbow, b.leftElbow, t);
  _stance.pitch = mix(a.pitch, b.pitch, t);
  _stance.yaw = mix(a.yaw, b.yaw, t);
  _stance.cant = mix(a.cant, b.cant, t);
  _stance.spinePitchShare = mix(a.spinePitchShare, b.spinePitchShare, t);
  _stance.spineTwist = mix(a.spineTwist, b.spineTwist, t);
  return _stance;
}

/** Stance-frame point (x right, y up, z forward) relative to `origin`, into `out` (world). */
function stanceToWorld(origin: THREE.Vector3, p: readonly number[], out: THREE.Vector3): THREE.Vector3 {
  return out
    .copy(origin)
    .addScaledVector(_right, p[0])
    .addScaledVector(_upP, p[1])
    .addScaledVector(_fwdP, p[2]);
}

export class GunHandling {
  private readonly spineAndRight: PoseSnapshot;
  private readonly leftArm: PoseSnapshot;
  private supportFor: THREE.Object3D | null = null;
  private support: THREE.Object3D | null = null;
  /** Bind pose of every bone this controller rotates (some, like Torso/Chest,
   * have no animation tracks, so the mixer would never overwrite our edits). */
  private readonly bind: PoseSnapshot;

  constructor(private readonly bones: UpperBodyBones) {
    const { torso, chest, head, right, left, leftFingers } = bones;
    const spine = head ? [torso, chest, head] : [torso, chest];
    this.spineAndRight = new PoseSnapshot([...spine, right.upper, right.lower, right.wrist]);
    this.leftArm = new PoseSnapshot([left.upper, left.lower, left.wrist, ...leftFingers]);
    this.bind = new PoseSnapshot([...spine, right.upper, right.lower, right.wrist, left.upper, left.lower, left.wrist, ...leftFingers]);
    this.bind.save();
  }

  /**
   * Puts the touched bones back to their bind pose. Call right BEFORE the
   * mixer update each frame: animated bones get overwritten anyway, and
   * un-animated ones no longer accumulate last frame's procedural pose.
   */
  restoreBindPose(): void {
    this.bind.blend(0);
  }

  /**
   * Applies lean + two-handed stance to the freshly animated skeleton under
   * `root` (the rig group, positioned by gameplay). `holder` is the gun
   * attached to the right wrist (null when unarmed). Returns the stance weight
   * actually applied (0..1) so the caller can fade its one-handed kick out.
   */
  apply(root: THREE.Object3D, holder: THREE.Object3D | null, input: GunHandlingInput): number {
    const { torso, chest, head, right, left, leftFingers } = this.bones;
    root.updateMatrixWorld(true);
    // Character frame: forward (+Z of the rig), its left (+X) and world up.
    root.getWorldQuaternion(_rootQ);
    _fwd.set(0, 0, 1).applyQuaternion(_rootQ).setY(0).normalize();
    _up.copy(WORLD_UP);
    _left.crossVectors(_up, _fwd).normalize();
    _right.copy(_left).negate();

    // 1) Start/stop lean, split over Torso and Chest (positive about +left = forward).
    if (Math.abs(input.lean) > 1e-4) {
      _q.setFromAxisAngle(_left, input.lean / 2);
      rotateBoneWorld(torso, _q);
      rotateBoneWorld(chest, _q);
    }

    const pose = input.weapon === "fists" ? null : WEAPON_POSES[input.weapon];
    if (!pose || !holder) return 0;
    const w = Math.min(1, pose.carry ? input.armedWeight : input.aimWeight);
    if (w < 1e-3) return 0;
    // Carry -> aim morph (the pistol has no carry stance: it is aim-only).
    const t = pose.carry ? Math.min(1, input.aimWeight / Math.max(input.armedWeight, 1e-6)) : 1;
    const st = pose.carry ? blendStance(pose.carry, pose.aim, t) : blendStance(pose.aim, pose.aim, 1);
    const framePitch = mix(pose.carry && !pose.carry.followPitch ? 0 : input.aimPitch, pose.aim.followPitch ? input.aimPitch : 0, t);

    this.spineAndRight.save();
    this.leftArm.save();

    // 2a) Spine: follow part of the aim pitch (looking up leans back) and blade the torso.
    _q.setFromAxisAngle(_up, st.spineTwist / 2).multiply(_q2.setFromAxisAngle(_left, (-st.spinePitchShare * framePitch) / 2));
    rotateBoneWorld(torso, _q);
    rotateBoneWorld(chest, _q);
    // Head: undo most of the twist and look along the rest of the aim pitch.
    if (head) {
      _q.setFromAxisAngle(_up, -st.spineTwist * HEAD_COUNTER_TWIST).multiply(_q2.setFromAxisAngle(_left, -(1 - st.spinePitchShare) * framePitch * HEAD_PITCH_FOLLOW));
      rotateBoneWorld(head, _q);
    }

    // 2b) Stance frame at the right shoulder, pitched with the aim.
    _fwdP.copy(_fwd).multiplyScalar(Math.cos(framePitch)).addScaledVector(_up, Math.sin(framePitch));
    _upP.copy(_up).multiplyScalar(Math.cos(framePitch)).addScaledVector(_fwd, -Math.sin(framePitch));
    worldPosition(right.upper, _origin);
    stanceToWorld(_origin, st.grip, _grip);

    // Gun orientation: barrel from the stance pitch/yaw, sights up (+cant), right = barrel x up.
    const cp = Math.cos(st.pitch);
    _barrel
      .set(0, 0, 0)
      .addScaledVector(_right, -Math.sin(st.yaw) * cp)
      .addScaledVector(_upP, Math.sin(st.pitch))
      .addScaledVector(_fwdP, Math.cos(st.yaw) * cp)
      .normalize();
    _gunUp.copy(_upP).addScaledVector(_barrel, -_upP.dot(_barrel)).normalize();
    if (st.cant !== 0) _gunUp.applyAxisAngle(_barrel, st.cant);
    // Kick: muzzle flips up about the grip and the gun slides back.
    if (input.kick !== 0) {
      _gunRight.crossVectors(_barrel, _gunUp);
      const a = input.kick * pose.kick.pitch;
      _barrel.applyAxisAngle(_gunRight, a);
      _gunUp.applyAxisAngle(_gunRight, a);
      _grip.addScaledVector(_barrel, -input.kick * pose.kick.back);
    }
    _gunRight.crossVectors(_barrel, _gunUp);
    _gunQ.setFromRotationMatrix(_m.makeBasis(_barrel, _gunUp, _gunRight));

    // Right wrist = gun pose x inverse(gun-in-wrist rest transform).
    _holderRest.setFromEuler(_euler.set(...pose.rotation));
    _wristQ.copy(_gunQ).multiply(_q.copy(_holderRest).invert());
    _target.copy(_grip).sub(_tmp.set(...pose.handOffset).applyQuaternion(_wristQ));
    stanceToWorld(_origin, st.rightElbow, _pole);
    poseArm(right, _target, _pole, _wristQ);
    this.spineAndRight.blend(w);
    root.updateMatrixWorld(true);

    // 3) Left hand onto the support marker of the gun as it ended up.
    const support = this.supportMarker(holder);
    if (support) {
      support.getWorldPosition(_target);
      holder.getWorldQuaternion(_gunQ);
      _wristQ.copy(_gunQ).multiply(_q.setFromEuler(_euler.set(...pose.support.rotation)));
      _target.sub(_tmp.set(...pose.support.palm).applyQuaternion(_wristQ));
      worldPosition(left.upper, _origin);
      stanceToWorld(_origin, st.leftElbow, _pole);
      poseArm(left, _target, _pole, _wristQ);
      // Close the (open, animated) fingers around the handguard / right fist:
      // the finger bones run along +Y with the palm on their -Z side.
      _q.setFromAxisAngle(_xAxis, -pose.support.curl);
      for (const f of leftFingers) f.quaternion.multiply(_q);
      this.leftArm.blend(w);
      root.updateMatrixWorld(true);
    }
    return w;
  }

  private supportMarker(holder: THREE.Object3D): THREE.Object3D | null {
    if (this.supportFor !== holder) {
      this.supportFor = holder;
      this.support = holder.getObjectByName(SUPPORT_NAME) ?? null;
    }
    return this.support;
  }
}
