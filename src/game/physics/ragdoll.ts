// Physical ragdoll built from a Quaternius character skeleton at the moment
// of death. Eleven Rapier rigid bodies (pelvis, chest, head, upper/lower arms,
// upper/lower legs) are created from the CURRENT animated bone world
// transforms, sized from the bone lengths and connected with impulse joints:
//
// - knees / elbows: revolute hinges with a one-directional range (no
//   hyperextension), hinge axis taken from the limb's actual bend plane;
// - hips / shoulders / neck / spine: spherical joints with per-axis angular
//   limits (twist on X, flexion on Y, sideways on Z of an anatomical joint
//   frame). Rapier's JS API only wraps limits for unit joints, so the limits
//   are set through the raw joint set (`jointSetLimits`), which Rapier supports
//   for every joint type (they are generic joints underneath).
//
// Joint frames are anatomical (zero = straight limb hanging along the parent),
// not the death pose, so a body that died mid-stride still can't bend a knee
// forwards; limits are widened just enough to contain the starting pose so
// nothing snaps on the first step. Each frame sync() copies body transforms
// back onto the driven bones (world -> bone-local, keeping each bone's offset
// to its body from the death pose); un-simulated children (hands, fingers,
// Hips under Body, Torso/Chest under Abdomen) follow their parents, and the
// IK feet (children of Root in this rig) are re-attached to the shins.

import * as THREE from "three";
import type { Rapier } from "./physicsWorld";
import { corpseGroups, type PhysicsWorld } from "./physicsWorld";
import { basisFromXY, frameAngles, hingeFrame, perpComponent, segmentCapsule, twistFrame, widenLimits, worldToLocal } from "./ragdollMath";
import { nearestIndex, type Vec3 } from "./deathImpulse";

type RigidBody = InstanceType<Rapier["RigidBody"]>;

/** Driven bones, parents before children (sync order matters). */
export const RAGDOLL_BONES = [
  "Body",
  "Abdomen",
  "Neck",
  "UpperArmL",
  "LowerArmL",
  "UpperArmR",
  "LowerArmR",
  "UpperLegL",
  "LowerLegL",
  "UpperLegR",
  "LowerLegR",
] as const;
type DrivenBone = (typeof RAGDOLL_BONES)[number];

/** Bones read for geometry but not simulated themselves. */
const LANDMARKS = ["Head", "WristL", "WristR", "FootL", "FootR"] as const;

// ---- Tunables ----
/** Part masses (kg), ~75 kg total; hands/feet are folded into forearms/shins. */
const MASS: Record<DrivenBone, number> = {
  Body: 11,
  Abdomen: 22,
  Neck: 5,
  UpperArmL: 2.4,
  LowerArmL: 1.7,
  UpperArmR: 2.4,
  LowerArmR: 1.7,
  UpperLegL: 9,
  LowerLegL: 5,
  UpperLegR: 9,
  LowerLegR: 5,
};
const LINEAR_DAMPING = 0.2;
const ANGULAR_DAMPING = 1.4;
const FRICTION = 0.95;
const RESTITUTION = 0.05;
/** Joint "friction": zero-velocity motors so limbs settle instead of swinging. */
const JOINT_DAMPING = 0.6;
/** Margin (rad) added when widening limits to contain the starting pose. */
const LIMIT_MARGIN = 0.05;

/** Joint ranges (rad). Spherical: [twist X, flexion Y, sideways Z]; + flexion
 * bends the limb towards the parent's front; + sideways moves towards the
 * character's right (so left/right limbs mirror). Hinges: + = flexion. */
const LIMITS = {
  spine: [[-0.5, 0.5], [-0.35, 0.75], [-0.4, 0.4]],
  neck: [[-0.8, 0.8], [-0.5, 0.8], [-0.45, 0.45]],
  shoulderL: [[-0.9, 0.9], [-0.7, 2.4], [-2.0, 0.45]],
  shoulderR: [[-0.9, 0.9], [-0.7, 2.4], [-0.45, 2.0]],
  hipL: [[-0.5, 0.5], [-0.45, 1.9], [-0.8, 0.25]],
  hipR: [[-0.5, 0.5], [-0.45, 1.9], [-0.25, 0.8]],
  elbow: [0, 2.5],
  knee: [0, 2.4],
} as const;

