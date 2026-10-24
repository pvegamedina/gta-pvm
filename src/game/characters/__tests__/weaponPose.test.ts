import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { prepareWeaponTemplate, WEAPON_POSES, MUZZLE_NAME, liftColor } from "../weaponPose";

/**
 * Stand-in for a weapon GLB: a box along X (barrel at +X) whose bounding box
 * is deliberately off-origin and at an arbitrary scale (like obj2gltf output),
 * with a marker at the pose's grip point (given as bbox fractions).
 */
function fakeWeaponScene(size: [number, number, number], offset: [number, number, number], gripFrac: readonly [number, number, number]): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(...size));
  body.position.set(offset[0], offset[1], offset[2]);
  g.add(body);
  const marker = new THREE.Object3D();
  marker.name = "gripMarker";
  marker.position.set(
    offset[0] - size[0] / 2 + gripFrac[0] * size[0],
    offset[1] - size[1] / 2 + gripFrac[1] * size[1],
    offset[2] - size[2] / 2 + gripFrac[2] * size[2],
  );
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

/** Raw sizes of the Ultimate Gun Pack exports (model units) and an arbitrary pivot offset. */
const RAW: Record<"pistol" | "m4", { size: [number, number, number]; offset: [number, number, number] }> = {
  pistol: { size: [1.82, 1.2, 0.27], offset: [0.54, 0.12, 0] },
  m4: { size: [5.17, 1.79, 0.35], offset: [1.03, 0.18, 0.002] },
};

describe.each(["pistol", "m4"] as const)("%s template for the Wrist.R socket", (weapon) => {
  const pose = WEAPON_POSES[weapon];
  const make = () => {
    const socket = new THREE.Group();
    const tpl = prepareWeaponTemplate(fakeWeaponScene(RAW[weapon].size, RAW[weapon].offset, pose.gripFrac), weapon);
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

  it("scales the model to a believable in-hand length, whatever its raw units", () => {
    const { tpl } = make();
    tpl.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(tpl).getSize(new THREE.Vector3());
    const length = Math.max(size.x, size.y, size.z);
    expect(length).toBeCloseTo(pose.length, 2);
  });

  it("puts the grip point (bbox fraction) at the hand offset, independent of the model's pivot", () => {
    const { tpl } = make();
    tpl.updateMatrixWorld(true);
    const marker = tpl.getObjectByName("gripMarker")!;
    const p = marker.getWorldPosition(new THREE.Vector3());
    expect(p.distanceTo(new THREE.Vector3(...pose.handOffset))).toBeLessThan(1e-4);
  });

  it("puts the muzzle marker on the front face at the barrel height", () => {
    const { tpl } = make();
    tpl.updateMatrixWorld(true);
    const muzzle = tpl.getObjectByName(MUZZLE_NAME)!.getWorldPosition(new THREE.Vector3());
    const grip = tpl.getObjectByName("gripMarker")!.getWorldPosition(new THREE.Vector3());
    const { size } = RAW[weapon];
    const scale = pose.length / size[0];
    // Along the barrel (socket +Y): from the grip to the front face.
    expect(muzzle.y - grip.y).toBeCloseTo((1 - pose.gripFrac[0]) * size[0] * scale, 4);
    // Height (socket -X is up): barrel height above the grip point.
    expect(grip.x - muzzle.x).toBeCloseTo((pose.muzzleFracY - pose.gripFrac[1]) * size[1] * scale, 4);
  });
});

describe("weapon config is data-driven", () => {
  it("names the GLB file of each gun so models can be swapped by config", () => {
    expect(WEAPON_POSES.pistol.file).toBe("pistol");
    expect(WEAPON_POSES.m4.file).toBe("rifle");
  });
});

describe("liftColor", () => {
  it("raises near-black display colours to a readable floor, keeping the hue", () => {
    const c = liftColor(new THREE.Color(0.02, 0.025, 0.03), 0.16);
    expect(Math.max(c.r, c.g, c.b)).toBeGreaterThanOrEqual(0.159);
    expect(c.b).toBeGreaterThan(c.r); // still bluish
  });

  it("leaves colours above the floor untouched", () => {
    const c = liftColor(new THREE.Color(0.5, 0.4, 0.3), 0.16);
    expect([c.r, c.g, c.b]).toEqual([0.5, 0.4, 0.3]);
  });
});
