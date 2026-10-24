// Fixed-capacity particle simulation over flat typed arrays (no THREE, no
// allocation after construction): spawning past capacity recycles the oldest
// slot, step() integrates velocity with drag + buoyancy, grows each particle
// from size0 to size1 and fades its alpha to 0 over its life. The position /
// size / alpha / color arrays are uploaded as-is by vfx/particleSystem.ts.
// Pure, tested.

export interface ParticleLook {
  /** Seconds. */
  life: number;
  /** World size (m) at birth / death. */
  size0: number;
  size1: number;
  /** Opacity at birth (fades to 0). */
  alpha: number;
  r: number;
  g: number;
  b: number;
}

export class ParticleBuffer {
  readonly position: Float32Array;
  readonly velocity: Float32Array;
  readonly size: Float32Array;
  readonly alpha: Float32Array;
  readonly color: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly alpha0: Float32Array;
  private next = 0;
  private live = 0;

  constructor(readonly capacity: number) {
    this.position = new Float32Array(capacity * 3);
    this.velocity = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.color = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.size1 = new Float32Array(capacity);
    this.alpha0 = new Float32Array(capacity);
  }

  /** Living particles after the last spawn/step. */
  alive(): number {
    return this.live;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, look: ParticleLook): void {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    if (this.life[i] <= 0) this.live++;
    const i3 = i * 3;
    this.position[i3] = x;
    this.position[i3 + 1] = y;
    this.position[i3 + 2] = z;
    this.velocity[i3] = vx;
    this.velocity[i3 + 1] = vy;
    this.velocity[i3 + 2] = vz;
    this.color[i3] = look.r;
    this.color[i3 + 1] = look.g;
    this.color[i3 + 2] = look.b;
    this.age[i] = 0;
    this.life[i] = Math.max(1e-3, look.life);
    this.size0[i] = look.size0;
    this.size1[i] = look.size1;
    this.alpha0[i] = look.alpha;
    this.size[i] = look.size0;
    this.alpha[i] = look.alpha;
  }

  /** Advances every live particle by `dt`; `drag` (1/s) slows them, `buoyancy` (m/s²) lifts them. */
  step(dt: number, drag: number, buoyancy: number): void {
    const damp = Math.exp(-drag * dt);
    let live = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      const age = this.age[i] + dt;
      if (age >= this.life[i]) {
        this.life[i] = 0;
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      this.age[i] = age;
      const i3 = i * 3;
      this.velocity[i3] *= damp;
      this.velocity[i3 + 1] = this.velocity[i3 + 1] * damp + buoyancy * dt;
      this.velocity[i3 + 2] *= damp;
      this.position[i3] += this.velocity[i3] * dt;
      this.position[i3 + 1] += this.velocity[i3 + 1] * dt;
      this.position[i3 + 2] += this.velocity[i3 + 2] * dt;
      const t = age / this.life[i];
      // Ease-out growth; alpha fades in briefly then out.
      this.size[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * (1 - (1 - t) * (1 - t));
      this.alpha[i] = this.alpha0[i] * Math.min(1, t * 8) * (1 - t);
      live++;
    }
    this.live = live;
  }

  clear(): void {
    this.life.fill(0);
    this.alpha.fill(0);
    this.size.fill(0);
    this.live = 0;
  }
}
