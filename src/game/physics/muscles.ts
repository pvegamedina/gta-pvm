// Pure "muscle" layer for the ragdolls (physics/ragdoll.ts): per-joint motor
// gains scaled by a strength 0..1, the Euphoria-style death fade (muscles
// start at partial strength holding the death pose, then give way over
// ~1-1.8 s, knees first, arms last), which joints a hit leaves limp, and the
// protective reflex pose (brace / curl) blended over the death-pose targets.
// No Rapier, no THREE: unit-testable in Node.
//
// Joint angles use the ragdoll's per-axis convention (ragdollMath.frameAngles,
// the same 2·asin metric as Rapier's limits and motors):
// - spherical joints: x = twist, y = flexion (+ bends the child towards the
//   parent's front), z = sideways (+ towards the character's right, so the
//   left arm's "outward" is -z and the right arm's is +z);
// - hinges (elbows, knees): x = flexion (+ bends), y and z unused.

export const JOINT_NAMES = ["spine", "neck", "shoulderL", "shoulderR", "hipL", "hipR", "elbowL", "elbowR", "kneeL", "kneeR"] as const;
export type JointName = (typeof JOINT_NAMES)[number];

export type MuscleGroup = "spine" | "neck" | "shoulder" | "elbow" | "hip" | "knee";

export const JOINT_GROUP: Record<JointName, MuscleGroup> = {
  spine: "spine",
  neck: "neck",
  shoulderL: "shoulder",
  shoulderR: "shoulder",
  hipL: "hip",
  hipR: "hip",
  elbowL: "elbow",
  elbowR: "elbow",
  kneeL: "knee",
  kneeR: "knee",
};

export interface MuscleGains {
  /** Motor stiffness (Rapier ForceBased, N·m/rad): k = w²·I of the chain the joint moves. */
  stiffness: number;
  /** Motor damping (N·m·s/rad): d = 2·zeta·w·I. */
  damping: number;
  /** Torque cap (N·m): a strong enough hit overpowers the muscle. */
  maxForce: number;
}

// ---- Tunables ----
/** Zero-velocity damping of the passive joints ("joint friction"; Rapier
 * AccelerationBased velocity-motor factor — the pre-muscle ragdoll's value). */
export const JOINT_FRICTION = 0.6;
/** Hard ceiling for any motor torque (N·m): keeps 1/60 s, 8-iteration steps stable. */
export const MAX_MOTOR_FORCE = 300;
/** Muscle torque cap relative to the static gravity torque of the chain it carries. */
const TORQUE_MARGIN = 4;
/** Smallest torque cap (N·m), so light limbs still hold their pose. */
const MIN_MOTOR_FORCE = 20;
/** Damping ratio of every muscle (nominal; see FREQUENCY for why the effective one is higher). */
const ZETA = 0.75;
const G = 9.81;

/**
 * Mass (kg) each joint carries and the lever (m) from the joint to that
 * chain's centre of mass, from the ragdoll's part masses (ragdoll.ts MASS):
 * spine = chest + head + both arms, hip = thigh + shin, and so on. The knee
 * is sized as a support joint instead: half the body (~37 kg) over a
 * slightly bent knee (0.15 m lever), or a healthy knee can't carry the body
 * for a moment while a struck one buckles. Inertia I = mass·lever² scales the
 * gains, torque caps come from the gravity torque mass·g·lever.
 */
export const CHAIN_LOAD: Record<MuscleGroup, { mass: number; lever: number }> = {
  spine: { mass: 35.2, lever: 0.25 },
  neck: { mass: 5, lever: 0.12 },
  shoulder: { mass: 4.1, lever: 0.3 },
  elbow: { mass: 1.7, lever: 0.18 },
  hip: { mass: 14, lever: 0.3 },
  knee: { mass: 37, lever: 0.15 },
};

