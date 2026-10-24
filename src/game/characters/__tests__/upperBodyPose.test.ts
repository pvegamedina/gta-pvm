import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { poseArm, rotateBoneWorld, PoseSnapshot, type ArmChain } from "../upperBodyPose";

/** A shoulder -> elbow -> wrist chain with awkward (non-identity) rest rotations, like a real rig. */
function makeArm(): { root: THREE.Group; chain: ArmChain } {
  const root = new THREE.Group();
  root.position.set(3, 0, -2);
  root.rotation.y = 0.7;
  const chest = new THREE.Bone();
  chest.position.set(0, 1.3, 0);
  chest.rotation.set(0.1, -0.2, 0.05);
  const upper = new THREE.Bone();
  upper.position.set(-0.15, 0.1, 0);
  upper.quaternion.set(-0.627, -0.308, -0.439, 0.565).normalize();
  const lower = new THREE.Bone();
  lower.position.set(0, 0.182, 0);
  lower.quaternion.set(-0.206, -0.194, 0.324, 0.903).normalize();
  const wrist = new THREE.Bone();
  wrist.position.set(0, 0.235, 0);
  wrist.quaternion.set(0.011, -0.021, -0.039, 0.999).normalize();
  root.add(chest);
  chest.add(upper);
  upper.add(lower);
  lower.add(wrist);
  root.updateMatrixWorld(true);
  return { root, chain: { upper, lower, wrist } };
}

const wp = (o: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
const wq = (o: THREE.Object3D) => o.getWorldQuaternion(new THREE.Quaternion());

describe("poseArm", () => {
  it("puts the wrist on a reachable target with the requested world orientation", () => {
    const { chain } = makeArm();
    const shoulder = wp(chain.upper);
    const target = shoulder.clone().add(new THREE.Vector3(0.1, -0.1, 0.25));
    const want = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -1.1, 0.4));
    poseArm(chain, target, shoulder.clone().add(new THREE.Vector3(0, -1, 0)), want);
    expect(wp(chain.wrist).distanceTo(target)).toBeLessThan(1e-5);
    expect(wq(chain.wrist).angleTo(want)).toBeLessThan(1e-5);
    // The shoulder joint itself never moves.
    expect(wp(chain.upper).distanceTo(shoulder)).toBeLessThan(1e-9);
  });

  it("keeps the bone lengths and bends the elbow towards the pole", () => {
    const { chain } = makeArm();
    const shoulder = wp(chain.upper);
    const a = wp(chain.lower).distanceTo(shoulder);
    const b = wp(chain.wrist).distanceTo(wp(chain.lower));
    const target = shoulder.clone().add(new THREE.Vector3(0, 0, 0.3));
    const pole = shoulder.clone().add(new THREE.Vector3(0, -1, 0));
    poseArm(chain, target, pole, null);
    expect(wp(chain.lower).distanceTo(shoulder)).toBeCloseTo(a, 6);
    expect(wp(chain.wrist).distanceTo(wp(chain.lower))).toBeCloseTo(b, 6);
    expect(wp(chain.lower).y).toBeLessThan(shoulder.y);
  });
});

describe("rotateBoneWorld", () => {
  it("applies a world-space rotation and keeps the bone's position", () => {
    const { chain } = makeArm();
    const before = wq(chain.upper);
    const pos = wp(chain.upper);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.4);
    rotateBoneWorld(chain.upper, q);
    expect(wq(chain.upper).angleTo(q.clone().multiply(before))).toBeLessThan(1e-6);
    expect(wp(chain.upper).distanceTo(pos)).toBeLessThan(1e-9);
  });
});

describe("PoseSnapshot", () => {
  it("blends between the saved (animated) pose and the current one", () => {
    const { chain } = makeArm();
    const bones = [chain.upper, chain.lower];
    const snap = new PoseSnapshot(bones);
    const saved = bones.map((b) => b.quaternion.clone());
    snap.save();
    poseArm(chain, wp(chain.upper).add(new THREE.Vector3(0, 0, 0.3)), new THREE.Vector3(0, -5, 0), null);
    const posed = bones.map((b) => b.quaternion.clone());
    snap.blend(0);
    bones.forEach((b, i) => expect(b.quaternion.angleTo(saved[i])).toBeLessThan(1e-9));
    bones.forEach((b, i) => b.quaternion.copy(posed[i]));
    snap.blend(1);
    bones.forEach((b, i) => expect(b.quaternion.angleTo(posed[i])).toBeLessThan(1e-9));
    snap.blend(0.5);
    bones.forEach((b, i) => expect(b.quaternion.angleTo(saved[i])).toBeCloseTo(posed[i].angleTo(saved[i]) / 2, 6));
  });
});
