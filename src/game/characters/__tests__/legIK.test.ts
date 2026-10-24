import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { poseLeg, shinTipLocal, type LegChain } from "../legIK";

/**
 * Root > Body > UpperLeg > LowerLeg, and Root > Foot: like the Quaternius rig,
 * the foot is an IK bone hanging off Root, not off the shin.
 */
function makeRig(): { group: THREE.Group; root: THREE.Bone; body: THREE.Bone; leg: LegChain } {
  const group = new THREE.Group();
  group.position.set(2, 1, -3);
  group.rotation.y = 0.6;
  const root = new THREE.Bone();
  root.position.set(0, 0, 0.07);
  const body = new THREE.Bone();
  body.position.set(0, 0.83, 0);
  body.quaternion.set(0, 0.236, 0, 0.972).normalize();
  const upper = new THREE.Bone();
  upper.position.set(0.1, 0.1, 0);
  upper.quaternion.setFromEuler(new THREE.Euler(Math.PI - 0.05, 0.1, 0.02));
  const lower = new THREE.Bone();
  lower.position.set(0, 0.433, 0);
  lower.quaternion.setFromEuler(new THREE.Euler(0.12, 0, 0));
  const foot = new THREE.Bone();
  group.add(root);
  root.add(body, foot);
  body.add(upper);
  upper.add(lower);
  group.updateMatrixWorld(true);
  // Put the foot bone exactly at the shin's tip (0.511 m down the shin), as the clips do.
  const tip = lower.localToWorld(new THREE.Vector3(0, 0.511, 0));
  foot.position.copy(root.worldToLocal(tip.clone()));
  foot.rotation.set(0.2, -0.3, 0.1);
  group.updateMatrixWorld(true);
  return { group, root, body, leg: { upper, lower, foot } };
}

const wp = (o: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);

describe("poseLeg", () => {
  it("puts the shin tip and the (root-parented) foot bone on the target, keeping both bone lengths", () => {
    const { group, body, leg } = makeRig();
    const tipLocal = shinTipLocal(leg, new THREE.Vector3());
    const hip0 = wp(leg.upper);
    const thigh = wp(leg.lower).distanceTo(hip0);
    // Drop the pelvis 8 cm (as on a slope): the foot target stays on the ground.
    const target = wp(leg.foot).add(new THREE.Vector3(0.03, -0.02, 0.05));
    body.position.y -= 0.08;
    group.updateMatrixWorld(true);
    const pole = wp(leg.lower).add(new THREE.Vector3(Math.sin(0.6), 0, Math.cos(0.6)));
    const out = poseLeg(leg, tipLocal, target, pole, null, new THREE.Vector3());
    const tipNow = leg.lower.localToWorld(tipLocal.clone());
    expect(tipNow.distanceTo(target)).toBeLessThan(1e-5);
    expect(wp(leg.foot).distanceTo(target)).toBeLessThan(1e-5);
    expect(out.distanceTo(target)).toBeLessThan(1e-5);
    expect(wp(leg.lower).distanceTo(wp(leg.upper))).toBeCloseTo(thigh, 6);
  });

  it("bends the knee towards the pole (forward)", () => {
    const { group, body, leg } = makeRig();
    const tipLocal = shinTipLocal(leg, new THREE.Vector3());
    const target = wp(leg.foot);
    body.position.y -= 0.2; // deep crouch
    group.updateMatrixWorld(true);
    const fwd = new THREE.Vector3(Math.sin(0.6), 0, Math.cos(0.6));
    const pole = wp(leg.lower).addScaledVector(fwd, 1);
    poseLeg(leg, tipLocal, target, pole, null, new THREE.Vector3());
    const hip = wp(leg.upper);
    const knee = wp(leg.lower);
    const axisMid = hip.clone().add(target).multiplyScalar(0.5);
    expect(knee.clone().sub(axisMid).dot(fwd)).toBeGreaterThan(0.05);
  });

  it("sets the foot's world rotation when given one", () => {
    const { leg } = makeRig();
    const tipLocal = shinTipLocal(leg, new THREE.Vector3());
    const want = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, 0.4, -0.2));
    poseLeg(leg, tipLocal, wp(leg.foot), wp(leg.lower).add(new THREE.Vector3(0, 0, 1)), want, new THREE.Vector3());
    expect(leg.foot.getWorldQuaternion(new THREE.Quaternion()).angleTo(want)).toBeLessThan(1e-5);
  });

  it("stretches as far as it can towards an unreachable target", () => {
    const { leg } = makeRig();
    const tipLocal = shinTipLocal(leg, new THREE.Vector3());
    const far = wp(leg.upper).add(new THREE.Vector3(0, -3, 0));
    const out = poseLeg(leg, tipLocal, far, wp(leg.lower).add(new THREE.Vector3(0, 0, 1)), null, new THREE.Vector3());
    expect(out.distanceTo(wp(leg.upper))).toBeCloseTo(0.433 + 0.511, 3);
    expect(wp(leg.foot).distanceTo(out)).toBeLessThan(1e-5);
  });
});
