// Raycast helpers for characters: an invisible box proxy that castShot() hits
// instead of the (expensive, wrongly-bounded) skinned meshes. THREE.Raycaster
// does not skip invisible objects, but it stops descending into a subtree when
// an object's raycast() returns false — both facts are used here.

import * as THREE from "three";

/** Proxy box dimensions (m): roughly shoulder width x standing height x chest depth. */
export const HITBOX_SIZE = { width: 0.55, height: 1.85, depth: 0.42 } as const;

const hitboxGeometry = new THREE.BoxGeometry(HITBOX_SIZE.width, HITBOX_SIZE.height, HITBOX_SIZE.depth);
hitboxGeometry.translate(0, HITBOX_SIZE.height / 2, 0);
const hitboxMaterial = new THREE.MeshBasicMaterial();

/** Invisible (never rendered) box standing on the character's origin; still raycastable. */
export function createHitbox(): THREE.Mesh {
  const m = new THREE.Mesh(hitboxGeometry, hitboxMaterial);
  m.name = "hitbox";
  m.visible = false;
  return m;
}

/** Makes `obj` and its whole subtree invisible to raycasts. */
export function excludeFromRaycast(obj: THREE.Object3D): void {
  obj.raycast = () => false;
}

/** Makes `group`'s subtree unhittable while the group itself is hidden. */
export function pruneRaycastWhenHidden(group: THREE.Object3D): void {
  group.raycast = function (this: THREE.Object3D) {
    return this.visible ? undefined : false;
  } as THREE.Object3D["raycast"];
}
