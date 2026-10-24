import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { BoneTransformSnapshot, findBones } from "../boneSnapshot";

function rig(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Bone();
  body.name = "Body";
  body.position.set(0, 0.83, 0.03);
  body.quaternion.setFromEuler(new THREE.Euler(0, 0.47, 0));
  const leg = new THREE.Bone();
  leg.name = "UpperLegL";
  leg.position.set(0.1, 0.1, 0);
  const wrist = new THREE.Bone();
  wrist.name = "WristR"; // three.js name of the Blender "Wrist.R"
  g.add(body);
  body.add(leg, wrist);
  return g;
}

describe("findBones", () => {
  it("finds bones by three.js or Blender name and skips missing ones", () => {
    const g = rig();
    const bones = findBones(g, ["Body", "Wrist.R", "UpperLegL", "Nope"]);
    expect(bones.map((b) => b.name)).toEqual(["Body", "WristR", "UpperLegL"]);
  });
});

describe("BoneTransformSnapshot", () => {
  it("restores position, rotation and scale written after the save (stale ragdoll pose)", () => {
    const g = rig();
    const bones = findBones(g, ["Body", "UpperLegL"]);
    const snap = new BoneTransformSnapshot(bones);
    snap.save();
    const before = bones.map((b) => ({ p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() }));
    // What Ragdoll.sync() does: world -> local TRS written on every driven bone.
    for (const b of bones) {
      b.position.set(5, -2, 1);
      b.quaternion.setFromEuler(new THREE.Euler(1, 2, 3));
      b.scale.set(1.01, 0.99, 1);
    }
    snap.restore();
    bones.forEach((b, i) => {
      expect(b.position.distanceTo(before[i].p)).toBe(0);
      expect(b.quaternion.angleTo(before[i].q)).toBeCloseTo(0, 9);
      expect(b.scale.distanceTo(before[i].s)).toBe(0);
    });
  });

  it("is a no-op before the first save", () => {
    const g = rig();
    const [body] = findBones(g, ["Body"]);
    const snap = new BoneTransformSnapshot([body]);
    body.position.set(9, 9, 9);
    snap.restore();
    expect(body.position.x).toBe(9);
  });

  it("reports how many bones it tracks", () => {
    const g = rig();
    expect(new BoneTransformSnapshot(findBones(g, ["Body", "UpperLegL"])).size).toBe(2);
  });
});
