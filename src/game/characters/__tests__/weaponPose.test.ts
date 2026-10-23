import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { prepareWeaponTemplate, WEAPON_POSES, MUZZLE_NAME } from "../weaponPose";

/** Stand-in for a weapon GLB: a box along X (barrel at +X) with a tiny marker at the grip point. */
function fakeWeaponScene(length: number, grip: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(length, 0.2, 0.1));
  body.position.x = length / 2 - 0.1;
  g.add(body);
  const marker = new THREE.Object3D();
  marker.name = "gripMarker";
  marker.position.copy(grip);
  g.add(marker);
  return g;
}

function axisInSocket(obj: THREE.Object3D, axis: THREE.Vector3): THREE.Vector3 {
  obj.updateMatrixWorld(true);
  return axis.clone().applyQuaternion(obj.getWorldQuaternion(new THREE.Quaternion())).normalize();
}

// The Quaternius "Wrist.R" bone points its +Y along the fingers (forward when
// the character aims with Idle_Gun_Pointing) and its -X up. The GLB weapons
// are modelled barrel-along-+X / sights-up-+Y.
const BARREL_IN_SOCKET = new THREE.Vector3(0, 1, 0);
const TOP_IN_SOCKET = new THREE.Vector3(-1, 0, 0);

describe.each(["pistol", "m4"] as const)("%s template for the Wrist.R socket", (weapon) => {
  const pose = WEAPON_POSES[weapon];
  const grip = new THREE.Vector3(...pose.grip);
  const make = () => {
    const socket = new THREE.Group();
    const tpl = prepareWeaponTemplate(fakeWeaponScene(pose.modelLength, grip), weapon);
    socket.add(tpl);
    return { socket, tpl };
  };

  it("points the barrel along the fingers and the sights away from the palm", () => {
    const { tpl } = make();
    const barrel = axisInSocket(tpl, new THREE.Vector3(1, 0, 0));
    const top = axisInSocket(tpl, new THREE.Vector3(0, 1, 0));
    expect(barrel.dot(BARREL_IN_SOCKET)).toBeGreaterThan(0.9);
    expect(top.dot(TOP_IN_SOCKET)).toBeGreaterThan(0.9);
  });

  it("scales the model to a believable in-hand length", () => {
    const { tpl } = make();
    tpl.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(tpl).getSize(new THREE.Vector3());
    const length = Math.max(size.x, size.y, size.z);
    expect(length).toBeCloseTo(pose.length, 2);
  });

  it("puts the grip point at the hand offset", () => {
    const { tpl } = make();
    tpl.updateMatrixWorld(true);
    const marker = tpl.getObjectByName("gripMarker")!;
    const p = marker.getWorldPosition(new THREE.Vector3());
    expect(p.distanceTo(new THREE.Vector3(...pose.handOffset))).toBeLessThan(1e-4);
  });
});

describe("muzzle marker", () => {
  it("sits at the barrel tip, ahead of the hand along the aim direction", () => {
    const pose = WEAPON_POSES.m4;
    const socket = new THREE.Group();
    const tpl = prepareWeaponTemplate(fakeWeaponScene(pose.modelLength, new THREE.Vector3(...pose.grip)), "m4");
    socket.add(tpl);
    socket.updateMatrixWorld(true);
    const muzzle = tpl.getObjectByName(MUZZLE_NAME)!;
    const p = muzzle.getWorldPosition(new THREE.Vector3());
    const hand = new THREE.Vector3(...pose.handOffset);
    // Barrel runs along socket +Y; the tip is most of the gun's length ahead.
    expect(p.y - hand.y).toBeGreaterThan(pose.length * 0.4);
    expect(p.y - hand.y).toBeLessThan(pose.length * 1.1);
  });
});
