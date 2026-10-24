// Full local-transform (position, rotation, scale) snapshot of a set of bones.
// The ragdoll (physics/ragdoll.ts) writes position AND scale on the bones it
// drives, while the AnimationMixer only rewrites the channels a clip has
// tracks for (leg bones: rotation only; Root and Hips: nothing at all). A rig
// that goes ragdoll -> animation again would keep a stale pose, so modelRig
// restores this bind snapshot before every mixer update (rotation-only
// snapshots for the arms live in upperBodyPose.ts PoseSnapshot).

import * as THREE from "three";

/** Bones of `root` named `names` (three.js "WristR" or Blender "Wrist.R" spelling); missing ones are skipped. */
export function findBones(root: THREE.Object3D, names: readonly string[]): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  for (const n of names) {
    const b = root.getObjectByName(n) ?? root.getObjectByName(n.replace(/\.([LR])$/, "$1")) ?? root.getObjectByName(n.replace(/([LR])$/, ".$1"));
    if (b && !out.includes(b)) out.push(b);
  }
  return out;
}

export class BoneTransformSnapshot {
  private readonly pos: THREE.Vector3[];
  private readonly rot: THREE.Quaternion[];
  private readonly scl: THREE.Vector3[];
  private saved = false;

  constructor(private readonly bones: readonly THREE.Object3D[]) {
    this.pos = bones.map(() => new THREE.Vector3());
    this.rot = bones.map(() => new THREE.Quaternion());
    this.scl = bones.map(() => new THREE.Vector3(1, 1, 1));
  }

  get size(): number {
    return this.bones.length;
  }

  /** Remembers the bones' current local transforms. */
  save(): void {
    this.bones.forEach((b, i) => {
      this.pos[i].copy(b.position);
      this.rot[i].copy(b.quaternion);
      this.scl[i].copy(b.scale);
    });
    this.saved = true;
  }

  /** Writes the saved local transforms back (no-op before save()). World matrices are NOT refreshed. */
  restore(): void {
    if (!this.saved) return;
    this.bones.forEach((b, i) => {
      b.position.copy(this.pos[i]);
      b.quaternion.copy(this.rot[i]);
      b.scale.copy(this.scl[i]);
    });
  }
}
