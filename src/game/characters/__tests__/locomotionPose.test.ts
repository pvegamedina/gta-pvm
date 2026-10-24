import { describe, it, expect, afterEach } from "vitest";
import * as THREE from "three";
import { LocomotionPose, findLocomotionBones, type LocomotionInput } from "../locomotionPose";
import { resetGround, setGroundSampler, setSurfaceLift } from "../../world/ground";

afterEach(() => resetGround());

/** Minimal Quaternius-like rig: Root > Body > Hips > Abdomen > Torso > Chest > Neck > Head,
 * Body > UpperLeg > LowerLeg, Root > Foot (IK bones), standing with feet ~2 cm above the floor. */
function makeRig() {
  const group = new THREE.Group();
  const visual = new THREE.Group();
  group.add(visual);
  const mk = (name: string, parent: THREE.Object3D, t: [number, number, number]) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(...t);
    parent.add(b);
    return b;
  };
  const root = mk("Root", visual, [0, 0, 0.07]);
  const body = mk("Body", root, [0, 0.95, 0]);
  const hips = mk("Hips", body, [0, 0.03, 0]);
  const abdomen = mk("Abdomen", hips, [0, 0.1, 0]);
  const torso = mk("Torso", abdomen, [0, 0.16, 0]);
  const chest = mk("Chest", torso, [0, 0.21, 0]);
  const neck = mk("Neck", chest, [0, 0.2, 0]);
  mk("Head", neck, [0, 0.1, 0]);
  for (const [side, x] of [["L", 0.11], ["R", -0.11]] as const) {
    const upper = mk(`UpperLeg${side}`, body, [x, -0.02, 0]);
    upper.rotation.x = Math.PI; // bones run along +Y: point the leg down
    const lower = mk(`LowerLeg${side}`, upper, [0, 0.433, 0]);
    lower.rotation.x = 0.02;
    group.updateMatrixWorld(true);
    const tip = lower.localToWorld(new THREE.Vector3(0, 0.49, 0));
    const foot = mk(`Foot${side}`, root, [0, 0, 0]);
    foot.position.copy(root.worldToLocal(tip));
  }
  group.updateMatrixWorld(true);
  const bones = findLocomotionBones(visual)!;
  return { group, visual, bones, root, body, chest };
}

const still: LocomotionInput = { speed: 0, ground: true, alive: true };
const wp = (o: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);

/** Captures the rig's local transforms (the "animated pose") and restores them, like the mixer each frame. */
function poseKeeper(root: THREE.Object3D) {
  const saved: [THREE.Object3D, THREE.Vector3, THREE.Quaternion][] = [];
  root.traverse((o) => saved.push([o, o.position.clone(), o.quaternion.clone()]));
  return () => saved.forEach(([o, p, q]) => (o.position.copy(p), o.quaternion.copy(q)));
}

function frames(n: number, rig: ReturnType<typeof makeRig>, loco: LocomotionPose, input: LocomotionInput, restore: () => void, strafeChestYaw = 0) {
  for (let i = 0; i < n; i++) {
    restore();
    loco.prepare(1 / 60, rig.group, input, 0);
    loco.applyBody(rig.group, 1, strafeChestYaw);
  }
  rig.group.updateMatrixWorld(true);
}

describe("findLocomotionBones", () => {
  it("finds the pelvis, spine and both legs", () => {
    const { bones } = makeRig();
    expect(bones.legs[0].foot.name).toBe("FootL");
    expect(bones.head?.name).toBe("Head");
  });
});

