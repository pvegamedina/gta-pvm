// THREE-side helpers for procedural upper-body poses on a skinned rig, run
// after the AnimationMixer each frame: world-space bone rotations (spine lean
// and aim), two-bone arm IK (characters/ik.ts) that swings the upper arm and
// forearm onto the solved elbow/wrist and then sets the hand's world
// orientation, and a snapshot of the animated pose so the procedural result
// can be blended in by a weight (no snapping when it fades in or out).
//
// Bones are assumed to be uniformly scaled and their world matrices current
// (call root.updateMatrixWorld(true) after the mixer); every helper keeps the
// affected subtree's world matrices up to date for the next one.

import * as THREE from "three";
import { solveTwoBoneIK } from "./ik";

export interface ArmChain {
  /** Shoulder joint (upper arm bone). */
  upper: THREE.Object3D;
  /** Elbow joint (forearm bone). */
  lower: THREE.Object3D;
  /** Wrist joint (hand bone). */
  wrist: THREE.Object3D;
}

const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _wq = new THREE.Quaternion();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Vector3();
const _w = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _end = new THREE.Vector3();
const _blend = new THREE.Quaternion();

/** World position of `o` from its (current) world matrix. */
export function worldPosition(o: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
  return out.setFromMatrixPosition(o.matrixWorld);
}

/** World quaternion of `o`'s parent (identity for a root). */
function parentWorldQuaternion(o: THREE.Object3D, out: THREE.Quaternion): THREE.Quaternion {
  return o.parent ? o.parent.getWorldQuaternion(out) : out.identity();
}

/**
 * Pre-multiplies `bone`'s world rotation by `q` (a world-space rotation about
 * the bone's own pivot) and refreshes the subtree's world matrices.
 */
export function rotateBoneWorld(bone: THREE.Object3D, q: THREE.Quaternion): void {
  bone.getWorldQuaternion(_wq);
  parentWorldQuaternion(bone, _pq);
  // local' = parentWorld^-1 * q * world
  bone.quaternion.copy(_pq.invert()).multiply(_q.copy(q).multiply(_wq));
  bone.updateMatrixWorld(true);
}

/** Sets `bone`'s world orientation to `q` (position unchanged) and refreshes its subtree. */
export function setBoneWorldQuaternion(bone: THREE.Object3D, q: THREE.Quaternion): void {
  parentWorldQuaternion(bone, _pq);
  bone.quaternion.copy(_pq.invert()).multiply(q);
  bone.updateMatrixWorld(true);
}

/** Swings `bone` (shortest arc) so the direction to its child joint at `childNow` points at `childWanted`. */
function swingBone(bone: THREE.Object3D, childNow: THREE.Vector3, childWanted: THREE.Vector3): void {
  worldPosition(bone, _s);
  _from.subVectors(childNow, _s);
  _to.subVectors(childWanted, _s);
  if (_from.lengthSq() < 1e-12 || _to.lengthSq() < 1e-12) return;
  _q.setFromUnitVectors(_from.normalize(), _to.normalize());
  rotateBoneWorld(bone, _q);
}

/**
 * Two-bone IK on an arm: elbow bent towards `pole` (world point), wrist on
 * `target` (or as close as the arm reaches), then — if given — the hand set to
 * the world orientation `wristQuat`. Bone lengths come from the current pose.
 */
export function poseArm(chain: ArmChain, target: THREE.Vector3, pole: THREE.Vector3, wristQuat: THREE.Quaternion | null): void {
  worldPosition(chain.upper, _s);
  worldPosition(chain.lower, _e);
  worldPosition(chain.wrist, _w);
  const upperLen = _s.distanceTo(_e);
  const lowerLen = _e.distanceTo(_w);
  const sol = solveTwoBoneIK(_s, upperLen, lowerLen, target, pole);
  swingBone(chain.upper, _e, _mid.set(sol.mid.x, sol.mid.y, sol.mid.z));
  worldPosition(chain.wrist, _w);
  swingBone(chain.lower, _w, _end.set(sol.end.x, sol.end.y, sol.end.z));
  if (wristQuat) setBoneWorldQuaternion(chain.wrist, wristQuat);
}

/**
 * Saved local rotations of a set of bones (the animated pose), so a fully
 * applied procedural pose can be blended back towards it by a weight.
 */
export class PoseSnapshot {
  private readonly saved: THREE.Quaternion[];

  constructor(private readonly bones: readonly THREE.Object3D[]) {
    this.saved = bones.map(() => new THREE.Quaternion());
  }

  /** Remembers the bones' current local rotations. */
  save(): void {
    this.bones.forEach((b, i) => this.saved[i].copy(b.quaternion));
  }

  /**
   * Sets each bone to slerp(saved, current, w): w = 0 restores the saved
   * pose, 1 keeps the current one. World matrices are NOT refreshed.
   */
  blend(w: number): void {
    if (w >= 1) return;
    this.bones.forEach((b, i) => b.quaternion.copy(_blend.copy(this.saved[i]).slerp(b.quaternion, Math.max(0, w))));
  }
}
