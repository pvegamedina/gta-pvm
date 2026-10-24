// Exercises the real Rapier (compat build, WASM inlined) in Node: a ragdoll
// built from a synthetic Quaternius-like skeleton must fall, settle on the
// ground and respect its joint limits without exploding.

import { describe, it, expect, beforeAll } from "vitest";
import * as THREE from "three";
import { loadRapier, PhysicsWorld, type Rapier } from "../physicsWorld";
import { Ragdoll, RAGDOLL_BONES } from "../ragdoll";

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

  it("removes all its bodies on dispose", () => {
    const { pw, rd } = setup(1);
    const before = pw.world.bodies.len();
    rd!.dispose();
    expect(pw.world.bodies.len()).toBe(before - 11);
  });
});
