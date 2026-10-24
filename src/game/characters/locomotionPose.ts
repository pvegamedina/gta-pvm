// Locomotion "feel" on top of the animated skeleton of the skinned
// characters (modelRig.ts), shared by the local player, remote players and
// pedestrians. Each frame:
//
//  prepare()   before the mixer: velocity (given or derived from the group's
//              motion), the move direction in the character's frame (picks the
//              strafe clips), turn-in-place (characters/turnInPlace.ts), the
//              body springs (lean, bank, landing squash, bob, breathing) and
//              the weapon sway (characters/bodyDynamics.ts).
//  applyBody() after the mixer, before the gun stance: the lower body turns
//              by the turn-in-place offset and banks into turns (Root bone,
//              about the feet), the upper body twists back to the facing
//              (spine leads, hips follow; also undoes the strafe clips' built-in
//              chest yaw), the chest breathes, the pelvis (Body) drops for
//              foot IK / landings, and two-bone leg IK puts each foot on the
//              drawn ground (terrain + road/kerb lift), tilted to the slope and
//              pinned while planted (characters/footPlacement.ts, legIK.ts).
//  finish()    after the gun stance: the head counter-rotates part of the
//              body's sway so the view stays steady.
//
// Foot IK is LOD'd by camera distance and fades out in the air and on death;
// everything else is a handful of springs. No per-frame allocations.

import * as THREE from "three";
import { angDiff, smooth } from "../core/math";
import { SpringDamper } from "../core/spring";
import { groundNormal, surfaceY } from "../world/ground";
import { damp, localDirection } from "./animationBlend";
import { BodyDynamics, WeaponSway } from "./bodyDynamics";
import { FootLock, footTilt, pelvisOffset, stanceWeight, type FootTilt } from "./footPlacement";
import { poseLeg, type LegChain } from "./legIK";
import { TurnInPlace } from "./turnInPlace";
import { rotateBoneWorld } from "./upperBodyPose";

export interface LocomotionBones {
  root: THREE.Object3D;
  body: THREE.Object3D;
  abdomen: THREE.Object3D;
  torso: THREE.Object3D;
  chest: THREE.Object3D;
  head: THREE.Object3D | null;
  legs: [LegChain, LegChain];
}

/** GLTFLoader strips "." from node names ("Foot.L" -> "FootL"); accept both spellings. */
function bone(root: THREE.Object3D, name: string): THREE.Object3D | undefined {
  return root.getObjectByName(name.replace(/\./g, "")) ?? root.getObjectByName(name);
}

/** Finds the Quaternius pelvis / spine / leg bones, or null when the model doesn't have them. */
export function findLocomotionBones(visual: THREE.Object3D): LocomotionBones | null {
  const names = ["Root", "Body", "Abdomen", "Torso", "Chest", "UpperLeg.L", "LowerLeg.L", "Foot.L", "UpperLeg.R", "LowerLeg.R", "Foot.R"];
  const b = names.map((n) => bone(visual, n));
  if (b.some((x) => !x)) return null;
  const [root, body, abdomen, torso, chest, ul, ll, fl, ur, lr, fr] = b as THREE.Object3D[];
  return {
    root,
    body,
    abdomen,
    torso,
    chest,
    head: bone(visual, "Head") ?? null,
    legs: [
      { upper: ul, lower: ll, foot: fl },
      { upper: ur, lower: lr, foot: fr },
    ],
  };
}

/** Per-frame inputs (a subset of RigUpdate). */
export interface LocomotionInput {
  speed: number;
  ground: boolean;
  alive: boolean;
  aimPitch?: number;
  vx?: number;
  vz?: number;
  vy?: number;
  cameraDistance?: number;
}

