import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { terrainPose } from "../terrainPose";

describe("terrainPose", () => {
  it("is level at the ground height on flat terrain", () => {
    const p = terrainPose(() => 7, 3, 4, 1.2, 1.4, 0.8);
    expect(p.y).toBeCloseTo(7, 6);
    expect(p.pitch).toBeCloseTo(0, 6);
    expect(p.roll).toBeCloseTo(0, 6);
  });

  it("averages the wheel contact heights", () => {
    // Rises along +z (yaw 0 = facing +z): front wheels higher than rear ones.
    const p = terrainPose((_x, z) => 0.1 * z, 0, 10, 0, 1.5, 0.8);
    expect(p.y).toBeCloseTo(1, 6);
  });

  /** Car-local forward and right points after applying the pose as the body rotation. */
  function tilted(yaw: number, pitch: number, roll: number) {
    const root = new THREE.Object3D();
    root.rotation.y = yaw;
    const body = new THREE.Object3D();
    body.rotation.x = pitch;
    body.rotation.z = roll;
    root.add(body);
    root.updateMatrixWorld(true);
    const nose = body.localToWorld(new THREE.Vector3(0, 0, 1));
    const left = body.localToWorld(new THREE.Vector3(1, 0, 0));
    return { nose, left };
  }

  for (const yaw of [0, Math.PI / 2, 2.3, -1]) {
    it(`pitches the nose up when driving uphill (yaw ${yaw})`, () => {
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      // Ground rising 0.2 m per metre along the car's heading.
      const h = (x: number, z: number) => 0.2 * (x * fx + z * fz);
      const p = terrainPose(h, 0, 0, yaw, 1.5, 0.8);
      const { nose } = tilted(yaw, p.pitch, p.roll);
      expect(nose.y).toBeCloseTo(Math.sin(Math.atan(0.2)), 3);
      expect(p.roll).toBeCloseTo(0, 6);
    });

    it(`rolls so the car's local +x side follows a cross slope (yaw ${yaw})`, () => {
      // Local +x of the car in world space.
      const lx = Math.cos(yaw);
      const lz = -Math.sin(yaw);
      const h = (x: number, z: number) => 0.15 * (x * lx + z * lz);
      const p = terrainPose(h, 0, 0, yaw, 1.5, 0.8);
      const { left } = tilted(yaw, p.pitch, p.roll);
      expect(left.y).toBeCloseTo(Math.sin(Math.atan(0.15)), 3);
      expect(p.pitch).toBeCloseTo(0, 6);
    });
  }
});
