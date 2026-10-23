import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { ShootableRegistry, castShot } from "../../combat/shootables";
import { createHitbox, excludeFromRaycast, pruneRaycastWhenHidden, HITBOX_SIZE } from "../hitbox";

// Characters are skinned meshes whose bind-pose bounds don't follow the
// animation, so shots must hit an invisible proxy box instead of the visuals.
function scene() {
  const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 1000);
  camera.position.set(0, 1.2, 0);
  camera.lookAt(0, 1.2, 10);
  camera.updateMatrixWorld(true);

  const group = new THREE.Group();
  group.position.set(0, 0, 10);
  const hitbox = createHitbox();
  group.add(hitbox);
  // A "visual" mesh sticking out in front of the hitbox: it must be ignored.
  const visual = new THREE.Group();
  const limb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 2));
  limb.position.set(0, 1.2, -1.5);
  visual.add(limb);
  excludeFromRaycast(visual);
  group.add(visual);
  pruneRaycastWhenHidden(group);
  group.updateMatrixWorld(true);

  const registry = new ShootableRegistry();
  registry.add(group, { kind: "ped", refId: "p1" });
  const origin = camera.position.clone();
  const dir = camera.getWorldDirection(new THREE.Vector3());
  return { camera, group, hitbox, registry, origin, dir };
}

describe("character hitbox", () => {
  it("is invisible but still hit by castShot, and reports the owning shootable", () => {
    const { camera, hitbox, registry, origin, dir } = scene();
    expect(hitbox.visible).toBe(false);
    const res = castShot(origin, dir, 100, registry, 0.3, camera);
    expect(res.hit?.refId).toBe("p1");
    // Front face of the box, not the visual limb sticking out towards the camera.
    expect(res.distance).toBeCloseTo(10 - HITBOX_SIZE.depth / 2, 3);
  });

  it("spans a standing human's height", () => {
    const { hitbox } = scene();
    const box = new THREE.Box3().setFromObject(hitbox);
    expect(box.min.y).toBeLessThanOrEqual(0.05);
    expect(box.max.y).toBeGreaterThanOrEqual(1.75);
  });

  it("cannot be shot while its character is hidden (in a car, despawned)", () => {
    const { camera, group, registry, origin, dir } = scene();
    group.visible = false;
    expect(castShot(origin, dir, 100, registry, 0.3, camera).hit).toBeNull();
  });
});
