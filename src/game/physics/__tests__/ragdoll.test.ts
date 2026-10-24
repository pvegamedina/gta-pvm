// Exercises the real Rapier (compat build, WASM inlined) in Node: a ragdoll
// built from a synthetic Quaternius-like skeleton must fall, settle on the
// ground and respect its joint limits without exploding.

import { describe, it, expect, beforeAll } from "vitest";
import * as THREE from "three";
import { loadRapier, PhysicsWorld, type Rapier } from "../physicsWorld";
import { Ragdoll, RAGDOLL_BONES, RAGDOLL_WRITTEN_BONES } from "../ragdoll";
import { JOINT_NAMES } from "../muscles";
import { BoneTransformSnapshot, findBones } from "../../characters/boneSnapshot";

/** World rest positions (m) measured from the suit.glb skeleton (feet at y≈0). */
const REST: Record<string, [number, number, number, string]> = {
  Root: [0, 0, 0, ""],
  Body: [0, 0.83, 0.03, "Root"],
  Hips: [0.015, 0.86, 0.056, "Body"],
  Abdomen: [0.008, 0.963, 0.043, "Hips"],
  Torso: [0.005, 1.125, 0.037, "Abdomen"],
  Chest: [0.004, 1.339, 0.066, "Torso"],
  Neck: [0.004, 1.471, 0.085, "Chest"],
  Head: [0.004, 1.547, 0.094, "Neck"],
  ShoulderL: [0.103, 1.365, 0.091, "Chest"],
  UpperArmL: [0.157, 1.402, 0.092, "ShoulderL"],
  LowerArmL: [0.22, 1.243, 0.03, "UpperArmL"],
  WristL: [0.247, 1.01, 0.032, "LowerArmL"],
  ShoulderR: [-0.103, 1.365, 0.091, "Chest"],
  UpperArmR: [-0.148, 1.402, 0.091, "ShoulderR"],
  LowerArmR: [-0.22, 1.241, 0.047, "UpperArmR"],
  WristR: [-0.21, 1.024, 0.137, "LowerArmR"],
  UpperLegL: [0.116, 0.928, -0.012, "Body"],
  LowerLegL: [0.14, 0.508, 0.03, "UpperLegL"],
  FootL: [0.13, 0.06, -0.02, "Root"],
  UpperLegR: [-0.099, 0.928, 0.02, "Body"],
  LowerLegR: [-0.12, 0.51, 0.06, "UpperLegR"],
  FootR: [-0.12, 0.06, 0.04, "Root"],
};

function buildSkeleton(): THREE.Group {
  const group = new THREE.Group();
  const bones = new Map<string, THREE.Bone>();
  for (const [name, [x, y, z, parent]] of Object.entries(REST)) {
    const b = new THREE.Bone();
    b.name = name;
    const p = parent ? REST[parent] : [0, 0, 0];
    b.position.set(x - (p[0] as number), y - (p[1] as number), z - (p[2] as number));
    bones.set(name, b);
    (parent ? bones.get(parent)! : group).add(b);
  }
  return group;
}

let R: Rapier | null = null;
beforeAll(async () => {
  R = await loadRapier();
});

function setup(dropHeight: number) {
  const pw = new PhysicsWorld(R!);
  pw.addStaticBox(0, -0.5, 0, 50, 0.5, 50);
  const visual = buildSkeleton();
  const holder = new THREE.Group();
  holder.position.set(0, dropHeight, 0);
  holder.rotation.y = 0.7;
  holder.add(visual);
  holder.updateMatrixWorld(true);
  const rd = Ragdoll.create(pw, visual, { velocity: { x: 0, y: 0, z: 0 }, slot: pw.allocCorpseSlot() });
  return { pw, visual, rd };
}

