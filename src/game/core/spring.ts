// Damped harmonic spring (x'' = -w²(x - target) - 2·zeta·w·x') integrated with
// its exact closed-form solution for a target held constant over the step, so
// it is framerate independent (n steps of dt equal one step of n·dt) and
// unconditionally stable. zeta = 1 is critically damped (fastest approach, no
// overshoot), zeta < 1 overshoots and settles (a "weighty" body), zeta > 1 is
// sluggish. Used by every procedural animation / camera layer. Pure.

const TWO_PI = Math.PI * 2;
/** |zeta - 1| below this uses the critically damped formula (avoids 0/0). */
const CRITICAL_EPS = 1e-4;

export class SpringDamper {
  value: number;
  velocity = 0;

  /**
   * @param frequency natural frequency (Hz): how fast it responds.
   * @param damping damping ratio zeta (1 = critical).
   * @param value initial value.
   */
  constructor(
    public frequency: number,
    public damping = 1,
    value = 0,
  ) {
    this.value = value;
  }

  /** Advances `dt` seconds towards `target`; returns the new value. */
  update(dt: number, target: number): number {
    if (!(dt > 0)) return this.value;
    const w = TWO_PI * this.frequency;
    const z = this.damping;
    const y0 = this.value - target;
    const v0 = this.velocity;
    let y: number;
    let v: number;
    if (Math.abs(z - 1) < CRITICAL_EPS) {
      const e = Math.exp(-w * dt);
      const c = v0 + w * y0;
      y = (y0 + c * dt) * e;
      v = (v0 - w * c * dt) * e;
    } else if (z < 1) {
      const wd = w * Math.sqrt(1 - z * z);
      const e = Math.exp(-z * w * dt);
      const cos = Math.cos(wd * dt);
      const sin = Math.sin(wd * dt);
      y = e * (y0 * cos + ((v0 + z * w * y0) / wd) * sin);
      v = e * (v0 * cos - ((z * w * v0 + w * w * y0) / wd) * sin);
    } else {
      const s = Math.sqrt(z * z - 1);
      const r1 = -w * (z - s);
      const r2 = -w * (z + s);
      const c1 = (v0 - r2 * y0) / (r1 - r2);
      const c2 = y0 - c1;
      const e1 = Math.exp(r1 * dt);
      const e2 = Math.exp(r2 * dt);
      y = c1 * e1 + c2 * e2;
      v = c1 * r1 * e1 + c2 * r2 * e2;
    }
    this.value = target + y;
    this.velocity = v;
    return this.value;
  }

  /** Adds an instantaneous velocity change (an impulse per unit mass). */
  kick(dv: number): void {
    this.velocity += dv;
  }

  /** Jumps to `value` at rest. */
  reset(value = 0): void {
    this.value = value;
    this.velocity = 0;
  }
}
