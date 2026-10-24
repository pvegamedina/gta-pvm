// How a car sits on uneven ground: ride height from the four wheel contact
// points, and the body pitch/roll (in the convention of Vehicle.body, whose
// parent is yawed: rotation.x > 0 drops the nose, rotation.z > 0 raises the
// car's local +x side) from the height differences between axles / sides.

export interface TerrainPose {
  /** Ground height under the car's centre (mean of the wheel contacts). */
  y: number;
  /** Body rotation.x (rad). */
  pitch: number;
  /** Body rotation.z (rad). */
  roll: number;
}

/**
 * `halfL` is half the wheelbase (front/rear axle distance from the centre),
 * `halfW` half the track width. Forward is (sin yaw, cos yaw); local +x is
 * (cos yaw, -sin yaw).
 */
export function terrainPose(
  height: (x: number, z: number) => number,
  x: number,
  z: number,
  yaw: number,
  halfL: number,
  halfW: number,
  out: TerrainPose = { y: 0, pitch: 0, roll: 0 },
): TerrainPose {
  const fx = Math.sin(yaw) * halfL;
  const fz = Math.cos(yaw) * halfL;
  const sx = Math.cos(yaw) * halfW;
  const sz = -Math.sin(yaw) * halfW;
  const frontL = height(x + fx + sx, z + fz + sz);
  const frontR = height(x + fx - sx, z + fz - sz);
  const rearL = height(x - fx + sx, z - fz + sz);
  const rearR = height(x - fx - sx, z - fz - sz);
  const front = (frontL + frontR) / 2;
  const rear = (rearL + rearR) / 2;
  const plusX = (frontL + rearL) / 2;
  const minusX = (frontR + rearR) / 2;
  out.y = (front + rear) / 2;
  // Nose up (uphill) is a negative rotation.x.
  out.pitch = -Math.atan2(front - rear, 2 * halfL);
  out.roll = Math.atan2(plusX - minusX, 2 * halfW);
  return out;
}