/**
 * Nominal muscle frequency (Hz) per group: the research table's 3-5.5 Hz
 * times ~1.4, because Rapier measures the motor error per axis as sin(θ/2),
 * which halves the effective stiffness (effective f = nominal / √2). Gains
 * are ForceBased and scaled by the chain inertia: Rapier's default
 * AccelerationBased model normalizes by the two jointed bodies only, so a
 * knee or hip carrying the whole body barely resisted (measured in Node: a
 * crouch collapsed even at full strength; with these it holds).
 */
const FREQUENCY: Record<MuscleGroup, number> = {
  spine: 6.4,
  neck: 5.5,
  shoulder: 7.1,
  elbow: 6.4,
  hip: 6.4,
  knee: 6.0,
};

const torqueCap = (g: MuscleGroup) => {
  const l = CHAIN_LOAD[g];
  return Math.min(MAX_MOTOR_FORCE, Math.max(MIN_MOTOR_FORCE, TORQUE_MARGIN * l.mass * G * l.lever));
};

/** Chain inertia about the joint (kg·m²). */
export const chainInertia = (g: MuscleGroup) => CHAIN_LOAD[g].mass * CHAIN_LOAD[g].lever ** 2;

/** Full-strength gains per muscle group. */
export const MUSCLE_TABLE: Record<MuscleGroup, MuscleGains> = Object.fromEntries(
  (Object.keys(FREQUENCY) as MuscleGroup[]).map((g) => {
    const w = 2 * Math.PI * FREQUENCY[g];
    const I = chainInertia(g);
    return [g, { stiffness: w * w * I, damping: 2 * ZETA * w * I, maxForce: torqueCap(g) }];
  }),
) as Record<MuscleGroup, MuscleGains>;

const clamp01 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Motor gains of a muscle group at `strength` (clamped to 0..1): stiffness
 * and torque cap scale linearly, damping with sqrt(strength) so it doesn't
 * collapse along with the stiffness. Null at zero strength: the joint then
 * uses the passive friction motor (JOINT_FRICTION), exactly as before muscles.
 */
export function muscleGains(group: MuscleGroup, strength: number): MuscleGains | null {
  const s = clamp01(strength);
  if (s <= 0) return null;
  const t = MUSCLE_TABLE[group];
  return { stiffness: t.stiffness * s, damping: t.damping * Math.sqrt(s), maxForce: t.maxForce * s };
}

// ---- Death fade ----
export type DeathCause = "shot" | "ram" | "generic";

export interface DeathFade {
  /** Strength right after death (0..1). */
  start: number;
  /** Seconds the start strength is held before fading. */
  hold: number;
  /** Seconds from the end of the hold to zero strength. */
  fade: number;
}

/** Random ranges [min, max] per cause; `total` = hold + fade (s). */
const FADE_RANGES: Record<DeathCause, { start: [number, number]; hold: [number, number]; total: [number, number] }> = {
  shot: { start: [0.55, 0.75], hold: [0.06, 0.18], total: [1.0, 1.8] },
  generic: { start: [0.55, 0.75], hold: [0.06, 0.18], total: [1.0, 1.8] },
  // Hit by a car: the muscles drop almost at once and the body tumbles.
  ram: { start: [0.25, 0.35], hold: [0, 0.04], total: [0.25, 0.4] },
};

/** Time scale of the fade per group (> 1 gives way sooner): knees first, arms last. */
const GROUP_FADE_RATE: Record<DeathCause, Record<MuscleGroup, number>> = {
  shot: { spine: 1, neck: 1.15, shoulder: 0.9, elbow: 0.9, hip: 1.15, knee: 1.25 },
  generic: { spine: 1, neck: 1.15, shoulder: 0.9, elbow: 0.9, hip: 1.15, knee: 1.25 },
  // The arms keep curling a little longer than the rest (protective).
  ram: { spine: 1, neck: 0.8, shoulder: 0.5, elbow: 0.45, hip: 0.9, knee: 0.9 },
};

/** Small deterministic PRNG (mulberry32) so a death's randomness is reproducible per seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The fade parameters of one death (deterministic per `seed`). */
export function deathFadeFor(cause: DeathCause, seed: number): DeathFade {
  const r = rng(seed);
  const range = FADE_RANGES[cause];
  const start = lerp(range.start[0], range.start[1], r());
  const hold = lerp(range.hold[0], range.hold[1], r());
  const total = lerp(range.total[0], range.total[1], r());
  return { start, hold, fade: Math.max(0.05, total - hold) };
}