describe("Ragdoll (Rapier in Node)", () => {
  it("initializes Rapier's compat build in Node", () => {
    expect(R).not.toBeNull();
  });

  it("declares the eleven simulated parts", () => {
    expect(RAGDOLL_BONES).toHaveLength(11);
  });

  it("returns null for a skeleton missing required bones", () => {
    const pw = new PhysicsWorld(R!);
    const g = new THREE.Group();
    g.add(new THREE.Bone());
    g.updateMatrixWorld(true);
    expect(Ragdoll.create(pw, g, { velocity: { x: 0, y: 0, z: 0 }, slot: 0 })).toBeNull();
  });

  it("falls from 1 m, comes to rest lying on the ground and does not explode", () => {
    const { pw, rd } = setup(1);
    expect(rd).not.toBeNull();
    const ragdoll = rd!;
    for (let i = 0; i < 60 * 6; i++) {
      pw.step();
      ragdoll.sync();
    }
    for (const b of ragdoll.bodies) {
      const t = b.translation();
      expect(Number.isFinite(t.x + t.y + t.z)).toBe(true);
      expect(t.y).toBeLessThan(0.55);
      expect(t.y).toBeGreaterThan(-0.05);
      expect(Math.hypot(t.x, t.z)).toBeLessThan(2.5);
      const v = b.linvel();
      expect(Math.hypot(v.x, v.y, v.z)).toBeLessThan(0.25);
    }
  });

  it("keeps knees and elbows inside their anatomical ranges while collapsing", () => {
    const { pw, rd } = setup(1.2);
    const ragdoll = rd!;
    // A shove in the back so limbs flail.
    ragdoll.applyImpulseAt({ x: 0, y: 4, z: 30 }, { x: 0, y: 2.4, z: 0 });
    let worst = 0;
    for (let i = 0; i < 60 * 3; i++) {
      pw.step();
      for (const h of ragdoll.hingeStates()) {
        const over = Math.max(h.limits[0] - h.angle, h.angle - h.limits[1], 0);
        worst = Math.max(worst, over);
      }
    }
    expect(worst).toBeLessThan(0.2);
  });

  it("copies body poses back onto the bones (bone follows its body, feet follow the shins)", () => {
    const { pw, visual, rd } = setup(1);
    const ragdoll = rd!;
    const footBefore = new THREE.Vector3();
    const shinBefore = new THREE.Vector3();
    visual.getObjectByName("FootL")!.getWorldPosition(footBefore);
    visual.getObjectByName("LowerLegL")!.getWorldPosition(shinBefore);
    const ankleDist = footBefore.distanceTo(shinBefore);
    for (let i = 0; i < 90; i++) pw.step();
    ragdoll.sync();
    visual.updateMatrixWorld(true);
    const thighBone = new THREE.Vector3();
    visual.getObjectByName("UpperLegL")!.getWorldPosition(thighBone);
    const t = ragdoll.bodyOf("UpperLegL")!.translation();
    expect(thighBone.distanceTo(new THREE.Vector3(t.x, t.y, t.z))).toBeLessThan(0.01);
    const foot = new THREE.Vector3();
    const shin = new THREE.Vector3();
    visual.getObjectByName("FootL")!.getWorldPosition(foot);
    visual.getObjectByName("LowerLegL")!.getWorldPosition(shin);
    expect(foot.distanceTo(shin)).toBeCloseTo(ankleDist, 2);
  });

  it("measures the drop to the static ground but ignores ragdoll parts", () => {
    const { pw, rd } = setup(1);
    pw.step(); // scene queries see colliders after the first step
    const com = rd!.bodies[1].worldCom();
    // The ray starts inside the chest: only the ground box (top at y = 0) counts.
    expect(pw.castStaticRay(com, { x: 0, y: -1, z: 0 }, 10)).toBeCloseTo(com.y, 2);
    expect(pw.castStaticRay({ x: 0, y: 5, z: 0 }, { x: 0, y: 1, z: 0 }, 10)).toBeNull();
  });

  it("removes all its bodies on dispose", () => {
    const { pw, rd } = setup(1);
    const before = pw.world.bodies.len();
    rd!.dispose();
    expect(pw.world.bodies.len()).toBe(before - 11);
  });
});

/** Every body's position and velocity is finite. */
function finite(rd: Ragdoll): boolean {
  return rd.bodies.every((b) => {
    const t = b.translation();
    const v = b.linvel();
    return Number.isFinite(t.x + t.y + t.z + v.x + v.y + v.z);
  });
}

/** Standing on the ground (feet at y≈0) instead of dropped from a height. */
function standing() {
  return setup(0.005);
}

/**
 * Standing in a slight crouch (thighs forward `hip` rad, shins back `knee`
 * rad, IK feet moved to the new ankles) so both knees carry the body.
 */
function crouching(hip = 0.3, knee = 0.6) {
  const pw = new PhysicsWorld(R!);
  pw.addStaticBox(0, -0.5, 0, 50, 0.5, 50);
  const visual = buildSkeleton();
  visual.updateMatrixWorld(true);
  const left = new THREE.Vector3(1, 0, 0);
  for (const side of ["L", "R"]) {
    const thigh = visual.getObjectByName("UpperLeg" + side)!;
    const shin = visual.getObjectByName("LowerLeg" + side)!;
    const foot = visual.getObjectByName("Foot" + side)!;
    const ankleLocal = shin.worldToLocal(foot.getWorldPosition(new THREE.Vector3()));
    thigh.rotateOnWorldAxis(left, -hip);
    thigh.updateMatrixWorld(true);
    shin.rotateOnWorldAxis(left, knee);
    shin.updateMatrixWorld(true);
    foot.position.copy(foot.parent!.worldToLocal(shin.localToWorld(ankleLocal)));
    foot.updateMatrixWorld(true);
  }
  const holder = new THREE.Group();
  holder.rotation.y = 0.7;
  holder.add(visual);
  holder.updateMatrixWorld(true);
  const footY = Math.min(...["FootL", "FootR"].map((n) => visual.getObjectByName(n)!.getWorldPosition(new THREE.Vector3()).y));
  holder.position.y = 0.065 - footY;
  holder.updateMatrixWorld(true);
  const rd = Ragdoll.create(pw, visual, { velocity: { x: 0, y: 0, z: 0 }, slot: pw.allocCorpseSlot() })!;
  return { pw, rd };
}

