import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { GunHandling, findUpperBodyBones, type GunHandlingInput } from "../gunHandling";
import type { WeaponId } from "@shared/protocol";
import { prepareWeaponTemplate, SUPPORT_NAME, WEAPON_POSES, type GunId } from "../weaponPose";

/** Minimal skeleton with the Quaternius bone names, proportions and rest rotations (from swat.glb). */
function makeCharacter(yaw: number) {
  const root = new THREE.Group();
  root.position.set(10, 0, -4);
  root.rotation.y = yaw;
  const mk = (name: string, parent: THREE.Object3D, t: [number, number, number], q: [number, number, number, number]) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(...t);
    b.quaternion.set(...q).normalize();
    parent.add(b);
    return b;
  };
  const body = mk("Body", root, [0, 0.829, -0.046], [0, 0.236, 0, 0.972]);
  const hips = mk("Hips", body, [-0.001, 0.029, 0.033], [-0.069, 0, 0, 0.998]);
  const abdomen = mk("Abdomen", hips, [0, 0.106, 0], [0.048, 0, 0, 0.999]);
  const torso = mk("Torso", abdomen, [0, 0.162, 0], [0.085, -0.237, 0.012, 0.968]);
  const chest = mk("Chest", torso, [0, 0.216, 0], [0.004, 0, 0, 1]);
  const shL = mk("ShoulderL", chest, [0.099, 0.029, 0.021], [-0.456, -0.84, -0.107, 0.273]);
  const uaL = mk("UpperArmL", shL, [0, 0.066, 0], [-0.675, 0.404, 0.388, 0.481]);
  const laL = mk("LowerArmL", uaL, [0, 0.182, 0], [-0.121, -0.03, -0.184, 0.975]);
  mk("WristL", laL, [0, 0.235, 0], [0.011, 0.018, 0.01, 1]);
  const shR = mk("ShoulderR", chest, [-0.098, 0.029, 0.021], [-0.456, 0.84, 0.107, 0.273]);
  const uaR = mk("UpperArmR", shR, [0, 0.066, 0], [-0.627, -0.308, -0.439, 0.565]);
  const laR = mk("LowerArmR", uaR, [0, 0.182, 0], [-0.206, -0.194, 0.324, 0.903]);
  const wrR = mk("WristR", laR, [0, 0.235, 0], [0.011, -0.021, -0.039, 0.999]);
  root.updateMatrixWorld(true);
  return { root, wrR };
}

function arm(weapon: GunId, yaw = 0.8) {
  const { root, wrR } = makeCharacter(yaw);
  const box = new THREE.Mesh(new THREE.BoxGeometry(weapon === "m4" ? 5.17 : 1.82, 1.2, 0.3));
  const holder = prepareWeaponTemplate(box, weapon);
  wrR.add(holder);
  root.updateMatrixWorld(true);
  const bones = findUpperBodyBones(root)!;
  return { root, holder, bones, handling: new GunHandling(bones) };
}

const input = (weapon: WeaponId, over: Partial<GunHandlingInput> = {}): GunHandlingInput => ({
  weapon,
  armedWeight: 1,
  aimWeight: 1,
  aimPitch: 0,
  lean: 0,
  kick: 0,
  ...over,
});

const barrelOf = (holder: THREE.Object3D) => new THREE.Vector3(1, 0, 0).applyQuaternion(holder.getWorldQuaternion(new THREE.Quaternion()));
const aimDir = (yaw: number, pitch: number) => new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));

