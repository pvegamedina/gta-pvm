import { describe, it, expect } from "vitest";
import {
  JOINT_NAMES,
  JOINT_GROUP,
  MUSCLE_TABLE,
  MAX_MOTOR_FORCE,
  JOINT_FRICTION,
  CHAIN_LOAD,
  chainInertia,
  muscleGains,
  deathFadeFor,
  deathStrengthCurve,
  deathEnd,
  jointStrength,
  limpJointsFor,
  kneeBuckleImpulse,
  reflexWeight,
  reflexTargets,
  clampTarget,
  type PoseTargets,
  type JointName,
} from "../muscles";

const ZERO = { x: 0, y: 0, z: 0 };
function basePose(): PoseTargets {
  const p = {} as PoseTargets;
  for (const j of JOINT_NAMES) p[j] = { ...ZERO };
  return p;
}

describe("muscleGains", () => {
  it("returns the table gains at full strength", () => {
    for (const j of JOINT_NAMES) {
      const g = muscleGains(JOINT_GROUP[j], 1)!;
      const t = MUSCLE_TABLE[JOINT_GROUP[j]];
      expect(g.stiffness).toBeCloseTo(t.stiffness, 6);
      expect(g.damping).toBeCloseTo(t.damping, 6);
      expect(g.maxForce).toBeCloseTo(t.maxForce, 6);
    }
  });

  it("goes passive (null: friction motor) at zero or negative strength", () => {
    expect(muscleGains("knee", 0)).toBeNull();
    expect(muscleGains("knee", -1)).toBeNull();
    expect(JOINT_FRICTION).toBeGreaterThan(0);
  });

  it("is monotonic in strength and clamps input above 1", () => {
    let prev = muscleGains("spine", 0.01)!;
    for (let s = 0.1; s <= 1.0001; s += 0.1) {
      const g = muscleGains("spine", s)!;
      expect(g.stiffness).toBeGreaterThanOrEqual(prev.stiffness);
      expect(g.damping).toBeGreaterThanOrEqual(prev.damping);
      expect(g.maxForce).toBeGreaterThanOrEqual(prev.maxForce);
      prev = g;
    }
    expect(muscleGains("spine", 2)!.stiffness).toBeCloseTo(MUSCLE_TABLE.spine.stiffness, 6);
  });

  it("keeps damping from collapsing with stiffness (sqrt scaling)", () => {
    const g = muscleGains("hip", 0.25)!;
    expect(g.stiffness).toBeCloseTo(MUSCLE_TABLE.hip.stiffness * 0.25, 6);
    expect(g.damping).toBeCloseTo(MUSCLE_TABLE.hip.damping * 0.5, 6);
  });

  it("scales stiffness with the chain's inertia (heavier chains get stiffer muscles)", () => {
    expect(MUSCLE_TABLE.spine.stiffness).toBeGreaterThan(MUSCLE_TABLE.shoulder.stiffness);
    expect(MUSCLE_TABLE.knee.stiffness).toBeGreaterThan(MUSCLE_TABLE.elbow.stiffness * 10);
  });

  it("sizes every muscle to hold its chain against gravity, but bounded and well damped", () => {
    for (const group of Object.keys(MUSCLE_TABLE) as (keyof typeof MUSCLE_TABLE)[]) {
      const t = MUSCLE_TABLE[group];
      const load = CHAIN_LOAD[group];
      expect(t.maxForce).toBeGreaterThanOrEqual(2 * load.mass * 9.81 * load.lever);
      expect(t.maxForce).toBeLessThanOrEqual(MAX_MOTOR_FORCE);
      // Under-critical but not springy: zeta = d / (2·sqrt(k·I)).
      const zeta = t.damping / (2 * Math.sqrt(t.stiffness * chainInertia(group)));
      expect(zeta).toBeGreaterThan(0.6);
      expect(zeta).toBeLessThan(1.3);
    }
  });
});

