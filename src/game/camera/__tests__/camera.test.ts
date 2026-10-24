import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { createCameraState, snapCamera, updateCamera, cameraRight } from "../camera";
import type { CollisionGrid } from "../../world/colliders";
import type { PlayerState } from "../../player/playerState";

const emptyGrid = { each: () => {} } as unknown as CollisionGrid;

function aimingPlayer(yaw: number): PlayerState {
  return { x: 10, y: 0.25, z: -4, yaw, mode: "foot", car: null, aiming: true } as unknown as PlayerState;
}

/** Runs the camera long enough to settle and returns the player's chest in NDC. */
function chestOnScreen(yaw: number, aiming: boolean): THREE.Vector3 {
  const cam = createCameraState(yaw);
  const player = aimingPlayer(yaw);
  player.aiming = aiming;
  snapCamera(cam, player);
  const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.5, 2500);
  for (let i = 0; i < 240; i++) updateCamera(cam, camera, player, 1 / 60, i / 60, emptyGrid);
  camera.updateMatrixWorld(true);
  return new THREE.Vector3(player.x, player.y + 1.3, player.z).project(camera);
}

describe("cameraRight", () => {
  it("is the screen-right direction for a camera looking along the yaw (forward = +Z at yaw 0)", () => {
    const r = cameraRight(0);
    expect(r.x).toBeCloseTo(-1, 6);
    expect(r.z).toBeCloseTo(0, 6);
    const r2 = cameraRight(Math.PI / 2); // facing +X => right = forward x up = +Z
    expect(r2.x).toBeCloseTo(0, 6);
    expect(r2.z).toBeCloseTo(1, 6);
  });
});

describe("over-the-shoulder aim camera", () => {
  for (const yaw of [0, 1.1, -2.4]) {
    it(`sits over the RIGHT shoulder: the character is on the left of the screen (yaw ${yaw})`, () => {
      const p = chestOnScreen(yaw, true);
      expect(p.x).toBeLessThan(-0.1);
      expect(p.z).toBeLessThan(1); // in front of the camera
    });
  }

  it("keeps the character centred when not aiming", () => {
    const p = chestOnScreen(0.6, false);
    expect(Math.abs(p.x)).toBeLessThan(0.05);
  });
});