/** Global muscle strength `t` seconds after death: hold, then a quadratic ease to exactly 0. */
export function deathStrengthCurve(t: number, f: DeathFade): number {
  if (t <= f.hold) return f.start;
  const u = (t - f.hold) / f.fade;
  if (u >= 1) return 0;
  return f.start * (1 - u) * (1 - u);
}

/** Seconds after which every joint of a `cause` death is at zero strength. */
export function deathEnd(f: DeathFade, cause: DeathCause): number {
  const rates = Object.values(GROUP_FADE_RATE[cause]);
  return (f.hold + f.fade) / Math.min(...rates);
}

/** Strength of one joint `t` s after death; limp (struck) joints are 0 from the start. */
export function jointStrength(joint: JointName, t: number, f: DeathFade, cause: DeathCause, limp: ReadonlySet<JointName>): number {
  if (limp.has(joint)) return 0;
  return deathStrengthCurve(t * GROUP_FADE_RATE[cause][JOINT_GROUP[joint]], f);
}

/** Joints a hit on ragdoll part `bone` leaves limp at once (head shot -> neck, leg shot -> knee...). */
export function limpJointsFor(bone: string | null): JointName[] {
  switch (bone) {
    case "Body":
      return ["hipL", "hipR"];
    case "Abdomen":
      return ["spine"];
    case "Neck":
      return ["neck"];
    case "UpperArmL":
      return ["shoulderL", "elbowL"];
    case "UpperArmR":
      return ["shoulderR", "elbowR"];
    case "LowerArmL":
      return ["elbowL"];
    case "LowerArmR":
      return ["elbowR"];
    case "UpperLegL":
      return ["hipL", "kneeL"];
    case "UpperLegR":
      return ["hipR", "kneeR"];
    case "LowerLegL":
      return ["kneeL"];
    case "LowerLegR":
      return ["kneeR"];
    default:
      return [];
  }
}

/**
 * Internal flexion kick (N·m·s, equal and opposite on thigh and shin) given
 * to a knee when the dying starts. A limp joint has no torque of its own, so
 * a loaded, nearly straight knee would lock at its limit and the body could
 * fold at the hips into a stable "tripod" instead of collapsing; the kick
 * makes the struck knee buckle at once and nudges intact ones.
 */
export const KNEE_BUCKLE = { struck: 4, intact: 1 };

/** Knee flexion kick for a `cause` death; `limp` = this knee was struck. Car rams tumble without it. */
export function kneeBuckleImpulse(cause: DeathCause, limp: boolean): number {
  if (cause === "ram") return 0;
  return limp ? KNEE_BUCKLE.struck : KNEE_BUCKLE.intact;
}

// ---- Protective reflexes ----
/** Delay and rise time (s) of the reflex blend after death. */
const REFLEX_DELAY = 0.04;
const REFLEX_RISE = 0.3;

/** Weight of the protective reflex `t` s after death (smoothstep from 0 to 1). */
export function reflexWeight(t: number): number {
  const u = clamp01((t - REFLEX_DELAY) / REFLEX_RISE);
  return u * u * (3 - 2 * u);
}

export interface JointTarget {
  x: number;
  y: number;
  z: number;
}
export type PoseTargets = Record<JointName, JointTarget>;

export interface ReflexInput {
  /** Blend weight 0..1 (reflexWeight). */
  weight: number;
  /** Fall direction in the chest's frame: + forward / + towards the character's right, each -1..1. */
  fallForward: number;
  fallRight: number;
  /** "brace" (arms catch the fall) or "curl" (car ram: arms protect the head, knees up). */
  mode: "brace" | "curl";
}

