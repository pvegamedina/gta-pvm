// Curated raycast target registry: only objects that can be hit by gunfire are
// in here (not the whole scene graph), keeping Raycaster.intersectObjects cheap.

import * as THREE from "three";

export type ShootableKind = "building" | "vehicle" | "ped" | "remotePlayer" | "remoteCar";

export interface ShootableMeta {
  kind: ShootableKind;
  /** string id for network-addressable targets (remote players/cars), or a direct object ref for local-only ones (peds/vehicles/buildings). */
  refId: string | number | unknown;
}

export class ShootableRegistry {
  private objects: THREE.Object3D[] = [];
  private meta = new Map<THREE.Object3D, ShootableMeta>();

  add(obj: THREE.Object3D, meta: ShootableMeta): void {
    this.objects.push(obj);
    this.meta.set(obj, meta);
  }

  remove(obj: THREE.Object3D): void {
    const i = this.objects.indexOf(obj);
    if (i >= 0) this.objects.splice(i, 1);
    this.meta.delete(obj);
  }

  list(): THREE.Object3D[] {
    return this.objects;
  }

  metaFor(obj: THREE.Object3D | null): ShootableMeta | null {
    let o = obj;
    while (o) {
      const m = this.meta.get(o);
      if (m) return m;
      o = o.parent;
    }
    return null;
  }
}

export interface RaycastShotResult {
  point: THREE.Vector3;
  hit: ShootableMeta | null;
  distance: number;
}

const raycaster = new THREE.Raycaster();

export function castShot(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  range: number,
  registry: ShootableRegistry,
  minDistance: number,
): RaycastShotResult {
  raycaster.set(origin, dir);
  raycaster.far = range;
  raycaster.near = Math.max(0.01, minDistance);
  const hits = raycaster.intersectObjects(registry.list(), true);
  if (hits.length > 0) {
    const h = hits[0];
    return { point: h.point.clone(), hit: registry.metaFor(h.object), distance: h.distance };
  }
  const end = origin.clone().addScaledVector(dir, range);
  return { point: end, hit: null, distance: range };
}
