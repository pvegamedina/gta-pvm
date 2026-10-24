// Tap vs long-press detection for one key (e.g. H: horn on tap, siren on hold).
// Times are in seconds from any monotonic clock.

export class HoldKey {
  private pressedAt: number | null = null;
  private fired = false;

  /** `threshold` (s) a key must stay down to count as a long press. */
  constructor(readonly threshold: number) {}

  press(t: number): void {
    this.pressedAt = t;
    this.fired = false;
  }

  /** True exactly once, the first update after the key has been held for `threshold`. */
  update(t: number): boolean {
    if (this.pressedAt === null || this.fired || t - this.pressedAt < this.threshold) return false;
    this.fired = true;
    return true;
  }

  /** True when this release ends a tap (the long press never fired). */
  release(t: number): boolean {
    if (this.pressedAt === null) return false;
    const tap = !this.fired && t - this.pressedAt < this.threshold;
    this.pressedAt = null;
    this.fired = false;
    return tap;
  }

  /** Forgets the current press (focus lost, left the car). */
  cancel(): void {
    this.pressedAt = null;
    this.fired = false;
  }
}