// Brace (rad): additive softening on top of the death pose...
const KNEE_SOFTEN = 0.3;
const HIP_SOFTEN = 0.15;
const NECK_TUCK = 0.45;
const SPINE_CURL = 0.2;
// ...and absolute arm targets the arms move towards.
const BRACE_FLEX_FWD = 1.35;
const BRACE_FLEX_NEUTRAL = 0.45;
const BRACE_FLEX_BACK = -0.35;
const BRACE_OUT_BASE = 0.3;
const BRACE_OUT_BACK = 0.5;
const BRACE_OUT_SIDE = 0.8;
const ELBOW_BRACE = 0.35;
// Curl (absolute targets, rad).
const CURL = { spine: 0.4, neck: 0.5, hip: 0.6, knee: 0.9, shoulderFlex: 0.6, shoulderIn: 0.15, elbow: 1.6 };

/**
 * The death-pose targets `base` with the protective reflex blended in by
 * `input.weight`. Returns a new object (the input is not modified); the
 * caller clamps the result to the joint limits (clampTarget).
 */
export function reflexTargets(base: PoseTargets, input: ReflexInput): PoseTargets {
  const out = {} as PoseTargets;
  for (const j of JOINT_NAMES) out[j] = { ...base[j] };
  const w = clamp01(input.weight);
  if (w <= 0) return out;

  if (input.mode === "curl") {
    out.spine.y = lerp(base.spine.y, CURL.spine, w);
    out.neck.y = lerp(base.neck.y, CURL.neck, w);
    for (const side of ["L", "R"] as const) {
      const inward = side === "L" ? CURL.shoulderIn : -CURL.shoulderIn;
      out[`hip${side}`].y = lerp(base[`hip${side}`].y, CURL.hip, w);
      out[`knee${side}`].x = lerp(base[`knee${side}`].x, CURL.knee, w);
      // Untwist the upper arm: per-axis angles couple badly in large combined rotations.
      out[`shoulder${side}`].x = lerp(base[`shoulder${side}`].x, 0, w);
      out[`shoulder${side}`].y = lerp(base[`shoulder${side}`].y, CURL.shoulderFlex, w);
      out[`shoulder${side}`].z = lerp(base[`shoulder${side}`].z, inward, w);
      out[`elbow${side}`].x = lerp(base[`elbow${side}`].x, CURL.elbow, w);
    }
    return out;
  }

  // Fall direction, at most unit length.
  let fwd = input.fallForward;
  let right = input.fallRight;
  const mag = Math.hypot(fwd, right);
  if (mag > 1) {
    fwd /= mag;
    right /= mag;
  }
  out.spine.y += SPINE_CURL * w;
  out.neck.y += NECK_TUCK * w;
  const flex = fwd >= 0 ? lerp(BRACE_FLEX_NEUTRAL, BRACE_FLEX_FWD, fwd) : lerp(BRACE_FLEX_NEUTRAL, BRACE_FLEX_BACK, -fwd);
  for (const side of ["L", "R"] as const) {
    out[`knee${side}`].x += KNEE_SOFTEN * w;
    out[`hip${side}`].y += HIP_SOFTEN * w;
    // The arm on the side the body falls towards reaches out further.
    const toward = side === "L" ? Math.max(0, -right) : Math.max(0, right);
    const outward = BRACE_OUT_BASE + BRACE_OUT_BACK * Math.max(0, -fwd) + BRACE_OUT_SIDE * toward;
    const sh = out[`shoulder${side}`];
    sh.y = lerp(base[`shoulder${side}`].y, flex, w);
    sh.z = lerp(base[`shoulder${side}`].z, side === "L" ? -outward : outward, w);
    out[`elbow${side}`].x = lerp(base[`elbow${side}`].x, ELBOW_BRACE, w);
  }
  return out;
}

/** `t` clamped per axis to `limits` (three ranges for a ball joint, one — X only — for a hinge). */
export function clampTarget(t: JointTarget, limits: readonly (readonly [number, number])[]): JointTarget {
  const c = (v: number, r: readonly [number, number] | undefined) => (r ? Math.min(r[1], Math.max(r[0], v)) : v);
  return { x: c(t.x, limits[0]), y: c(t.y, limits[1]), z: c(t.z, limits[2]) };
}