describe("deathStrengthCurve", () => {
  it("starts at partial strength and fades to zero within 1-1.8 s", () => {
    for (let seed = 1; seed < 40; seed++) {
      const f = deathFadeFor("shot", seed);
      expect(deathStrengthCurve(0, f)).toBeCloseTo(f.start, 6);
      expect(f.start).toBeGreaterThan(0.4);
      expect(f.start).toBeLessThan(0.9);
      const end = f.hold + f.fade;
      expect(end).toBeGreaterThanOrEqual(1.0);
      expect(end).toBeLessThanOrEqual(1.8);
      expect(deathStrengthCurve(end, f)).toBe(0);
      expect(deathStrengthCurve(end + 5, f)).toBe(0);
    }
  });

  it("never increases", () => {
    const f = deathFadeFor("generic", 7);
    let prev = Infinity;
    for (let t = 0; t < 2.5; t += 1 / 60) {
      const s = deathStrengthCurve(t, f);
      expect(s).toBeLessThanOrEqual(prev + 1e-12);
      prev = s;
    }
  });

  it("is deterministic per seed and varies between seeds", () => {
    expect(deathFadeFor("shot", 42)).toEqual(deathFadeFor("shot", 42));
    expect(deathFadeFor("shot", 1)).not.toEqual(deathFadeFor("shot", 2));
  });

  it("drops almost instantly for a car ram", () => {
    for (let seed = 1; seed < 20; seed++) {
      const f = deathFadeFor("ram", seed);
      expect(f.start).toBeLessThan(0.5);
      expect(f.hold + f.fade).toBeLessThan(0.5);
    }
  });
});

describe("jointStrength", () => {
  const f = deathFadeFor("shot", 3);

  it("is zero for limp (struck) joints from the first step", () => {
    const limp = new Set<JointName>(["neck"]);
    expect(jointStrength("neck", 0, f, "shot", limp)).toBe(0);
    expect(jointStrength("spine", 0, f, "shot", limp)).toBeGreaterThan(0.4);
  });

  it("gives way at the knees before the arms", () => {
    const none = new Set<JointName>();
    const t = (f.hold + f.fade) * 0.5;
    expect(jointStrength("kneeL", t, f, "shot", none)).toBeLessThan(jointStrength("elbowL", t, f, "shot", none));
    expect(jointStrength("hipR", t, f, "shot", none)).toBeLessThan(jointStrength("shoulderR", t, f, "shot", none));
  });

  it("reaches zero everywhere by deathEnd()", () => {
    const none = new Set<JointName>();
    for (const cause of ["shot", "generic", "ram"] as const) {
      const fc = deathFadeFor(cause, 9);
      const end = deathEnd(fc, cause);
      for (const j of JOINT_NAMES) expect(jointStrength(j, end, fc, cause, none)).toBe(0);
      expect(JOINT_NAMES.some((j) => jointStrength(j, end - 0.05, fc, cause, none) > 0)).toBe(true);
    }
  });
});

describe("limpJointsFor", () => {
  it("snaps the neck loose for a head hit", () => {
    expect(limpJointsFor("Neck")).toEqual(["neck"]);
  });

  it("buckles the knee for a shin hit and the whole leg for a thigh hit", () => {
    expect(limpJointsFor("LowerLegL")).toEqual(["kneeL"]);
    expect(limpJointsFor("UpperLegR").sort()).toEqual(["hipR", "kneeR"]);
  });

  it("drops the legs for a pelvis hit and folds the spine for a chest hit", () => {
    expect(limpJointsFor("Body").sort()).toEqual(["hipL", "hipR"]);
    expect(limpJointsFor("Abdomen")).toEqual(["spine"]);
  });

  it("returns nothing for unknown parts", () => {
    expect(limpJointsFor("Hand")).toEqual([]);
    expect(limpJointsFor(null)).toEqual([]);
  });
});

describe("kneeBuckleImpulse", () => {
  it("kicks a struck knee harder than an intact one, and never for a car ram", () => {
    expect(kneeBuckleImpulse("shot", true)).toBeGreaterThan(kneeBuckleImpulse("shot", false));
    expect(kneeBuckleImpulse("generic", false)).toBeGreaterThan(0);
    expect(kneeBuckleImpulse("ram", true)).toBe(0);
    expect(kneeBuckleImpulse("ram", false)).toBe(0);
  });
});

describe("reflexWeight", () => {
  it("rises from 0 to 1 shortly after death", () => {
    expect(reflexWeight(0)).toBe(0);
    expect(reflexWeight(0.1)).toBeGreaterThan(0);
    expect(reflexWeight(0.1)).toBeLessThan(1);
    expect(reflexWeight(1)).toBe(1);
  });
});

