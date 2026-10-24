// One InstancedMesh for many static instances spread over the campus that
// only draws the ones in a distance band around the camera focus [near, far):
// the instance buffer is compacted whenever the focus has moved a few
// metres. Used for small street props (drawn up close only) and for tree
// LODs (full model near, cheap proxy far), so each costs a single draw call
// and nothing outside its band reaches the GPU.

import * as THREE from "three";

export interface DistanceInstance {
  matrix: THREE.Matrix4;
  x: number;
  z: number;
  /** Per-instance colour (display hex), if the mesh uses instance colours. */
  color?: number;
}

export class DistanceInstances {
  readonly mesh: THREE.InstancedMesh;
  private readonly matrices: Float32Array;
  private readonly colors: Float32Array | null;
  private readonly xs: Float32Array;
  private readonly zs: Float32Array;
  private lastX = Infinity;
  private lastZ = Infinity;
  private lastAll = false;

  constructor(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    items: readonly DistanceInstance[],
    private readonly near: number,
    private readonly far: number,
    private readonly step = 6,
  ) {
    const n = Math.max(1, items.length);
    this.mesh = new THREE.InstancedMesh(geometry, material, n);
    this.matrices = new Float32Array(items.length * 16);
    this.xs = new Float32Array(items.length);
    this.zs = new Float32Array(items.length);
    this.colors = items.some((i) => i.color !== undefined) ? new Float32Array(items.length * 3) : null;
    const c = new THREE.Color();
    items.forEach((it, i) => {
      it.matrix.toArray(this.matrices, i * 16);
      this.xs[i] = it.x;
      this.zs[i] = it.z;
      if (this.colors) {
        c.setHex(it.color ?? 0xffffff);
        this.colors[i * 3] = c.r;
        this.colors[i * 3 + 1] = c.g;
        this.colors[i * 3 + 2] = c.b;
      }
    });
    if (this.colors) this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.mesh.count = 0;
    // The instances span the campus: culling is done here, by distance.
    this.mesh.frustumCulled = false;
  }

  /** Number of instances drawn after the last update. */
  get visible(): number {
    return this.mesh.count;
  }

  /** Draws nothing until the next update. */
  clear(): void {
    this.mesh.count = 0;
    this.lastX = Infinity;
  }

  /** Re-selects the instances in the band around (x, z); "all" draws every instance (aerial views). */
  update(x: number, z: number, all = false): void {
    if (all === this.lastAll && Math.hypot(x - this.lastX, z - this.lastZ) < this.step) return;
    this.lastX = x;
    this.lastZ = z;
    this.lastAll = all;
    const dst = this.mesh.instanceMatrix.array as Float32Array;
    const cdst = this.mesh.instanceColor?.array as Float32Array | undefined;
    const n2 = this.near * this.near;
    const f2 = this.far * this.far;
    let n = 0;
    for (let i = 0; i < this.xs.length; i++) {
      const dx = this.xs[i] - x;
      const dz = this.zs[i] - z;
      const d2 = dx * dx + dz * dz;
      if (!all && (d2 < n2 || d2 >= f2)) continue;
      dst.set(this.matrices.subarray(i * 16, i * 16 + 16), n * 16);
      if (cdst && this.colors) cdst.set(this.colors.subarray(i * 3, i * 3 + 3), n * 3);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
