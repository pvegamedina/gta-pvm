// Pure THREE-math helpers for the ragdolls (physics/ragdoll.ts): orthonormal
// joint frames, capsule sizing from bone lengths, and the world -> bone-local
// conversion used to copy rigid-body poses back onto the skeleton. No Rapier,
// no DOM: unit-testable in Node.

import * as THREE from "three";

const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _q = new THREE.Quaternion();

/**
 * Rotation whose local X axis is `x` (exactly, normalized) and whose local Y
 * axis is `y` made perpendicular to it (Gram-Schmidt); Z = X x Y. Falls back
 * to an arbitrary perpendicular when `y` is parallel to `x`.
 */
export function basisFromXY(x: THREE.Vector3, y: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  _x.copy(x).normalize();
  _y.copy(y).addScaledVector(_x, -_y.dot(_x));
  if (_y.lengthSq() < 1e-10) {
    // Degenerate: pick whichever world axis is least aligned with X.
    _y.set(Math.abs(_x.y) < 0.9 ? 0 : 1, Math.abs(_x.y) < 0.9 ? 1 : 0, 0);
    _y.addScaledVector(_x, -_y.dot(_x));
  }
  _y.normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

/**
 * Frame for a spherical (ball) joint: X = `twist` (along the limb, so AngX
 * limits the twist), Y = twist x flexDir, so a positive rotation about Y bends
 * the limb towards `flexDir` (AngY = flexion), and Z = X x Y (AngZ = sideways).
 */
export function twistFrame(twist: THREE.Vector3, flexDir: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  const t = _z.copy(twist).normalize();
  const yAxis = new THREE.Vector3().crossVectors(t, flexDir);
  if (yAxis.lengthSq() < 1e-10) yAxis.set(1, 0, 0).addScaledVector(t, -t.x);
  return basisFromXY(twist, yAxis, out);
}

/**
 * Frame for a revolute (hinge) joint: X = `hinge` (Rapier's revolute free
 * axis), Y = the limb direction made perpendicular to the hinge. The joint
 * angle is the rotation of one frame's Y towards the other's about X.
 */
export function hingeFrame(hinge: THREE.Vector3, dir: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  return basisFromXY(hinge, dir, out);
}

/**
 * Capsule (Rapier capsules run along local Y) covering a bone of `length`
 * metres from its head (local origin) to its tail: the half height of the
 * cylindrical part plus both caps add up to the length; never degenerate.
 */
export function segmentCapsule(length: number, radius: number): { halfHeight: number; centerY: number } {
  return { halfHeight: Math.max(0.01, length / 2 - radius), centerY: length / 2 };
}

/**
 * Local TRS that places a child at `desiredWorld` under a parent whose world
 * matrix is `parentWorld` (parentWorld * local = desiredWorld).
 */
export function worldToLocal(
  parentWorld: THREE.Matrix4,
  desiredWorld: THREE.Matrix4,
  pos: THREE.Vector3,
  quat: THREE.Quaternion,
  scale: THREE.Vector3,
): void {
  _inv.copy(parentWorld).invert();
  _m.multiplyMatrices(_inv, desiredWorld);
  _m.decompose(pos, quat, scale);
}

/** `v` minus its component along the unit vector `axis`, written into `out`. */
export function perpComponent(v: THREE.Vector3, axis: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(v).addScaledVector(axis, -v.dot(axis));
}

/**
 * Per-axis angles of frame 2 relative to frame 1 (both world rotations),
 * expressed in frame 1, using the same small-angle-friendly metric as
 * Rapier's joint limits: 2·asin of the relative quaternion's imaginary part.
 * Used to widen limits so a joint created in an awkward pose doesn't snap.
 */
export function frameAngles(f1: THREE.Quaternion, f2: THREE.Quaternion): { x: number; y: number; z: number } {
  _q.copy(f1).invert().multiply(f2);
  if (_q.w < 0) _q.set(-_q.x, -_q.y, -_q.z, -_q.w);
  const a = (v: number) => 2 * Math.asin(Math.max(-1, Math.min(1, v)));
  return { x: a(_q.x), y: a(_q.y), z: a(_q.z) };
}

/** Expands `[lo, hi]` so it contains `value` with `margin` to spare. */
export function widenLimits(limits: readonly [number, number], value: number, margin: number): [number, number] {
  return [Math.min(limits[0], value - margin), Math.max(limits[1], value + margin)];
}
