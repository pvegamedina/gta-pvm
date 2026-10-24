// Analytic two-bone inverse kinematics (shoulder-elbow-wrist): given the
// root joint, both bone lengths, a target for the end joint and a pole hint
// for the middle joint (where the elbow should point), returns the middle and
// end joint positions. Pure math on plain {x, y, z} objects (no THREE) so it
// is unit-tested; characters/upperBodyPose.ts turns the joint positions into
// bone rotations.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface TwoBoneSolution {
  /** Middle joint (elbow) position. */
  mid: Vec3;
  /** End joint (wrist) position: the target when reachable, else the closest reachable point. */
  end: Vec3;
  /** False when the target was out of reach (too far, or closer than the bones can fold). */
  reached: boolean;
}

/** Keeps the chain off the exact straight/folded singularities (m). */
const EPS = 1e-6;

/**
 * Solves the triangle root-mid-end with |mid-root| = `upper`,
 * |end-mid| = `lower`, end as close to `target` as possible and the bend
 * (mid) on the side of the `pole` point, in the plane of root, target and pole.
 */
export function solveTwoBoneIK(root: Vec3, upper: number, lower: number, target: Vec3, pole: Vec3): TwoBoneSolution {
  // Axis root -> target (any direction when the target sits on the root).
  let ax = target.x - root.x;
  let ay = target.y - root.y;
  let az = target.z - root.z;
  let d = Math.hypot(ax, ay, az);
  if (d < 1e-9) {
    ax = 0;
    ay = 0;
    az = 1;
    d = 0;
  } else {
    ax /= d;
    ay /= d;
    az /= d;
  }
  const minD = Math.abs(upper - lower) + EPS;
  const maxD = upper + lower - EPS;
  const reached = d >= minD && d <= maxD;
  const dc = Math.min(maxD, Math.max(minD, d));

  // Bend direction: the pole's offset from the axis, made perpendicular to it.
  let bx = pole.x - root.x;
  let by = pole.y - root.y;
  let bz = pole.z - root.z;
  let k = bx * ax + by * ay + bz * az;
  bx -= ax * k;
  by -= ay * k;
  bz -= az * k;
  let bl = Math.hypot(bx, by, bz);
  if (bl < 1e-9) {
    // Pole on the axis: bend towards whichever world axis is least aligned with it.
    const ux = Math.abs(ax) < 0.9 ? 1 : 0;
    const uy = ux ? 0 : 1;
    k = ux * ax + uy * ay;
    bx = ux - ax * k;
    by = uy - ay * k;
    bz = -az * k;
    bl = Math.hypot(bx, by, bz);
  }
  bx /= bl;
  by /= bl;
  bz /= bl;

  // Law of cosines for the angle at the root.
  const cosA = Math.min(1, Math.max(-1, (upper * upper + dc * dc - lower * lower) / (2 * upper * dc)));
  const along = upper * cosA;
  const out = upper * Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const mid = { x: root.x + ax * along + bx * out, y: root.y + ay * along + by * out, z: root.z + az * along + bz * out };
  const end = reached ? { x: target.x, y: target.y, z: target.z } : { x: root.x + ax * dc, y: root.y + ay * dc, z: root.z + az * dc };
  return { mid, end, reached };
}