describe("Ragdoll muscles (Rapier in Node)", () => {
  it("holds its pose at full strength (pelvis pinned) while a limp one sags", () => {
    const held = setup(1);
    const limp = setup(1);
    held.rd!.setPinned(true);
    limp.rd!.setPinned(true);
    held.rd!.hold(1);
    let worstHeld = 0;
    let fastest = 0;
    for (let i = 0; i < 180; i++) {
      held.pw.step();
      limp.pw.step();
      worstHeld = Math.max(worstHeld, held.rd!.maxMotorError());
      fastest = Math.max(fastest, held.rd!.maxSpeed());
    }
    expect(finite(held.rd!)).toBe(true);
    expect(worstHeld).toBeLessThan(0.15);
    expect(fastest).toBeLessThan(2);
    // Without muscles the trunk and head fold over the pinned pelvis.
    expect(limp.rd!.jointErrorOf("spine") + limp.rd!.jointErrorOf("neck")).toBeGreaterThan(0.3);
  });

  it("stays bounded at full strength when free (topples like a statue, no explosion)", () => {
    const { pw, rd } = standing();
    rd!.hold(1);
    let fastest = 0;
    for (let i = 0; i < 240; i++) {
      pw.step();
      fastest = Math.max(fastest, rd!.maxSpeed());
      expect(finite(rd!)).toBe(true);
    }
    expect(fastest).toBeLessThan(8);
    for (const b of rd!.bodies) expect(b.translation().y).toBeGreaterThan(-0.1);
  });

  it("fades from partial strength to limp, collapses and falls asleep", () => {
    const { pw, rd } = standing();
    const ragdoll = rd!;
    ragdoll.startDeath({ cause: "generic", seed: 1 });
    const s0 = ragdoll.strength;
    expect(s0).toBeGreaterThan(0.4);
    expect(ragdoll.dying).toBe(true);
    const step = () => {
      ragdoll.stepMuscles(1 / 60);
      pw.step();
    };
    for (let i = 0; i < 60; i++) step();
    expect(ragdoll.strength).toBeLessThan(s0);
    for (let i = 0; i < 90; i++) step();
    // Every group is limp after at most ~2 s (1.8 s / slowest group rate).
    expect(ragdoll.muscleMode).toBe("limp");
    expect(ragdoll.strength).toBe(0);
    for (let i = 0; i < 60 * 10 && !ragdoll.isSleeping(); i++) step();
    expect(finite(ragdoll)).toBe(true);
    expect(ragdoll.isSleeping()).toBe(true);
    // Collapsed: the pelvis and the head are well below their standing heights (0.83 / 1.5 m).
    expect(ragdoll.bodies[0].translation().y).toBeLessThan(0.5);
    expect(ragdoll.bodyOf("Neck")!.translation().y).toBeLessThan(0.8);
  });

  it("snaps the neck loose on a head shot while the rest still holds", () => {
    const { pw, rd } = setup(1);
    const ragdoll = rd!;
    ragdoll.setPinned(true);
    const head = ragdoll.bodyOf("Neck")!.worldCom();
    const struck = ragdoll.applyImpulseAt({ x: 6, y: 0, z: 0 }, head);
    expect(struck).toBe("Neck");
    ragdoll.startDeath({ cause: "shot", struck, seed: 5 });
    expect(ragdoll.jointStrengthOf("neck")).toBe(0);
    expect(ragdoll.jointStrengthOf("spine")).toBeGreaterThan(0.4);
    for (let i = 0; i < 15; i++) {
      ragdoll.stepMuscles(1 / 60);
      pw.step();
    }
    expect(ragdoll.jointErrorOf("neck")).toBeGreaterThan(0.25);
    expect(ragdoll.jointErrorOf("neck")).toBeGreaterThan(2 * ragdoll.jointErrorOf("spine"));
  });

  it("holds a loaded crouch at death-start strength, which a limp body cannot", () => {
    const held = crouching();
    const limp = crouching();
    held.rd.hold(0.65);
    for (let i = 0; i < 40; i++) {
      held.pw.step();
      limp.pw.step();
    }
    expect(held.rd.bodies[0].translation().y).toBeGreaterThan(limp.rd.bodies[0].translation().y + 0.2);
  });

  it("buckles the struck knee first on a leg shot", () => {
    const bend = (struck: string | null) => {
      const { pw, rd } = crouching();
      const k0L = rd.jointAngles("kneeL")!.x;
      const k0R = rd.jointAngles("kneeR")!.x;
      rd.startDeath({ cause: "shot", struck, seed: 2 });
      if (struck) {
        expect(rd.jointStrengthOf("kneeL")).toBe(0);
        expect(rd.jointStrengthOf("kneeR")).toBeGreaterThan(0.4);
      }
      for (let i = 0; i < 15; i++) {
        rd.stepMuscles(1 / 60);
        pw.step();
      }
      return { L: rd.jointAngles("kneeL")!.x - k0L, R: rd.jointAngles("kneeR")!.x - k0R };
    };
    const shot = bend("LowerLegL");
    const intact = bend(null);
    expect(shot.L).toBeGreaterThan(shot.R + 0.03);
    expect(shot.L).toBeGreaterThan(intact.L + 0.05);
  });

  it("buckles a struck, nearly straight knee instead of locking it (buckle kick)", () => {
    const { pw, rd } = standing();
    const ragdoll = rd!;
    const k0L = ragdoll.jointAngles("kneeL")!.x;
    const k0R = ragdoll.jointAngles("kneeR")!.x;
    const fwd = { x: Math.sin(0.7), y: 0, z: Math.cos(0.7) };
    const struck = ragdoll.applyImpulseAt({ x: -fwd.x * 34, y: 6, z: -fwd.z * 34 }, ragdoll.bodyOf("LowerLegL")!.worldCom());
    expect(struck).toBe("LowerLegL");
    ragdoll.startDeath({ cause: "shot", struck, seed: 14 });
    for (let i = 0; i < 15; i++) {
      ragdoll.stepMuscles(1 / 60);
      pw.step();
    }
    const bentL = ragdoll.jointAngles("kneeL")!.x - k0L;
    const bentR = ragdoll.jointAngles("kneeR")!.x - k0R;
    expect(bentL).toBeGreaterThan(0.4);
    expect(bentL).toBeGreaterThan(bentR + 0.3);
  });

  it("keeps every joint inside its limits through a car-ram curl and tumble", () => {
    const { pw, rd } = standing();
    const ragdoll = rd!;
    ragdoll.addVelocity({ x: 9, y: 1.5, z: 3 });
    ragdoll.startDeath({ cause: "ram", seed: 3 });
    let worst = 0;
    let targetOutside = 0;
    for (let i = 0; i < 120; i++) {
      ragdoll.stepMuscles(1 / 60);
      pw.step();
      for (const name of JOINT_NAMES) {
        const a = ragdoll.jointAngles(name)!;
        const t = ragdoll.jointTargetOf(name)!;
        const lim = ragdoll.jointLimits(name);
        const vals = [a.x, a.y, a.z];
        const tv = [t.x, t.y, t.z];
        lim.forEach(([lo, hi], k) => {
          worst = Math.max(worst, lo - vals[k], vals[k] - hi);
          targetOutside = Math.max(targetOutside, lo - tv[k], tv[k] - hi);
        });
      }
    }
    expect(finite(ragdoll)).toBe(true);
    // Motor targets never leave the limits; the bodies only overshoot them
    // transiently on impacts (a passive ragdoll does too: ~0.35 rad here).
    expect(targetOutside).toBeLessThanOrEqual(0);
    expect(worst).toBeLessThan(0.4);
  });

  it("goes back to the passive setup when limp", () => {
    const { rd } = setup(1);
    rd!.hold(0.8);
    expect(rd!.muscleMode).toBe("hold");
    expect(rd!.strength).toBeCloseTo(0.8, 6);
    rd!.goLimp();
    expect(rd!.muscleMode).toBe("limp");
    expect(rd!.strength).toBe(0);
    expect(rd!.maxMotorError()).toBe(0);
  });

  it("lets the bind snapshot undo everything sync() wrote (stale-pose fix)", () => {
    const { pw, visual, rd } = setup(1);
    const snap = new BoneTransformSnapshot(findBones(visual, RAGDOLL_WRITTEN_BONES));
    expect(snap.size).toBe(RAGDOLL_WRITTEN_BONES.length);
    const bones = findBones(visual, RAGDOLL_WRITTEN_BONES);
    const bind = bones.map((b) => b.position.clone());
    snap.save();
    for (let i = 0; i < 60; i++) pw.step();
    rd!.sync();
    expect(bones.some((b, i) => b.position.distanceTo(bind[i]) > 0.01)).toBe(true);
    snap.restore();
    bones.forEach((b, i) => expect(b.position.distanceTo(bind[i])).toBe(0));
  });
});