/** Tunables (m, s, Hz, rad). */
export const LOCO_TUNING = {
  /** Foot IK runs within ikNear of the camera, fading out by ikFar. */
  ikNear: 30,
  ikFar: 35,
  /** IK weight time constants: fast in on landing, a bit slower out on take-off. */
  ikInTau: 0.03,
  ikOutTau: 0.08,
  /** Feet stop locking above this speed (sprint strides outrun the clip: let them slide a bit). */
  lockMaxSpeed: 7.5,
  /** Pelvis height spring (foot IK offset). */
  pelvisFrequency: 5,
  /** Knee pole: this far in front of the animated knee, along the lower body's forward. */
  kneePole: 0.6,
  /** How the upper-body twist is spread over Abdomen / Torso / Chest. */
  twistAbdomen: 0.3,
  twistTorso: 0.35,
  twistChest: 0.35,
  /** Share of the head's deviation from the look direction that is removed. */
  headStabilize: 0.6,
  /** Share of the aim pitch the head looks along while aiming. */
  headPitchFollow: 0.8,
  /** Derived (group motion) velocity: smoothing, and jumps treated as teleports. */
  derivedTau: 0.05,
  teleport: 3,
  maxDerivedSpeed: 15,
} as const;

const L = LOCO_TUNING;
const UP = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

// Scratch (rigs update one at a time).
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qIdentity = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _out = new THREE.Vector3();
const _normal = { x: 0, y: 1, z: 0 };
const _tilt: FootTilt = { ax: 1, az: 0, angle: 0 };
const _xz = { x: 0, z: 0 };

export class LocomotionPose {
  readonly turn = new TurnInPlace();
  readonly dynamics = new BodyDynamics();
  readonly weaponSway = new WeaponSway();
  /** Move direction in the character's frame (x = left, z = forward), m/s. */
  readonly local = { x: 0, z: 0 };
  /** Sway values handed to GunHandling (scaled by the alive weight). */
  readonly sway = { yaw: 0, pitch: 0, x: 0, y: 0 };

  private readonly locks = [new FootLock(), new FootLock()];
  private readonly pelvis = new SpringDamper(L.pelvisFrequency, 1);
  private ikW = 0;
  private dt = 0;
  private speed = 0;
  private grounded = true;
  private started = false;
  private lastX = 0;
  private lastY = 0;
  private lastZ = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private dvx = 0;
  private dvz = 0;
  private dvy = 0;
  // Per-leg scratch kept between the IK passes of one frame.
  private readonly footPos = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly footQ = [new THREE.Quaternion(), new THREE.Quaternion()];
  private readonly tip = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly target = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly height = [0, 0];

  constructor(private readonly bones: LocomotionBones) {}

  /** Start/stop lean (rad, + = forward) for the spine (GunHandling adds it). */
  get lean(): number {
    return this.dynamics.pitch;
  }

  /** Current foot-IK weight (0..1), for debugging / tests. */
  get ikWeight(): number {
    return this.ikW;
  }