/** Rapier's raw joint-axis indices (RawJointAxis.AngX..AngZ). */
const ANG_AXES = [3, 4, 5] as const;

export interface RagdollOptions {
  /** Initial linear velocity for every part (the character's motion at death). */
  velocity: Vec3;
  /** Collision-group slot from PhysicsWorld.allocCorpseSlot(). */
  slot: number;
}

export interface HingeState {
  angle: number;
  limits: [number, number];
}

interface Part {
  bone: THREE.Object3D;
  body: RigidBody;
  /** inverse(body world at death) * bone world at death. */
  offset: THREE.Matrix4;
}

interface Hinge {
  b1: RigidBody;
  b2: RigidBody;
  f1: THREE.Quaternion;
  f2: THREE.Quaternion;
  limits: [number, number];
}

interface Follower {
  bone: THREE.Object3D;
  anchor: THREE.Object3D;
  /** inverse(anchor world at death) * bone world at death. */
  offset: THREE.Matrix4;
}

/** Finds a bone by its three.js name ("WristR"; GLTFLoader strips dots) or the Blender one ("Wrist.R"). */
function findBone(root: THREE.Object3D, name: string): THREE.Object3D | undefined {
  return root.getObjectByName(name) ?? root.getObjectByName(name.replace(/([LR])$/, ".$1"));
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _one = new THREE.Vector3(1, 1, 1);

/** Body frame with local Y exactly along `dir` and local Z towards `forward` (orthogonalized). */
function limbFrame(dir: THREE.Vector3, forward: THREE.Vector3, fallback: THREE.Vector3): THREE.Quaternion {
  const f = perpComponent(forward, dir, new THREE.Vector3());
  if (f.lengthSq() < 1e-6) perpComponent(fallback, dir, f);
  f.normalize();
  const x = new THREE.Vector3().crossVectors(dir, f);
  return basisFromXY(x, dir, new THREE.Quaternion());
}

const axisOf = (q: THREE.Quaternion, x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(q);

export class Ragdoll {
  readonly bodies: RigidBody[] = [];
  private readonly parts: Part[] = [];
  private readonly hinges: Hinge[] = [];
  private readonly followers: Follower[] = [];
  private readonly byBone = new Map<string, RigidBody>();
  private readonly colliderHandles = new Set<number>();
  private settledSynced = false;

  private constructor(private readonly pw: PhysicsWorld) {}

  /**
   * Builds a ragdoll from `visual`'s current pose (its world matrices must be
   * up to date). Returns null when the skeleton lacks the required bones.
   */
  static create(pw: PhysicsWorld, visual: THREE.Object3D, opts: RagdollOptions): Ragdoll | null {
    const bones = new Map<string, THREE.Object3D>();
    for (const n of [...RAGDOLL_BONES, ...LANDMARKS]) {
      const b = findBone(visual, n);
      if (!b) return null;
      bones.set(n, b);
    }
    visual.updateWorldMatrix(true, true);
    const P = (n: string) => bones.get(n)!.getWorldPosition(new THREE.Vector3());
    const hipL = P("UpperLegL"), hipR = P("UpperLegR");
    const abd = P("Abdomen"), neck = P("Neck"), head = P("Head");
    const shL = P("UpperArmL"), shR = P("UpperArmR");
    const elL = P("LowerArmL"), elR = P("LowerArmR");
    const wrL = P("WristL"), wrR = P("WristR");
    const knL = P("LowerLegL"), knR = P("LowerLegR");
    const anL = P("FootL"), anR = P("FootR");
    const UP = new THREE.Vector3(0, 1, 0);
    const dirTo = (a: THREE.Vector3, b: THREE.Vector3) => new THREE.Vector3().subVectors(b, a).normalize();

    // ---- anatomical frames (local Y along the segment, Z = the part's front) ----
    const midHip = hipL.clone().add(hipR).multiplyScalar(0.5);
    const left = dirTo(hipR, hipL);
    const pelvisUp = perpComponent(new THREE.Vector3().subVectors(abd, midHip), left, new THREE.Vector3());
    if (pelvisUp.lengthSq() < 1e-6) pelvisUp.copy(UP);
    pelvisUp.normalize();
    const qPelvis = limbFrame(pelvisUp, new THREE.Vector3().crossVectors(left, pelvisUp), UP);
    const pelvisFwd = axisOf(qPelvis, 0, 0, 1);

    const chestUp = dirTo(abd, neck);
    const chestLeft = dirTo(shR, shL);
    const qChest = limbFrame(chestUp, new THREE.Vector3().crossVectors(chestLeft, chestUp), pelvisFwd);
    const chestFwd = axisOf(qChest, 0, 0, 1);
    const qHead = limbFrame(dirTo(neck, head), chestFwd, pelvisFwd);

    /** Front of a proximal limb part: its child's bend direction when bent
     * enough, else the given anatomical front. `sign` -1 for knees (they bend backwards). */
    const limbFront = (d1: THREE.Vector3, d2: THREE.Vector3, sign: number, fallback: THREE.Vector3) => {
      const bend = perpComponent(d2, d1, new THREE.Vector3());
      return bend.length() > 0.25 ? bend.normalize().multiplyScalar(sign) : fallback.clone();
    };
    const armL = dirTo(shL, elL), foreL = dirTo(elL, wrL);
    const armR = dirTo(shR, elR), foreR = dirTo(elR, wrR);
    const thighL = dirTo(hipL, knL), shinL = dirTo(knL, anL);
    const thighR = dirTo(hipR, knR), shinR = dirTo(knR, anR);
    const qUaL = limbFrame(armL, limbFront(armL, foreL, 1, chestFwd), chestFwd);
    const qUaR = limbFrame(armR, limbFront(armR, foreR, 1, chestFwd), chestFwd);
    const qLaL = limbFrame(foreL, axisOf(qUaL, 0, 0, 1), chestFwd);
    const qLaR = limbFrame(foreR, axisOf(qUaR, 0, 0, 1), chestFwd);
    const qThL = limbFrame(thighL, limbFront(thighL, shinL, -1, pelvisFwd), pelvisFwd);
    const qThR = limbFrame(thighR, limbFront(thighR, shinR, -1, pelvisFwd), pelvisFwd);
    const qShL = limbFrame(shinL, axisOf(qThL, 0, 0, 1), pelvisFwd);
    const qShR = limbFrame(shinR, axisOf(qThR, 0, 0, 1), pelvisFwd);

    const rd = new Ragdoll(pw);
    const R = pw.R;
    const groups = corpseGroups(opts.slot);

    const addPart = (bone: DrivenBone, origin: THREE.Vector3, rot: THREE.Quaternion, shapes: InstanceType<Rapier["ColliderDesc"]>[]) => {
      const desc = R.RigidBodyDesc.dynamic()
        .setTranslation(origin.x, origin.y, origin.z)
        .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
        .setLinvel(opts.velocity.x, opts.velocity.y, opts.velocity.z)
        .setLinearDamping(LINEAR_DAMPING)
        .setAngularDamping(ANGULAR_DAMPING)
        .setCcdEnabled(true)
        .setCanSleep(true);
      const body = pw.world.createRigidBody(desc);
      const mass = MASS[bone] / shapes.length;
      for (const s of shapes) {
        s.setMass(mass).setFriction(FRICTION).setRestitution(RESTITUTION).setCollisionGroups(groups);
        rd.colliderHandles.add(pw.world.createCollider(s, body).handle);
      }
      const boneObj = bones.get(bone)!;
      const bodyWorld = new THREE.Matrix4().compose(origin, rot, _one);
      const offset = bodyWorld.invert().multiply(boneObj.matrixWorld);
      rd.parts.push({ bone: boneObj, body, offset });
      rd.bodies.push(body);
      rd.byBone.set(bone, body);
      return body;
    };
    const capsule = (length: number, radius: number) => {
      const c = segmentCapsule(length, radius);
      return R.ColliderDesc.capsule(c.halfHeight, radius).setTranslation(0, c.centerY, 0);
    };

    // ---- bodies ----
    const hipHalf = hipL.distanceTo(hipR) / 2;
    const shoulderHalf = shL.distanceTo(shR) / 2;
    const chestLen = abd.distanceTo(neck);
    const pelvis = addPart("Body", midHip, qPelvis, [R.ColliderDesc.cuboid(Math.max(0.12, hipHalf + 0.06), 0.1, 0.1).setTranslation(0, 0.03, 0)]);
    const chest = addPart("Abdomen", abd, qChest, [
      R.ColliderDesc.cuboid(Math.max(0.12, shoulderHalf * 0.95), chestLen / 2, 0.1).setTranslation(0, chestLen / 2, 0),
    ]);
    const headBody = addPart("Neck", neck, qHead, [R.ColliderDesc.ball(0.11).setTranslation(0, neck.distanceTo(head) + 0.06, 0)]);
    const uaL = addPart("UpperArmL", shL, qUaL, [capsule(shL.distanceTo(elL), 0.05)]);
    const laL = addPart("LowerArmL", elL, qLaL, [capsule(elL.distanceTo(wrL) + 0.1, 0.045)]);
    const uaR = addPart("UpperArmR", shR, qUaR, [capsule(shR.distanceTo(elR), 0.05)]);
    const laR = addPart("LowerArmR", elR, qLaR, [capsule(elR.distanceTo(wrR) + 0.1, 0.045)]);
    const shinShapes = (len: number) => [capsule(len, 0.055), R.ColliderDesc.cuboid(0.045, 0.035, 0.1).setTranslation(0, len + 0.02, 0.05)];
    const thL = addPart("UpperLegL", hipL, qThL, [capsule(hipL.distanceTo(knL), 0.075)]);
    const sL = addPart("LowerLegL", knL, qShL, shinShapes(knL.distanceTo(anL)));
    const thR = addPart("UpperLegR", hipR, qThR, [capsule(hipR.distanceTo(knR), 0.075)]);
    const sR = addPart("LowerLegR", knR, qShR, shinShapes(knR.distanceTo(anR)));

    // ---- joints ----
    const Y = (q: THREE.Quaternion) => axisOf(q, 0, 1, 0);
    const Zv = (q: THREE.Quaternion) => axisOf(q, 0, 0, 1);
    const Xv = (q: THREE.Quaternion) => axisOf(q, 1, 0, 0);
    const neg = (v: THREE.Vector3) => v.clone().negate();
    rd.spherical(pelvis, qPelvis, chest, qChest, abd, twistFrame(Y(qPelvis), Zv(qPelvis), new THREE.Quaternion()), twistFrame(Y(qChest), Zv(qChest), new THREE.Quaternion()), LIMITS.spine);
    rd.spherical(chest, qChest, headBody, qHead, neck, twistFrame(Y(qChest), Zv(qChest), new THREE.Quaternion()), twistFrame(Y(qHead), Zv(qHead), new THREE.Quaternion()), LIMITS.neck);
    const shoulderFrame = twistFrame(neg(Y(qChest)), Zv(qChest), new THREE.Quaternion());
    rd.spherical(chest, qChest, uaL, qUaL, shL, shoulderFrame, twistFrame(Y(qUaL), Zv(qUaL), new THREE.Quaternion()), LIMITS.shoulderL);
    rd.spherical(chest, qChest, uaR, qUaR, shR, shoulderFrame, twistFrame(Y(qUaR), Zv(qUaR), new THREE.Quaternion()), LIMITS.shoulderR);
    const hipFrame = twistFrame(neg(Y(qPelvis)), Zv(qPelvis), new THREE.Quaternion());
    rd.spherical(pelvis, qPelvis, thL, qThL, hipL, hipFrame, twistFrame(Y(qThL), Zv(qThL), new THREE.Quaternion()), LIMITS.hipL);
    rd.spherical(pelvis, qPelvis, thR, qThR, hipR, hipFrame, twistFrame(Y(qThR), Zv(qThR), new THREE.Quaternion()), LIMITS.hipR);
    // Elbows flex towards the upper arm's front (+Z): hinge = Y x Z = X.
    rd.revolute(uaL, qUaL, laL, qLaL, elL, Xv(qUaL), LIMITS.elbow);
    rd.revolute(uaR, qUaR, laR, qLaR, elR, Xv(qUaR), LIMITS.elbow);
    // Knees flex backwards (-Z): hinge = Y x (-Z) = -X.
    rd.revolute(thL, qThL, sL, qShL, knL, neg(Xv(qThL)), LIMITS.knee);
    rd.revolute(thR, qThR, sR, qShR, knR, neg(Xv(qThR)), LIMITS.knee);

    // ---- followers: the IK feet hang off Root in this rig; pin them to the shins ----
    for (const [foot, shin] of [["FootL", "LowerLegL"], ["FootR", "LowerLegR"]] as const) {
      const bone = bones.get(foot)!;
      const anchor = bones.get(shin)!;
      if (bone.parent === anchor) continue;
      const offset = anchor.matrixWorld.clone().invert().multiply(bone.matrixWorld);
      rd.followers.push({ bone, anchor, offset });
    }
    return rd;
  }

  private localFrame(bodyRot: THREE.Quaternion, worldFrame: THREE.Quaternion): THREE.Quaternion {
    return bodyRot.clone().invert().multiply(worldFrame);
  }

  private localAnchor(body: RigidBody, world: THREE.Vector3): { x: number; y: number; z: number } {
    const t = body.translation();
    const r = body.rotation();
    const v = world.clone().sub(_p.set(t.x, t.y, t.z)).applyQuaternion(_q.set(r.x, r.y, r.z, r.w).invert());
    return { x: v.x, y: v.y, z: v.z };
  }

  private spherical(
    b1: RigidBody,
    q1: THREE.Quaternion,
    b2: RigidBody,
    q2: THREE.Quaternion,
    anchor: THREE.Vector3,
    fw1: THREE.Quaternion,
    fw2: THREE.Quaternion,
    limits: readonly (readonly [number, number])[],
  ): void {
    const R = this.pw.R;
    const a1 = this.localAnchor(b1, anchor);
    const a2 = this.localAnchor(b2, anchor);
    const j = this.pw.world.createImpulseJoint(R.JointData.spherical(a1, a2), b1, b2, true);
    const f1 = this.localFrame(q1, fw1);
    const f2 = this.localFrame(q2, fw2);
    j.setLocalFrame1(a1, { x: f1.x, y: f1.y, z: f1.z, w: f1.w });
    j.setLocalFrame2(a2, { x: f2.x, y: f2.y, z: f2.z, w: f2.w });
    j.setContactsEnabled(false);
    const start = frameAngles(fw1, fw2);
    const startByAxis = [start.x, start.y, start.z];
    const raw = this.pw.world.impulseJoints.raw;
    for (let i = 0; i < 3; i++) {
      const [lo, hi] = widenLimits(limits[i], startByAxis[i], LIMIT_MARGIN);
      raw.jointSetLimits(j.handle, ANG_AXES[i] as never, lo, hi);
      raw.jointConfigureMotorVelocity(j.handle, ANG_AXES[i] as never, 0, JOINT_DAMPING);
    }
  }

  private revolute(b1: RigidBody, q1: THREE.Quaternion, b2: RigidBody, q2: THREE.Quaternion, anchor: THREE.Vector3, hinge: THREE.Vector3, limits: readonly [number, number]): void {
    const R = this.pw.R;
    const fw1 = hingeFrame(hinge, axisOf(q1, 0, 1, 0), new THREE.Quaternion());
    // The child's frame shares the hinge; its Y is the child segment (made perpendicular to the hinge).
    const fw2 = hingeFrame(axisOf(fw1, 1, 0, 0), axisOf(q2, 0, 1, 0), new THREE.Quaternion());
    const a1 = this.localAnchor(b1, anchor);
    const a2 = this.localAnchor(b2, anchor);
    const j = this.pw.world.createImpulseJoint(R.JointData.revolute(a1, a2, { x: 1, y: 0, z: 0 }), b1, b2, true) as InstanceType<Rapier["RevoluteImpulseJoint"]>;
    const f1 = this.localFrame(q1, fw1);
    const f2 = this.localFrame(q2, fw2);
    j.setLocalFrame1(a1, { x: f1.x, y: f1.y, z: f1.z, w: f1.w });
    j.setLocalFrame2(a2, { x: f2.x, y: f2.y, z: f2.z, w: f2.w });
    j.setContactsEnabled(false);
    const range = widenLimits(limits, frameAngles(fw1, fw2).x, LIMIT_MARGIN);
    j.setLimits(range[0], range[1]);
    j.configureMotorVelocity(0, JOINT_DAMPING);
    this.hinges.push({ b1, b2, f1, f2, limits: range });
  }

  /** Current angle and limits of every hinge (knees/elbows) — for tests/debugging. */
  hingeStates(): HingeState[] {
    const w1 = new THREE.Quaternion();
    const w2 = new THREE.Quaternion();
    return this.hinges.map((h) => {
      const r1 = h.b1.rotation();
      const r2 = h.b2.rotation();
      w1.set(r1.x, r1.y, r1.z, r1.w).multiply(h.f1);
      w2.set(r2.x, r2.y, r2.z, r2.w).multiply(h.f2);
      return { angle: frameAngles(w1, w2).x, limits: h.limits };
    });
  }

  bodyOf(bone: string): RigidBody | undefined {
    return this.byBone.get(bone);
  }

  ownsCollider(handle: number): boolean {
    return this.colliderHandles.has(handle);
  }

  /** Applies `impulse` (N·s) at world `point` on the nearest body part. */
  applyImpulseAt(impulse: Vec3, point: Vec3): void {
    const centers = this.bodies.map((b) => b.worldCom());
    const i = nearestIndex(centers, point);
    if (i < 0) return;
    this.bodies[i].applyImpulseAtPoint(impulse, point, true);
    this.settledSynced = false;
  }

  /** Same as applyImpulseAt but on the body owning `colliderHandle` (a bullet hitting a limb). */
  applyImpulseToCollider(colliderHandle: number, impulse: Vec3, point: Vec3): void {
    const col = this.pw.world.getCollider(colliderHandle);
    const body = col?.parent();
    if (!body) return;
    body.applyImpulseAtPoint(impulse, point, true);
    this.settledSynced = false;
  }

  isSleeping(): boolean {
    return this.bodies.every((b) => b.isSleeping());
  }

  /** Fastest linear speed among the parts (m/s). */
  maxSpeed(): number {
    let m = 0;
    for (const b of this.bodies) {
      const v = b.linvel();
      m = Math.max(m, Math.hypot(v.x, v.y, v.z));
    }
    return m;
  }

  /** Puts every part to sleep (woken again by contacts/impulses). */
  sleep(): void {
    for (const b of this.bodies) b.sleep();
  }

  /** Copies the simulated poses onto the skeleton (cheap no-op once asleep and synced). */
  sync(): void {
    const sleeping = this.isSleeping();
    if (sleeping && this.settledSynced) return;
    this.settledSynced = sleeping;
    for (const part of this.parts) {
      const t = part.body.translation();
      const r = part.body.rotation();
      _m.compose(_p.set(t.x, t.y, t.z), _q.set(r.x, r.y, r.z, r.w), _one).multiply(part.offset);
      const parent = part.bone.parent;
      if (!parent) continue;
      parent.updateWorldMatrix(true, false);
      worldToLocal(parent.matrixWorld, _m, part.bone.position, part.bone.quaternion, _s);
      part.bone.scale.copy(_s);
    }
    for (const f of this.followers) {
      f.anchor.updateWorldMatrix(true, false);
      _m.multiplyMatrices(f.anchor.matrixWorld, f.offset);
      const parent = f.bone.parent;
      if (!parent) continue;
      parent.updateWorldMatrix(true, false);
      worldToLocal(parent.matrixWorld, _m, f.bone.position, f.bone.quaternion, _s);
      f.bone.scale.copy(_s);
    }
  }

  /** Removes every body (and with them their colliders and joints). */
  dispose(): void {
    for (const b of this.bodies) this.pw.removeBody(b);
    this.bodies.length = 0;
    this.parts.length = 0;
    this.hinges.length = 0;
    this.colliderHandles.clear();
  }
}
