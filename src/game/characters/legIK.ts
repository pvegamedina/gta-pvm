// Two-bone leg IK for the Quaternius rig, where the foot is NOT a child of the
// shin: UpperLeg/LowerLeg hang off Body (the pelvis) while Foot.L/R are IK
// bones under Root that the skin follows. So the shin's tip is tracked as a
// point in LowerLeg space (where the animated foot sat before the pelvis
// moved), the thigh and shin are swung so that tip lands on the target
// (characters/ik.ts, knee towards a pole), and the foot bone is then moved
// onto the solved tip with an optional world orientation. Bones must be
// uniformly scaled with current world matrices; their subtrees are refreshed.

import * as THREE from "three";
import { solveTwoBoneIK, type TwoBoneSolution } from "./ik";
import { setBoneWorldQuaternion, swingBone, worldPosition } from "./upperBodyPose";

export interface LegChain {
  /** Hip joint (thigh bone, child of the pelvis). */
  upper: THREE.Object3D;
  /** Knee joint (shin bone). */
  lower: THREE.Object3D;
  /** Foot IK bone (child of Root, outside the leg chain). */
  foot: THREE.Object3D;
}

const _hip = new THREE.Vector3();
const _knee = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _end = new THREE.Vector3();
const _sol: TwoBoneSolution = { mid: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 }, reached: false };

/** The foot bone's current position expressed in the shin's space: the shin tip to drive. */
export function shinTipLocal(leg: LegChain, out: THREE.Vector3): THREE.Vector3 {
  worldPosition(leg.foot, out);
  return leg.lower.worldToLocal(out);
}

/**
 * Bends the leg so the shin tip (`tipLocal`, from shinTipLocal) reaches
 * `target` (or as close as the leg reaches), knee towards `pole`, then puts
 * the foot bone on the tip (world orientation `footQuat` when given).
 * Returns the reached foot position in `out`.
 */
export function poseLeg(leg: LegChain, tipLocal: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3, footQuat: THREE.Quaternion | null, out: THREE.Vector3): THREE.Vector3 {
  worldPosition(leg.upper, _hip);
  worldPosition(leg.lower, _knee);
  _tip.copy(tipLocal).applyMatrix4(leg.lower.matrixWorld);
  const sol = solveTwoBoneIK(_hip, _hip.distanceTo(_knee), _knee.distanceTo(_tip), target, pole, _sol);
  swingBone(leg.upper, _knee, _mid.set(sol.mid.x, sol.mid.y, sol.mid.z));
  _tip.copy(tipLocal).applyMatrix4(leg.lower.matrixWorld);
  swingBone(leg.lower, _tip, _end.set(sol.end.x, sol.end.y, sol.end.z));
  out.copy(tipLocal).applyMatrix4(leg.lower.matrixWorld);
  const parent = leg.foot.parent;
  if (parent) leg.foot.position.copy(parent.worldToLocal(_tip.copy(out)));
  else leg.foot.position.copy(out);
  if (footQuat) setBoneWorldQuaternion(leg.foot, footQuat);
  else leg.foot.updateMatrixWorld(true);
  return out;
}