  /** Before the mixer: motion estimates and every controller (see the header). */
  prepare(dt: number, group: THREE.Object3D, s: LocomotionInput, gaitPhase: number): void {
    const p = group.position;
    const yaw = group.rotation.y;
    const pitch = s.aimPitch ?? 0;
    if (!this.started) {
      this.started = true;
      this.lastX = p.x;
      this.lastY = p.y;
      this.lastZ = p.z;
      this.lastYaw = yaw;
      this.lastPitch = pitch;
      this.turn.reset(yaw);
    }
    this.dt = dt;
    const dx = p.x - this.lastX;
    const dy = p.y - this.lastY;
    const dz = p.z - this.lastZ;
    const teleported = dx * dx + dy * dy + dz * dz > L.teleport * L.teleport;
    if (teleported) {
      this.turn.reset(yaw);
      this.locks[0].reset();
      this.locks[1].reset();
      this.dvx = this.dvz = this.dvy = 0;
    } else if (dt > 0) {
      const k = 1 - Math.exp(-dt / L.derivedTau);
      const sp = Math.hypot(dx, dz) / dt;
      const lim = sp > L.maxDerivedSpeed ? L.maxDerivedSpeed / sp : 1;
      this.dvx += ((dx / dt) * lim - this.dvx) * k;
      this.dvz += ((dz / dt) * lim - this.dvz) * k;
      this.dvy += (dy / dt - this.dvy) * k;
    }
    const vx = s.vx ?? this.dvx;
    const vz = s.vz ?? this.dvz;
    const vy = s.vy ?? this.dvy;
    const yawRate = dt > 0 && !teleported ? angDiff(this.lastYaw, yaw) / dt : 0;
    const pitchRate = dt > 0 ? (pitch - this.lastPitch) / dt : 0;
    this.lastX = p.x;
    this.lastY = p.y;
    this.lastZ = p.z;
    this.lastYaw = yaw;
    this.lastPitch = pitch;
    this.speed = s.speed;
    this.grounded = s.ground;

    if (s.alive) this.turn.update(dt, yaw, s.speed);
    else this.turn.reset(yaw);
    localDirection(vx, vz, yaw, this.local);
    this.dynamics.update(dt, { vx, vz, yaw, grounded: s.ground, vy, gaitPhase, alive: s.alive });
    this.weaponSway.update(dt, { yawRate, pitchRate, lateral: this.local.x, speed: s.speed, gaitPhase });

    const near = 1 - smooth(L.ikNear, L.ikFar, s.cameraDistance ?? 0);
    const ikTarget = s.alive && s.ground ? near : 0;
    this.ikW = damp(this.ikW, ikTarget, ikTarget > this.ikW ? L.ikInTau : L.ikOutTau, dt);
    if (this.ikW < 1e-3) {
      this.locks[0].reset();
      this.locks[1].reset();
    }
  }

