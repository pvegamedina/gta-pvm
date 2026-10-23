import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { ShootableRegistry, castShot } from "../shootables";

// Regression test: remote players carry name/health THREE.Sprite tags nested
// inside their shootable group (see net/remotePlayers.ts). THREE.Sprite's
// raycast() unconditionally dereferences `raycaster.camera.matrixWorld`
// (three's own null-guard doesn't `return`), so any raycast against a group
// containing a Sprite throws unless `raycaster.camera` is set first. That
// throw used to happen inside fireWeapon(), before net.send({t:"shoot"}) —
// so shots never reached the server whenever a remote player was nearby.
describe("castShot", () => {
  it("does not throw when a shootable group contains a Sprite (name/health tag)", () => {
    const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 1000);
    camera.position.set(0, 1.6, 0);
    camera.lookAt(0, 1.6, 10);
    camera.updateMatrixWorld(true);

    const registry = new ShootableRegistry();
    const group = new THREE.Group();
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial());
    sprite.position.set(0, 2.25, 10);
    group.add(sprite);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.5));
    body.position.set(0, 1, 10);
    group.add(body);
    group.updateMatrixWorld(true);
    registry.add(group, { kind: "remotePlayer", refId: "b" });

    const origin = camera.position.clone();
    const dir = camera.getWorldDirection(new THREE.Vector3());

    expect(() => castShot(origin, dir, 140, registry, 0.3, camera)).not.toThrow();
    const res = castShot(origin, dir, 140, registry, 0.3, camera);
    expect(res.hit?.kind).toBe("remotePlayer");
    expect(res.hit?.refId).toBe("b");
  });
});