describe("reflexTargets", () => {
  it("returns the base pose at weight 0", () => {
    const base = basePose();
    base.kneeL.x = 0.2;
    const out = reflexTargets(base, { weight: 0, fallForward: 1, fallRight: 0, mode: "brace" });
    expect(out).toEqual(base);
  });

  it("does not mutate its input", () => {
    const base = basePose();
    const copy = JSON.parse(JSON.stringify(base));
    reflexTargets(base, { weight: 1, fallForward: 1, fallRight: 0, mode: "brace" });
    expect(base).toEqual(copy);
  });

  it("softens the knees, tucks the head and curls the spine while bracing", () => {
    const base = basePose();
    const out = reflexTargets(base, { weight: 1, fallForward: 0, fallRight: 0, mode: "brace" });
    expect(out.kneeL.x).toBeGreaterThan(0.2);
    expect(out.kneeR.x).toBeGreaterThan(0.2);
    expect(out.neck.y).toBeGreaterThan(0.2);
    expect(out.spine.y).toBeGreaterThan(0.05);
  });

  it("puts the arms forward when falling forward and back/out when falling backward", () => {
    const base = basePose();
    const fwd = reflexTargets(base, { weight: 1, fallForward: 1, fallRight: 0, mode: "brace" });
    const back = reflexTargets(base, { weight: 1, fallForward: -1, fallRight: 0, mode: "brace" });
    expect(fwd.shoulderL.y).toBeGreaterThan(1.0);
    expect(fwd.shoulderR.y).toBeGreaterThan(1.0);
    expect(back.shoulderL.y).toBeLessThan(fwd.shoulderL.y - 0.8);
    // Outward = -Z on the left arm, +Z on the right one.
    expect(back.shoulderL.z).toBeLessThan(fwd.shoulderL.z);
    expect(back.shoulderR.z).toBeGreaterThan(fwd.shoulderR.z);
    // Elbows slightly bent.
    expect(fwd.elbowL.x).toBeGreaterThan(0.15);
    expect(fwd.elbowL.x).toBeLessThan(0.7);
  });

  it("reaches out with the arm on the side of the fall", () => {
    const base = basePose();
    const toRight = reflexTargets(base, { weight: 1, fallForward: 0, fallRight: 1, mode: "brace" });
    expect(toRight.shoulderR.z).toBeGreaterThan(Math.abs(toRight.shoulderL.z));
    const toLeft = reflexTargets(base, { weight: 1, fallForward: 0, fallRight: -1, mode: "brace" });
    expect(-toLeft.shoulderL.z).toBeGreaterThan(Math.abs(toLeft.shoulderR.z));
  });

  it("curls up (arms protecting the head, knees up) for a car ram", () => {
    const base = basePose();
    const out = reflexTargets(base, { weight: 1, fallForward: 0, fallRight: 0, mode: "curl" });
    expect(out.elbowL.x).toBeGreaterThan(1.0);
    expect(out.elbowR.x).toBeGreaterThan(1.0);
    expect(out.hipL.y).toBeGreaterThan(0.5);
    expect(out.kneeR.x).toBeGreaterThan(0.8);
    expect(out.spine.y).toBeGreaterThan(0.3);
    // Arms come inward (towards the midline).
    expect(out.shoulderL.z).toBeGreaterThan(0);
    expect(out.shoulderR.z).toBeLessThan(0);
  });

  it("interpolates with the weight", () => {
    const base = basePose();
    const half = reflexTargets(base, { weight: 0.5, fallForward: 1, fallRight: 0, mode: "brace" });
    const full = reflexTargets(base, { weight: 1, fallForward: 1, fallRight: 0, mode: "brace" });
    expect(half.shoulderL.y).toBeCloseTo(full.shoulderL.y / 2, 6);
  });
});

describe("clampTarget", () => {
  it("keeps each axis inside its limits", () => {
    const out = clampTarget({ x: 3, y: -3, z: 0.1 }, [[-1, 1], [-0.5, 0.5], [-0.2, 0.2]]);
    expect(out).toEqual({ x: 1, y: -0.5, z: 0.1 });
  });

  it("clamps only X for a hinge (single range)", () => {
    const out = clampTarget({ x: -0.3, y: 9, z: 9 }, [[0, 2.4]]);
    expect(out.x).toBe(0);
  });
});
