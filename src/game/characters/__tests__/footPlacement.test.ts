import { describe, it, expect } from "vitest";
import { FootLock, FOOT_IK, footTilt, pelvisOffset, stanceWeight } from "../footPlacement";

describe("pelvisOffset", () => {
  it("is zero on flat ground", () => {
    expect(pelvisOffset(0, 0)).toBe(0);
  });

  it("drops the pelvis by the lower foot's ground delta (slopes, kerbs)", () => {
    expect(pelvisOffset(-0.12, 0.05)).toBeCloseTo(-0.12, 9);
    expect(pelvisOffset(0.1, -0.03)).toBeCloseTo(-0.03, 9);
  });

  it("raises the whole body when both feet stand above the root (visual surface lift)", () => {
    expect(pelvisOffset(0.16, 0.06)).toBeCloseTo(0.06, 9);
  });

  it("is clamped both ways", () => {
    expect(pelvisOffset(-3, 0)).toBeCloseTo(-FOOT_IK.maxPelvisDrop, 9);
    expect(pelvisOffset(2, 2)).toBeCloseTo(FOOT_IK.maxPelvisRaise, 9);
  });
});

describe("footTilt", () => {
  it("does not tilt on flat ground", () => {
    const t = footTilt(0, 1, 0);
    expect(t.angle).toBeCloseTo(0, 9);
  });

  it("tilts about the horizontal axis up x normal by the slope angle", () => {
    // Ground rising towards +X: the normal leans to -X.
    const a = 0.3;
    const t = footTilt(-Math.sin(a), Math.cos(a), 0);
    expect(t.angle).toBeCloseTo(a, 9);
    // up x n = (nz, 0, -nx) -> +Z axis (rotating +Y towards -X).
    expect(t.ax).toBeCloseTo(0, 9);
    expect(t.az).toBeCloseTo(1, 9);
  });

  it("caps steep slopes", () => {
    const t = footTilt(-Math.sin(1.2), Math.cos(1.2), 0);
    expect(t.angle).toBeCloseTo(FOOT_IK.maxFootTilt, 9);
  });
});

describe("stanceWeight", () => {
  it("is 1 on the ground and 0 high in the swing, continuous in between", () => {
    expect(stanceWeight(0.02)).toBe(1);
    expect(stanceWeight(0.3)).toBe(0);
    for (let h = 0; h < 0.3; h += 0.005) expect(Math.abs(stanceWeight(h + 0.005) - stanceWeight(h))).toBeLessThan(0.1);
  });
});

describe("FootLock", () => {
  const DT = 1 / 60;

  it("pins a planted foot in world space while the animation slides it", () => {
    const f = new FootLock();
    const out = { x: 0, z: 0 };
    f.update(DT, 1, 2, 0.02, true, out);
    expect(f.locked).toBe(true);
    for (let i = 1; i <= 6; i++) {
      f.update(DT, 1, 2 + i * 0.02, 0.02, true, out);
      expect(out.x).toBeCloseTo(1, 9);
      expect(out.z).toBeCloseTo(2, 9);
    }
  });

  it("releases when the foot lifts and blends back to the animation over the release time", () => {
    const f = new FootLock();
    const out = { x: 0, z: 0 };
    f.update(DT, 0, 0, 0.02, true, out);
    f.update(DT, 0, 0.1, 0.2, true, out); // lifted: start releasing
    expect(f.locked).toBe(false);
    expect(out.z).toBeGreaterThan(0);
    expect(out.z).toBeLessThan(0.1);
    let prev = out.z;
    for (let t = 0; t < FOOT_IK.lockRelease + DT; t += DT) {
      f.update(DT, 0, 0.1, 0.2, true, out);
      expect(out.z).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = out.z;
    }
    expect(out.z).toBeCloseTo(0.1, 9);
  });

  it("uses hysteresis: a foot hovering between the thresholds stays locked", () => {
    const f = new FootLock();
    const out = { x: 0, z: 0 };
    f.update(DT, 0, 0, 0.02, true, out);
    f.update(DT, 0, 0.01, (FOOT_IK.contactEnter + FOOT_IK.contactExit) / 2, true, out);
    expect(f.locked).toBe(true);
  });

  it("lets go when the animation drifts too far from the pin (no stretched legs)", () => {
    const f = new FootLock();
    const out = { x: 0, z: 0 };
    f.update(DT, 0, 0, 0.02, true, out);
    f.update(DT, 0, FOOT_IK.maxLockDrift + 0.05, 0.02, true, out);
    expect(f.locked).toBe(false);
  });

  it("does nothing while disabled and drops a teleported pin at once", () => {
    const f = new FootLock();
    const out = { x: 0, z: 0 };
    f.update(DT, 3, 4, 0.02, false, out);
    expect(f.locked).toBe(false);
    expect(out.x).toBe(3);
    f.update(DT, 0, 0, 0.02, true, out);
    f.update(DT, 50, 0, 0.02, true, out);
    expect(out.x).toBe(50);
  });
});