describe("LocomotionPose foot IK", () => {
  it("leaves a standing rig on flat ground essentially untouched", () => {
    const rig = makeRig();
    const loco = new LocomotionPose(rig.bones);
    const restore = poseKeeper(rig.visual);
    const feet0 = rig.bones.legs.map((l) => wp(l.foot));
    frames(30, rig, loco, still, restore);
    rig.bones.legs.forEach((l, i) => expect(wp(l.foot).distanceTo(feet0[i])).toBeLessThan(0.01));
  });

  it("plants both feet on a slope and lowers the pelvis for the downhill foot", () => {
    // Ground rising towards +X (the rig's left): left foot higher, right foot lower.
    setGroundSampler((x) => x * 0.3);
    const rig = makeRig();
    const loco = new LocomotionPose(rig.bones);
    const restore = poseKeeper(rig.visual);
    const body0 = wp(rig.body).y;
    const h0 = wp(rig.bones.legs[0].foot).y;
    frames(60, rig, loco, still, restore);
    for (const leg of rig.bones.legs) {
      const f = wp(leg.foot);
      expect(Math.abs(f.y - (f.x * 0.3 + h0))).toBeLessThan(0.004);
      // The shin still ends on the foot (no detached feet).
      expect(wp(leg.lower).distanceTo(f)).toBeCloseTo(0.49, 2);
    }
    expect(wp(rig.body).y).toBeLessThan(body0 - 0.02);
  });

  it("stands on the drawn surface lift (feet on the kerb, not sunk into it)", () => {
    setSurfaceLift((x) => (x > 0 ? 0.16 : 0.06));
    const rig = makeRig();
    const loco = new LocomotionPose(rig.bones);
    const restore = poseKeeper(rig.visual);
    const foot0 = rig.bones.legs.map((l) => wp(l.foot).y);
    frames(60, rig, loco, still, restore);
    expect(wp(rig.bones.legs[0].foot).y - foot0[0]).toBeCloseTo(0.16, 2); // left foot (x > 0) on the kerb
    expect(wp(rig.bones.legs[1].foot).y - foot0[1]).toBeCloseTo(0.06, 2); // right foot on the asphalt
  });

  it("switches foot IK off far from the camera", () => {
    setSurfaceLift(() => 0.16);
    const rig = makeRig();
    const loco = new LocomotionPose(rig.bones);
    const restore = poseKeeper(rig.visual);
    const foot0 = wp(rig.bones.legs[0].foot).y;
    frames(30, rig, loco, { ...still, cameraDistance: 80 }, restore);
    expect(loco.ikWeight).toBeLessThan(1e-3);
    expect(wp(rig.bones.legs[0].foot).y).toBeCloseTo(foot0, 6);
  });
});

describe("LocomotionPose turn in place", () => {
  it("keeps the feet and twists the chest towards a moderately turned facing", () => {
    const rig = makeRig();
    const loco = new LocomotionPose(rig.bones);
    const restore = poseKeeper(rig.visual);
    frames(5, rig, loco, still, restore);
    rig.group.rotation.y = 0.5;
    frames(5, rig, loco, still, restore);
    // Lower body stayed at yaw 0: the Root counter-rotated by the twist.
    const rootFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(rig.root.getWorldQuaternion(new THREE.Quaternion()));
    expect(Math.atan2(rootFwd.x, rootFwd.z)).toBeCloseTo(0, 2);
    // Chest faces the new facing.
    const chestFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(rig.chest.getWorldQuaternion(new THREE.Quaternion()));
    expect(Math.atan2(chestFwd.x, chestFwd.z)).toBeCloseTo(0.5, 2);
  });

  it("undoes the strafe clips' chest yaw so the chest faces the aim", () => {
    const rig = makeRig();
    const loco = new LocomotionPose(rig.bones);
    const restore = poseKeeper(rig.visual);
    // Pretend the clip turned the chest 0.59 rad left: pre-rotate it in the "animated" pose.
    rig.chest.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), 0.59);
    const restore2 = poseKeeper(rig.visual);
    void restore;
    frames(3, rig, loco, still, restore2, 0.59);
    const chestFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(rig.chest.getWorldQuaternion(new THREE.Quaternion()));
    expect(Math.atan2(chestFwd.x, chestFwd.z)).toBeCloseTo(0, 2);
  });
});

describe("LocomotionPose head stabilisation", () => {
  it("turns a tilted head most of the way back to level", () => {
    const rig = makeRig();
    const loco = new LocomotionPose(rig.bones);
    const restore = poseKeeper(rig.visual);
    frames(2, rig, loco, still, restore);
    const head = rig.bones.head!;
    head.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), 0.3); // rolled
    head.rotateOnWorldAxis(new THREE.Vector3(1, 0, 0), 0.2); // pitched
    rig.group.updateMatrixWorld(true);
    const before = head.getWorldQuaternion(new THREE.Quaternion()).angleTo(new THREE.Quaternion());
    loco.finish(rig.group, 0, 0, 1);
    const after = head.getWorldQuaternion(new THREE.Quaternion()).angleTo(new THREE.Quaternion());
    expect(after).toBeLessThan(before * 0.5);
    expect(after).toBeGreaterThan(before * 0.25);
  });
});