describe("GunHandling", () => {
  it("finds the Quaternius bones", () => {
    const { bones } = arm("m4");
    expect(bones.right.wrist.name).toBe("WristR");
    expect(bones.left.upper.name).toBe("UpperArmL");
  });

  it.each([0, 0.35, -0.4])("levels the barrel along the aim (pitch %s) when fully aiming", (pitch) => {
    for (const weapon of ["m4", "pistol"] as const) {
      const { root, holder, handling } = arm(weapon);
      expect(handling.apply(root, holder, input(weapon, { aimPitch: pitch }))).toBeCloseTo(1, 9);
      expect(barrelOf(holder).angleTo(aimDir(0.8, pitch))).toBeLessThan(1e-3);
    }
  });

  it("shoulders the rifle: grip in front of the right shoulder, sights up", () => {
    const { root, holder, handling, bones } = arm("m4");
    handling.apply(root, holder, input("m4"));
    const grip = holder.getWorldPosition(new THREE.Vector3());
    const shoulder = bones.right.upper.getWorldPosition(new THREE.Vector3());
    const local = root.worldToLocal(grip.clone()).sub(root.worldToLocal(shoulder.clone()));
    expect(local.z).toBeGreaterThan(0.2); // forward
    expect(Math.abs(local.y)).toBeLessThan(0.12); // shoulder height
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(holder.getWorldQuaternion(new THREE.Quaternion()));
    expect(up.y).toBeGreaterThan(0.95);
  });

  it("puts the left palm on the support marker", () => {
    for (const weapon of ["m4", "pistol"] as const) {
      const { root, holder, handling, bones } = arm(weapon);
      handling.apply(root, holder, input(weapon));
      const support = holder.getObjectByName(SUPPORT_NAME)!.getWorldPosition(new THREE.Vector3());
      const palm = new THREE.Vector3(...WEAPON_POSES[weapon].support.palm).applyMatrix4(bones.left.wrist.matrixWorld);
      expect(palm.distanceTo(support)).toBeLessThan(0.01);
    }
  });

  it("carries the rifle low with both hands when not aiming", () => {
    const { root, holder, handling } = arm("m4", 0);
    handling.apply(root, holder, input("m4", { aimWeight: 0 }));
    expect(barrelOf(holder).y).toBeLessThan(-0.3);
  });

  it("leaves the animated pose alone at zero weight (pistol not aiming, or unarmed)", () => {
    const { root, holder, handling, bones } = arm("pistol");
    const before = [bones.right.upper, bones.right.wrist, bones.left.lower].map((b) => b.quaternion.clone());
    expect(handling.apply(root, holder, input("pistol", { aimWeight: 0 }))).toBe(0);
    expect(handling.apply(root, null, input("fists"))).toBe(0);
    [bones.right.upper, bones.right.wrist, bones.left.lower].forEach((b, i) => expect(b.quaternion.angleTo(before[i])).toBe(0));
  });

  it("blends partially for in-between weights (no snapping)", () => {
    const full = arm("m4");
    full.handling.apply(full.root, full.holder, input("m4", { aimWeight: 1 }));
    const half = arm("m4");
    half.handling.apply(half.root, half.holder, input("m4", { armedWeight: 0.5, aimWeight: 0.5 }));
    const rest = arm("m4");
    const a = (o: { bones: ReturnType<typeof findUpperBodyBones> }) => o.bones!.right.upper.quaternion;
    const total = a(rest).angleTo(a(full));
    const partial = a(rest).angleTo(a(half));
    expect(partial).toBeGreaterThan(0.2 * total);
    expect(partial).toBeLessThan(0.8 * total);
  });

  it("does not accumulate across frames on un-animated bones (bind pose restored each frame)", () => {
    const { root, holder, handling, bones } = arm("m4");
    const frame = () => {
      handling.restoreBindPose();
      handling.apply(root, holder, input("m4", { lean: 0.1 }));
      return bones.torso.quaternion.clone();
    };
    const first = frame();
    for (let i = 0; i < 30; i++) frame();
    expect(frame().angleTo(first)).toBeLessThan(1e-9);
  });

  it("kicks the muzzle up on a shot", () => {
    const { root, holder, handling } = arm("pistol", 0);
    handling.apply(root, holder, input("pistol", { kick: 1 }));
    expect(barrelOf(holder).y).toBeGreaterThan(Math.sin(WEAPON_POSES.pistol.kick.pitch) * 0.9);
  });
});
