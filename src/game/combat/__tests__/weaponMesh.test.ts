import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";

// The procedural canvas textures need `document`; plain materials are enough
// to check the rig's transform hierarchy in Node.
vi.mock("../weaponTextures", () => ({
  gunmetal: () => new THREE.MeshBasicMaterial(),
  accentMat: () => new THREE.MeshBasicMaterial(),
}));
vi.mock("../../player/humanTextures", () => ({
  fabricMat: () => new THREE.MeshBasicMaterial(),
}));

import { makeHuman } from "../../player/human";
import { setHeldWeapon, applyAimPose, buildProceduralWeapon } from "../weaponMesh";

const COLORS = { skin: 0xe0ac84, shirt: 0xd9442b, pants: 0x2b3a55, hair: 0x2a1c14, shoe: 0xf0f0f0 };

function aimingRig(weapon: "pistol" | "m4") {
  const rig = makeHuman(COLORS);
  const handle = setHeldWeapon(rig.rHand, null, weapon, buildProceduralWeapon)!;
  applyAimPose(rig, true, true);
  rig.group.updateMatrixWorld(true);
  return { rig, handle };
}

/** World-space direction of one of `obj`'s local axes. */
function worldAxis(obj: THREE.Object3D, axis: THREE.Vector3): THREE.Vector3 {
  const q = obj.getWorldQuaternion(new THREE.Quaternion());
  return axis.clone().applyQuaternion(q).normalize();
}

// Procedural fallback rig (used when the GLB characters fail to load).
// Regression: weapons used to be attached to the arm mesh with a Y rotation,
// so the barrel pointed sideways and the gun floated at mid-forearm instead
// of sitting in the hand. The rig faces +Z (see player/foot.ts).
describe.each(["pistol", "m4"] as const)("held %s while aiming", (weapon) => {
  it("points the barrel forward", () => {
    const { handle } = aimingRig(weapon);
    const barrel = worldAxis(handle.group, new THREE.Vector3(0, 0, 1));
    expect(barrel.dot(new THREE.Vector3(0, 0, 1))).toBeGreaterThan(0.95);
  });

  it("keeps the sights on top", () => {
    const { handle } = aimingRig(weapon);
    const top = worldAxis(handle.group, new THREE.Vector3(0, 1, 0));
    expect(top.y).toBeGreaterThan(0.95);
  });

  it("sits in the right hand", () => {
    const { rig, handle } = aimingRig(weapon);
    const hand = rig.rHand.getWorldPosition(new THREE.Vector3());
    const gun = handle.group.getWorldPosition(new THREE.Vector3());
    expect(gun.distanceTo(hand)).toBeLessThan(0.15);
  });
});

describe("setHeldWeapon", () => {
  it("replaces the previous weapon and clears it for fists", () => {
    const rig = makeHuman(COLORS);
    const pistol = setHeldWeapon(rig.rHand, null, "pistol", buildProceduralWeapon);
    const m4 = setHeldWeapon(rig.rHand, pistol, "m4", buildProceduralWeapon);
    expect(pistol!.group.parent).toBeNull();
    expect(m4!.group.parent).toBe(rig.rHand);

    expect(setHeldWeapon(rig.rHand, m4, "fists", buildProceduralWeapon)).toBeNull();
    expect(m4!.group.parent).toBeNull();
  });
});

describe("setHeldWeapon with a custom builder (GLB model rigs)", () => {
  it("attaches whatever the builder returns to the given socket and swaps it out", () => {
    const socket = new THREE.Group();
    const build = (w: "pistol" | "m4") => Object.assign(new THREE.Group(), { name: w });
    const pistol = setHeldWeapon(socket, null, "pistol", build)!;
    expect(pistol.group.parent).toBe(socket);
    expect(pistol.group.name).toBe("pistol");
    const m4 = setHeldWeapon(socket, pistol, "m4", build)!;
    expect(socket.children).toEqual([m4.group]);
    expect(setHeldWeapon(socket, m4, "fists", build)).toBeNull();
    expect(socket.children).toHaveLength(0);
  });
});
