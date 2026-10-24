import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  basisFromXY,
  twistFrame,
  hingeFrame,
  segmentCapsule,
  worldToLocal,
  perpComponent,
  frameAngles,
  widenLimits,
} from "../ragdollMath";

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

function axis(q: THREE.Quaternion, v: THREE.Vector3): THREE.Vector3 {
  return v.clone().applyQuaternion(q);
}

describe("basisFromXY", () => {
  it("returns identity for the world axes", () => {
    const q = basisFromXY(X, Y, new THREE.Quaternion());
    expect(q.angleTo(new THREE.Quaternion())).toBeCloseTo(0, 6);
  });

  it("keeps X exact and orthonormalizes a skewed Y", () => {
    const x = new THREE.Vector3(0, 0, 1);
    const y = new THREE.Vector3(0.3, 1, 0.2); // not perpendicular to x
    const q = basisFromXY(x, y, new THREE.Quaternion());
    expect(axis(q, X).distanceTo(x)).toBeCloseTo(0, 6);
    const yOut = axis(q, Y);
    expect(yOut.dot(x)).toBeCloseTo(0, 6);
    expect(yOut.y).toBeGreaterThan(0.9);
    // Right-handed: Z = X x Y.
    expect(axis(q, Z).distanceTo(new THREE.Vector3().crossVectors(x, yOut))).toBeCloseTo(0, 6);
  });
});

describe("twistFrame (spherical joints)", () => {
  it("puts the twist on X and makes +Y rotation bend X towards the flex direction", () => {
    const down = new THREE.Vector3(0, -1, 0);
    const forward = new THREE.Vector3(0, 0, 1);
    const q = twistFrame(down, forward, new THREE.Quaternion());
    expect(axis(q, X).distanceTo(down)).toBeCloseTo(0, 6);
    // Rotating the frame's X about the frame's Y by a small +angle moves it forward.
    const bent = down.clone().applyAxisAngle(axis(q, Y), 0.3);
    expect(bent.z).toBeGreaterThan(0.25);
  });
});

describe("hingeFrame (revolute joints)", () => {
  it("puts the hinge on X and the segment on Y", () => {
    const hinge = new THREE.Vector3(1, 0, 0);
    const dir = new THREE.Vector3(0, -1, 0.1);
    const q = hingeFrame(hinge, dir, new THREE.Quaternion());
    expect(axis(q, X).distanceTo(hinge)).toBeCloseTo(0, 6);
    expect(axis(q, Y).dot(dir.clone().normalize())).toBeGreaterThan(0.99);
  });
});

describe("segmentCapsule", () => {
  it("spans exactly the segment length including both caps", () => {
    const c = segmentCapsule(0.42, 0.07);
    expect(c.halfHeight * 2 + 0.07 * 2).toBeCloseTo(0.42, 6);
    expect(c.centerY).toBeCloseTo(0.21, 6);
  });

  it("never returns a degenerate (non-positive) half height for short bones", () => {
    const c = segmentCapsule(0.05, 0.08);
    expect(c.halfHeight).toBeGreaterThan(0);
  });
});

describe("worldToLocal", () => {
  it("inverts the parent transform so parent * local == desired world", () => {
    const parent = new THREE.Matrix4().compose(
      new THREE.Vector3(1, 2, 3),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.7, 0.2)),
      new THREE.Vector3(1, 1, 1),
    );
    const desired = new THREE.Matrix4().compose(
      new THREE.Vector3(-0.5, 1.1, 4),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.1, 0.4, 0.9)),
      new THREE.Vector3(1, 1, 1),
    );
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    worldToLocal(parent, desired, pos, quat, scale);
    const local = new THREE.Matrix4().compose(pos, quat, scale);
    const back = parent.clone().multiply(local);
    for (let i = 0; i < 16; i++) expect(back.elements[i]).toBeCloseTo(desired.elements[i], 5);
  });

  it("handles scaled parents (armature scale) without leaking the scale into rotation", () => {
    const parent = new THREE.Matrix4().compose(new THREE.Vector3(), new THREE.Quaternion(), new THREE.Vector3(0.01, 0.01, 0.01));
    const desired = new THREE.Matrix4().compose(new THREE.Vector3(1, 0, 0), new THREE.Quaternion(), new THREE.Vector3(0.01, 0.01, 0.01));
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    worldToLocal(parent, desired, pos, quat, scale);
    expect(pos.x).toBeCloseTo(100, 4);
    expect(scale.x).toBeCloseTo(1, 6);
    expect(quat.angleTo(new THREE.Quaternion())).toBeCloseTo(0, 6);
  });
});

describe("perpComponent", () => {
  it("removes the component along the axis", () => {
    const out = perpComponent(new THREE.Vector3(1, 2, 3), new THREE.Vector3(0, 1, 0), new THREE.Vector3());
    expect(out.toArray()).toEqual([1, 0, 3]);
  });
});

describe("frameAngles", () => {
  it("reads zero for coinciding frames", () => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 1, -0.3));
    const a = frameAngles(q, q.clone());
    expect(a.x).toBeCloseTo(0, 6);
    expect(a.y).toBeCloseTo(0, 6);
    expect(a.z).toBeCloseTo(0, 6);
  });

  it("reads a single-axis rotation of frame 2 relative to frame 1 (right-handed, in frame 1)", () => {
    const f1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.8);
    const rel = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.5);
    const f2 = f1.clone().multiply(rel);
    const a = frameAngles(f1, f2);
    expect(a.x).toBeCloseTo(0.5, 5);
    expect(a.y).toBeCloseTo(0, 5);
    expect(a.z).toBeCloseTo(0, 5);
  });
});

describe("widenLimits", () => {
  it("keeps limits that already contain the value", () => {
    expect(widenLimits([-0.5, 0.5], 0.1, 0.05)).toEqual([-0.5, 0.5]);
  });

  it("widens just past an out-of-range starting angle so the joint does not snap", () => {
    const [lo, hi] = widenLimits([0, 2.4], -0.3, 0.05);
    expect(lo).toBeCloseTo(-0.35, 6);
    expect(hi).toBe(2.4);
  });
});
