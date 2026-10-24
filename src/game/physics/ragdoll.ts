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
//
// Muscles (physics/muscles.ts): every joint axis carries a Rapier position
// motor. Its target is the joint's angle in the death pose (same 2·asin
// metric as the limits, clamped inside them) plus the protective reflex, and
// its gains come from a per-joint strength 0..1. Modes:
// - death (startDeath): partial strength fading to zero over ~1-1.8 s, the
//   struck limb limp at once, reflexes (brace / curl) blended in; at the end
//   every motor goes back to the passive zero-velocity "friction" motor, so
//   the settled corpse behaves exactly like the old passive ragdoll;
// - hold (hold): a fixed strength holding the pose (debug dummies, tests);
// - none: passive.

import * as THREE from "three";
import type { Rapier } from "./physicsWorld";
import { corpseGroups, type PhysicsWorld } from "./physicsWorld";
import { basisFromXY, frameAngles, hingeFrame, perpComponent, segmentCapsule, twistFrame, widenLimits, worldToLocal } from "./ragdollMath";
import { nearestIndex, type Vec3 } from "./deathImpulse";
import {
  JOINT_FRICTION,
  JOINT_GROUP,
  clampTarget,
  deathEnd,
  deathFadeFor,
  jointStrength,
  kneeBuckleImpulse,
  limpJointsFor,
  muscleGains,
  reflexTargets,
  reflexWeight,
  type DeathCause,
  type DeathFade,
  type JointName,
  type JointTarget,
  type PoseTargets,
} from "./muscles";

type RigidBody = InstanceType<Rapier["RigidBody"]>;
type Collider = InstanceType<Rapier["Collider"]>;

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

/** Every bone whose local transform sync() writes: the driven ones plus the re-attached IK feet. */
export const RAGDOLL_WRITTEN_BONES: readonly string[] = [...RAGDOLL_BONES, "FootL", "FootR"];

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
const JOINT_DAMPING = JOINT_FRICTION;
/** Rapier's default (unlimited) motor torque, restored when the muscles go limp. */
const UNLIMITED_FORCE = 3.4e38;
/** Fall direction for the brace reflex: pelvis speed (m/s) that counts as a full
 * fall, weight of the chest's lean (m/s per unit of horizontal up-axis), smoothing (s). */
const FALL_FULL_SPEED = 1.5;
const FALL_LEAN = 2;
const FALL_SMOOTH = 0.12;
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
/** RawMotorModel: AccelerationBased (Rapier's default, the passive friction) / ForceBased (muscles). */
const MOTOR_ACCELERATION = 0;
const MOTOR_FORCE = 1;

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
  name: DrivenBone;
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

/** A jointed pair with its motors (one per free angular axis). */
interface MotorJoint {
  name: JointName;
  handle: number;
  hinge: boolean;
  b1: RigidBody;
  b2: RigidBody;
  /** Joint frames in each body's local space (world frame = body rotation * f). */
  f1: THREE.Quaternion;
  f2: THREE.Quaternion;
  /** Anchor in b1's local space. */
  a1: THREE.Vector3;
  /** Widened limits: [twist, flexion, sideways] for a ball joint, [flexion] for a hinge. */
  limits: [number, number][];
  /** Last commanded target and strength. */
  target: JointTarget;
  strength: number;
  /** Whether the axes currently use ForceBased position motors (muscles) or the passive friction motor. */
  active: boolean;
}

type MuscleState =
  | { kind: "hold"; strength: number }
  | { kind: "death"; t: number; end: number; fade: DeathFade; cause: DeathCause; limp: Set<JointName> };