  /** After the mixer (see the header). `alive` fades every layer with the death blend. */
  applyBody(group: THREE.Object3D, alive: number, strafeChestYaw: number): void {
    const b = this.bones;
    const dt = this.dt;
    group.updateMatrixWorld(true);

    // 1) Lower body: turn-in-place offset and banking, about the feet.
    const off = -this.turn.twist * alive;
    const bank = this.dynamics.roll * alive;
    if (Math.abs(off) > 1e-5 || Math.abs(bank) > 1e-5) {
      _q.setFromAxisAngle(UP, off);
      _v.set(Math.sin(off), 0, Math.cos(off));
      // + bank leans towards the character's left (+X): rotate about forward by -bank.
      _q2.setFromAxisAngle(_v, -bank).multiply(_q);
      b.root.quaternion.premultiply(_q2);
      b.root.position.applyQuaternion(_q2);
      b.root.updateMatrixWorld(true);
    }

    // 2) Foot targets (ground under each foot, locks) and the pelvis offset.
    const ikW = this.ikW * alive;
    const groupY = group.position.y;
    let pelvisTarget = 0;
    if (ikW > 1e-3) {
      const lockOn = this.grounded && this.speed < L.lockMaxSpeed && ikW > 0.5;
      let dl = 0;
      let dr = 0;
      for (let i = 0; i < 2; i++) {
        const leg = b.legs[i];
        const fp = this.footPos[i];
        leg.foot.matrixWorld.decompose(fp, this.footQ[i], _scale);
        this.tip[i].copy(fp);
        leg.lower.worldToLocal(this.tip[i]);
        const h = fp.y - groupY;
        this.height[i] = h;
        this.locks[i].update(dt, fp.x, fp.z, h, lockOn, _xz);
        const g = surfaceY(_xz.x, _xz.z, groupY + 0.5);
        this.target[i].set(_xz.x, g + h, _xz.z);
        if (i === 0) dl = g - groupY;
        else dr = g - groupY;
      }
      pelvisTarget = pelvisOffset(dl, dr);
    }
    this.pelvis.update(dt, pelvisTarget);
    const drop = ikW * (this.pelvis.value + this.dynamics.pelvisY);
    if (ikW > 1e-3 && Math.abs(drop) > 1e-5) {
      b.body.position.y += drop;
      b.body.updateMatrixWorld(true);
    }

    // 3) Upper body leads: twist the spine back to the facing.
    const twist = (this.turn.twist - strafeChestYaw) * alive;
    if (Math.abs(twist) > 1e-5) {
      rotateBoneWorld(b.abdomen, _q.setFromAxisAngle(UP, twist * L.twistAbdomen));
      rotateBoneWorld(b.torso, _q.setFromAxisAngle(UP, twist * L.twistTorso));
      rotateBoneWorld(b.chest, _q.setFromAxisAngle(UP, twist * L.twistChest));
    }
    // 4) Breathing on the chest (about the character's left axis).
    const breath = this.dynamics.breath * alive;
    if (Math.abs(breath) > 1e-5) {
      const yaw = group.rotation.y;
      rotateBoneWorld(b.chest, _q.setFromAxisAngle(_v.set(Math.cos(yaw), 0, -Math.sin(yaw)), -breath));
    }

    // 5) Leg IK onto the targets.
    if (ikW > 1e-3) {
      const bodyYaw = group.rotation.y + off;
      _v2.set(Math.sin(bodyYaw), 0, Math.cos(bodyYaw));
      for (let i = 0; i < 2; i++) {
        const leg = b.legs[i];
        const t = this.target[i].lerp(this.footPos[i], 1 - ikW);
        _pole.setFromMatrixPosition(leg.lower.matrixWorld).addScaledVector(_v2, L.kneePole);
        groundNormal(t.x, t.z, _normal);
        footTilt(_normal.x, _normal.y, _normal.z, _tilt);
        const tiltAngle = _tilt.angle * stanceWeight(this.height[i]) * ikW;
        _q.setFromAxisAngle(_v3.set(_tilt.ax, 0, _tilt.az), tiltAngle).multiply(this.footQ[i]);
        poseLeg(leg, this.tip[i], t, _pole, _q, _out);
      }
    }

    // Weapon sway for the gun stance, faded with death.
    const ws = this.weaponSway;
    this.sway.yaw = ws.yaw * alive;
    this.sway.pitch = ws.pitch * alive;
    this.sway.x = ws.x * alive;
    this.sway.y = ws.y * alive;
  }

  /**
   * After the gun stance: turns the head part of the way back to the look
   * direction (facing, plus a share of the aim pitch while aiming) so the
   * body's sway, lean and twist don't wobble the view.
   */
  finish(group: THREE.Object3D, aimPitch: number, aimWeight: number, alive: number): void {
    const head = this.bones.head;
    const k = L.headStabilize * alive;
    if (!head || k < 1e-3) return;
    head.matrixWorld.decompose(_v3, _q, _scale);
    const hf = _v.copy(Z).applyQuaternion(_q);
    const hu = _v2.copy(UP).applyQuaternion(_q);
    const yaw = group.rotation.y;
    const p = aimPitch * aimWeight * L.headPitchFollow;
    const df = _v3.set(Math.sin(yaw) * Math.cos(p), Math.sin(p), Math.cos(yaw) * Math.cos(p));
    // Swing the forward onto the look direction, then roll the up onto the vertical.
    _q.setFromUnitVectors(hf, df);
    hu.applyQuaternion(_q);
    const upDot = UP.dot(df);
    const huDot = hu.dot(df);
    _pole.copy(UP).addScaledVector(df, -upDot);
    hu.addScaledVector(df, -huDot);
    if (_pole.lengthSq() > 1e-8 && hu.lengthSq() > 1e-8) {
      _pole.normalize();
      hu.normalize();
      const roll = Math.atan2(_out.crossVectors(hu, _pole).dot(df), hu.dot(_pole));
      _q.premultiply(_q2.setFromAxisAngle(df, roll));
    }
    rotateBoneWorld(head, _q2.copy(_qIdentity).slerp(_q, k));
  }
}