export interface DeathOptions {
  cause: DeathCause;
  /** Ragdoll part hit by the killing blow (its joint goes limp at once), if any. */
  struck?: string | null;
  /** Seeds the per-death randomness of the fade (deterministic for tests). */
  seed: number;
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
const _w1 = new THREE.Quaternion();
const _w2 = new THREE.Quaternion();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

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
  private readonly joints: MotorJoint[] = [];
  /** Death-pose angles of every joint (the muscles' base targets). */
  private readonly base = {} as PoseTargets;
  private muscle: MuscleState | null = null;
  /** Smoothed fall direction in the chest frame (brace reflex). */
  private fallF = 0;
  private fallR = 0;
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
      rd.parts.push({ name: bone, bone: boneObj, body, offset });
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
    rd.spherical("spine", pelvis, qPelvis, chest, qChest, abd, twistFrame(Y(qPelvis), Zv(qPelvis), new THREE.Quaternion()), twistFrame(Y(qChest), Zv(qChest), new THREE.Quaternion()), LIMITS.spine);
    rd.spherical("neck", chest, qChest, headBody, qHead, neck, twistFrame(Y(qChest), Zv(qChest), new THREE.Quaternion()), twistFrame(Y(qHead), Zv(qHead), new THREE.Quaternion()), LIMITS.neck);
    const shoulderFrame = twistFrame(neg(Y(qChest)), Zv(qChest), new THREE.Quaternion());
    rd.spherical("shoulderL", chest, qChest, uaL, qUaL, shL, shoulderFrame, twistFrame(Y(qUaL), Zv(qUaL), new THREE.Quaternion()), LIMITS.shoulderL);
    rd.spherical("shoulderR", chest, qChest, uaR, qUaR, shR, shoulderFrame, twistFrame(Y(qUaR), Zv(qUaR), new THREE.Quaternion()), LIMITS.shoulderR);
    const hipFrame = twistFrame(neg(Y(qPelvis)), Zv(qPelvis), new THREE.Quaternion());
    rd.spherical("hipL", pelvis, qPelvis, thL, qThL, hipL, hipFrame, twistFrame(Y(qThL), Zv(qThL), new THREE.Quaternion()), LIMITS.hipL);
    rd.spherical("hipR", pelvis, qPelvis, thR, qThR, hipR, hipFrame, twistFrame(Y(qThR), Zv(qThR), new THREE.Quaternion()), LIMITS.hipR);
    // Elbows flex towards the upper arm's front (+Z): hinge = Y x Z = X.
    rd.revolute("elbowL", uaL, qUaL, laL, qLaL, elL, Xv(qUaL), LIMITS.elbow);
    rd.revolute("elbowR", uaR, qUaR, laR, qLaR, elR, Xv(qUaR), LIMITS.elbow);
    // Knees flex backwards (-Z): hinge = Y x (-Z) = -X.
    rd.revolute("kneeL", thL, qThL, sL, qShL, knL, neg(Xv(qThL)), LIMITS.knee);
    rd.revolute("kneeR", thR, qThR, sR, qShR, knR, neg(Xv(qThR)), LIMITS.knee);

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
    name: JointName,
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
    const widened: [number, number][] = [];
    for (let i = 0; i < 3; i++) {
      const [lo, hi] = widenLimits(limits[i], startByAxis[i], LIMIT_MARGIN);
      widened.push([lo, hi]);
      raw.jointSetLimits(j.handle, ANG_AXES[i] as never, lo, hi);
      raw.jointConfigureMotorVelocity(j.handle, ANG_AXES[i] as never, 0, JOINT_DAMPING);
    }
    this.addMotorJoint(name, j.handle, false, b1, b2, f1, f2, a1, widened, start);
  }

  private revolute(name: JointName, b1: RigidBody, q1: THREE.Quaternion, b2: RigidBody, q2: THREE.Quaternion, anchor: THREE.Vector3, hinge: THREE.Vector3, limits: readonly [number, number]): void {
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
    const angle = frameAngles(fw1, fw2).x;
    const range = widenLimits(limits, angle, LIMIT_MARGIN);
    j.setLimits(range[0], range[1]);
    j.configureMotorVelocity(0, JOINT_DAMPING);
    this.hinges.push({ b1, b2, f1, f2, limits: range });
    this.addMotorJoint(name, j.handle, true, b1, b2, f1, f2, a1, [range], { x: angle, y: 0, z: 0 });
  }

  private addMotorJoint(
    name: JointName,
    handle: number,
    hinge: boolean,
    b1: RigidBody,
    b2: RigidBody,
    f1: THREE.Quaternion,
    f2: THREE.Quaternion,
    a1: { x: number; y: number; z: number },
    limits: [number, number][],
    start: JointTarget,
  ): void {
    const target = clampTarget(start, limits);
    this.base[name] = { ...target };
    this.joints.push({ name, handle, hinge, b1, b2, f1, f2, a1: new THREE.Vector3(a1.x, a1.y, a1.z), limits, target, strength: 0, active: false });
  }

  // ---- Muscles ----

  /** Holds the death pose at a fixed strength 0..1 (no fade, no reflexes) until another mode is set. */
  hold(strength: number): void {
    this.muscle = { kind: "hold", strength };
    for (const j of this.joints) this.drive(j, this.base[j.name], strength);
    this.wake();
  }

  /** Starts the dying fade (see muscles.ts): partial strength fading to limp, struck limb limp at once. */
  startDeath(opts: DeathOptions): void {
    const fade = deathFadeFor(opts.cause, opts.seed);
    this.muscle = { kind: "death", t: 0, end: deathEnd(fade, opts.cause), fade, cause: opts.cause, limp: new Set(limpJointsFor(opts.struck ?? null)) };
    this.fallF = 0;
    this.fallR = 0;
    this.stepMuscles(0);
    for (const j of this.joints) if (j.name === "kneeL" || j.name === "kneeR") this.kickHinge(j, kneeBuckleImpulse(opts.cause, this.muscle?.kind === "death" && this.muscle.limp.has(j.name)));
    this.wake();
  }

  /** Internal flexion angular impulse on a hinge (equal and opposite on its two bodies: no net momentum). */
  private kickHinge(j: MotorJoint, impulse: number): void {
    if (!j.hinge || impulse === 0) return;
    const r = j.b1.rotation();
    const axis = _v1.set(1, 0, 0).applyQuaternion(_q.set(r.x, r.y, r.z, r.w).multiply(j.f1));
    j.b2.applyTorqueImpulse({ x: axis.x * impulse, y: axis.y * impulse, z: axis.z * impulse }, true);
    j.b1.applyTorqueImpulse({ x: -axis.x * impulse, y: -axis.y * impulse, z: -axis.z * impulse }, true);
  }

  /** Back to the passive ragdoll: zero-velocity friction motors, unlimited torque (the pre-muscle setup). */
  goLimp(): void {
    this.muscle = null;
    for (const j of this.joints) this.passive(j);
  }

  /** The pre-muscle motor setup on every axis of `j`: AccelerationBased zero-velocity friction, no torque cap. */
  private passive(j: MotorJoint): void {
    j.strength = 0;
    if (!j.active) return;
    j.active = false;
    const raw = this.pw.world.impulseJoints.raw;
    for (let i = 0; i < (j.hinge ? 1 : 3); i++) {
      raw.jointConfigureMotorModel(j.handle, ANG_AXES[i] as never, MOTOR_ACCELERATION as never);
      raw.jointConfigureMotorVelocity(j.handle, ANG_AXES[i] as never, 0, JOINT_DAMPING);
      raw.jointSetMotorMaxForce(j.handle, ANG_AXES[i] as never, UNLIMITED_FORCE);
    }
  }

  /** Advances the muscles by `dt` seconds; call right before each physics step. */
  stepMuscles(dt: number): void {
    const m = this.muscle;
    if (!m || m.kind !== "death") return;
    m.t += dt;
    if (m.t >= m.end) {
      this.goLimp();
      return;
    }
    this.updateFall(dt);
    const targets = reflexTargets(this.base, { weight: reflexWeight(m.t), fallForward: this.fallF, fallRight: this.fallR, mode: m.cause === "ram" ? "curl" : "brace" });
    for (const j of this.joints) this.drive(j, targets[j.name], jointStrength(j.name, m.t, m.fade, m.cause, m.limp));
    // Muscles at work keep the body awake (the fade lasts at most ~2 s).
    this.wake();
  }

  /** True while the death fade runs. */
  get dying(): boolean {
    return this.muscle?.kind === "death";
  }

  /** "hold", "death" or "limp". */
  get muscleMode(): "hold" | "death" | "limp" {
    return this.muscle?.kind ?? "limp";
  }

  /** Mean commanded joint strength (0 when limp). */
  get strength(): number {
    if (!this.muscle) return 0;
    let s = 0;
    for (const j of this.joints) s += j.strength;
    return this.joints.length ? s / this.joints.length : 0;
  }

  /** Commanded strength of one joint (0 when limp). */
  jointStrengthOf(name: JointName): number {
    return this.muscle ? (this.joints.find((j) => j.name === name)?.strength ?? 0) : 0;
  }

  /** Largest |angle - target| (rad) over the motorized axes of joints with strength > 0. */
  maxMotorError(): number {
    if (!this.muscle) return 0;
    let worst = 0;
    for (const j of this.joints) {
      if (j.strength <= 0) continue;
      worst = Math.max(worst, this.jointError(j));
    }
    return worst;
  }

  /** |angle - target| (rad) of one joint, max over its axes (for tests/debugging). */
  jointErrorOf(name: JointName): number {
    const j = this.joints.find((k) => k.name === name);
    return j ? this.jointError(j) : 0;
  }

  /** Current per-axis angles of one joint (hinges: x only). */
  jointAngles(name: JointName): JointTarget | null {
    const j = this.joints.find((k) => k.name === name);
    if (!j) return null;
    const a = this.anglesOf(j);
    return j.hinge ? { x: a.x, y: 0, z: 0 } : a;
  }

  /** Last commanded motor target of one joint (always inside its limits). */
  jointTargetOf(name: JointName): JointTarget | null {
    const j = this.joints.find((k) => k.name === name);
    return j ? { ...j.target } : null;
  }

  /** The joint limits (widened at creation) of one joint. */
  jointLimits(name: JointName): readonly (readonly [number, number])[] {
    return this.joints.find((k) => k.name === name)?.limits ?? [];
  }

  /** Marks a part as struck while dying: its joint(s) go limp at once (a bullet hitting a corpse still fading). */
  strike(bone: string | null): void {
    const m = this.muscle;
    if (m?.kind !== "death") return;
    for (const name of limpJointsFor(bone)) {
      if (m.limp.has(name)) continue;
      m.limp.add(name);
      const j = this.joints.find((k) => k.name === name);
      if (j && (name === "kneeL" || name === "kneeR")) this.kickHinge(j, kneeBuckleImpulse(m.cause, true));
    }
  }

  /** Commands `j` towards `target` (clamped to its limits) at `strength`; zero strength = passive. */
  private drive(j: MotorJoint, target: JointTarget, strength: number): void {
    const t = clampTarget(target, j.limits);
    j.target = t;
    const g = muscleGains(JOINT_GROUP[j.name], strength);
    if (!g) {
      this.passive(j);
      return;
    }
    const raw = this.pw.world.impulseJoints.raw;
    const values = [t.x, t.y, t.z];
    const n = j.hinge ? 1 : 3;
    for (let i = 0; i < n; i++) {
      if (!j.active) raw.jointConfigureMotorModel(j.handle, ANG_AXES[i] as never, MOTOR_FORCE as never);
      raw.jointConfigureMotorPosition(j.handle, ANG_AXES[i] as never, values[i], g.stiffness, g.damping);
      raw.jointSetMotorMaxForce(j.handle, ANG_AXES[i] as never, g.maxForce);
    }
    j.active = true;
    j.strength = strength;
  }

  private anglesOf(j: MotorJoint): JointTarget {
    const r1 = j.b1.rotation();
    const r2 = j.b2.rotation();
    const w1 = _w1.set(r1.x, r1.y, r1.z, r1.w).multiply(j.f1);
    const w2 = _w2.set(r2.x, r2.y, r2.z, r2.w).multiply(j.f2);
    return frameAngles(w1, w2);
  }

  private jointError(j: MotorJoint): number {
    const a = this.anglesOf(j);
    const ex = Math.abs(a.x - j.target.x);
    if (j.hinge) return ex;
    return Math.max(ex, Math.abs(a.y - j.target.y), Math.abs(a.z - j.target.z));
  }

  /** Low-passed fall direction (pelvis velocity + chest lean) expressed in the chest's frame. */
  private updateFall(dt: number): void {
    const pelvis = this.bodies[0];
    const chest = this.bodies[1];
    if (!pelvis || !chest) return;
    const v = pelvis.linvel();
    const r = chest.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    const up = _v1.set(0, 1, 0).applyQuaternion(_q);
    const dx = v.x + FALL_LEAN * up.x;
    const dz = v.z + FALL_LEAN * up.z;
    const mag = Math.hypot(dx, dz);
    let f = 0;
    let rt = 0;
    if (mag > 1e-4) {
      // Chest front and right (the body frame's -X; +X is the character's left), flattened.
      const fwd = _v2.set(0, 0, 1).applyQuaternion(_q);
      const right = _v3.set(-1, 0, 0).applyQuaternion(_q);
      const fl = Math.hypot(fwd.x, fwd.z) || 1;
      const rl = Math.hypot(right.x, right.z) || 1;
      const scale = Math.min(1, mag / FALL_FULL_SPEED) / mag;
      f = ((dx * fwd.x + dz * fwd.z) / fl) * scale;
      rt = ((dx * right.x + dz * right.z) / rl) * scale;
    }
    const k = dt > 0 ? 1 - Math.exp(-dt / FALL_SMOOTH) : 1;
    this.fallF += (f - this.fallF) * k;
    this.fallR += (rt - this.fallR) * k;
  }

  private wake(): void {
    for (const b of this.bodies) b.wakeUp();
  }

  /** Pins the pelvis in place (kinematic) or releases it — debug dummies and tests. */
  setPinned(pinned: boolean): void {
    const pelvis = this.bodies[0];
    if (!pelvis) return;
    const T = this.pw.R.RigidBodyType;
    pelvis.setBodyType(pinned ? T.KinematicPositionBased : T.Dynamic, true);
    if (pinned) {
      pelvis.setLinvel({ x: 0, y: 0, z: 0 }, true);
      pelvis.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.settledSynced = false;
  }

  /** Adds `v` (m/s) to every part's velocity (a car ram thrown after creation). */
  addVelocity(v: Vec3): void {
    for (const b of this.bodies) {
      const c = b.linvel();
      b.setLinvel({ x: c.x + v.x, y: c.y + v.y, z: c.z + v.z }, true);
    }
    this.settledSynced = false;
  }

  // ---- Debug views ----

  /** Every collider of the ragdoll (debug overlay). */
  colliders(): Collider[] {
    const out: Collider[] = [];
    for (const h of this.colliderHandles) {
      const c = this.pw.world.getCollider(h);
      if (c) out.push(c);
    }
    return out;
  }

  /** World positions of the joint anchors (written into `out`, grown as needed); returns the count. */
  jointAnchors(out: THREE.Vector3[]): number {
    this.joints.forEach((j, i) => {
      const t = j.b1.translation();
      const r = j.b1.rotation();
      if (!out[i]) out[i] = new THREE.Vector3();
      out[i].copy(j.a1).applyQuaternion(_q.set(r.x, r.y, r.z, r.w)).add(_p.set(t.x, t.y, t.z));
    });
    return this.joints.length;
  }

  /** Mass-weighted centre of mass of all parts (world), written into `out`. */
  centerOfMass(out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0, 0);
    let total = 0;
    for (const b of this.bodies) {
      const m = b.mass();
      const c = b.worldCom();
      out.x += c.x * m;
      out.y += c.y * m;
      out.z += c.z * m;
      total += m;
    }
    return total > 0 ? out.multiplyScalar(1 / total) : out;
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

  /** Applies `impulse` (N·s) at world `point` on the nearest body part; returns that part's bone name. */
  applyImpulseAt(impulse: Vec3, point: Vec3): DrivenBone | null {
    const centers = this.bodies.map((b) => b.worldCom());
    const i = nearestIndex(centers, point);
    if (i < 0) return null;
    this.bodies[i].applyImpulseAtPoint(impulse, point, true);
    this.settledSynced = false;
    return this.parts[i].name;
  }

  /** Bone name of the part closest to `point` (null without parts). */
  nearestPart(point: Vec3): DrivenBone | null {
    const i = nearestIndex(this.bodies.map((b) => b.worldCom()), point);
    return i < 0 ? null : this.parts[i].name;
  }

  /** Same as applyImpulseAt but on the body owning `colliderHandle` (a bullet hitting a limb). */
  applyImpulseToCollider(colliderHandle: number, impulse: Vec3, point: Vec3): void {
    const col = this.pw.world.getCollider(colliderHandle);
    const body = col?.parent();
    if (!body) return;
    body.applyImpulseAtPoint(impulse, point, true);
    this.settledSynced = false;
    this.strike(this.parts.find((p) => p.body.handle === body.handle)?.name ?? null);
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
    this.joints.length = 0;
    this.muscle = null;
    this.colliderHandles.clear();
  }
}
