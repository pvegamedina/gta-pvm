// Rolling frame-time statistics for the F3 performance HUD: a fixed ring
// buffer of the last N frame times (ms) with average / fps / max /
// percentile. No allocation per push. Pure, tested.

export class FrameStats {
  private readonly buf: Float32Array;
  private head = 0;
  private n = 0;
  /** Scratch copy for percentiles (allocated once). */
  private readonly sorted: Float32Array;

  constructor(readonly capacity = 120) {
    this.buf = new Float32Array(capacity);
    this.sorted = new Float32Array(capacity);
  }

  get count(): number {
    return this.n;
  }

  push(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.buf[this.head] = ms;
    this.head = (this.head + 1) % this.capacity;
    if (this.n < this.capacity) this.n++;
  }

  /** Visits the samples oldest -> newest. */
  forEach(fn: (ms: number, i: number) => void): void {
    const start = (this.head - this.n + this.capacity) % this.capacity;
    for (let i = 0; i < this.n; i++) fn(this.buf[(start + i) % this.capacity], i);
  }

  averageMs(): number {
    if (this.n === 0) return 0;
    let s = 0;
    this.forEach((ms) => (s += ms));
    return s / this.n;
  }

  fps(): number {
    const a = this.averageMs();
    return a > 0 ? 1000 / a : 0;
  }

  maxMs(): number {
    let m = 0;
    this.forEach((ms) => (m = Math.max(m, ms)));
    return m;
  }

  /** Frame time below which a fraction `q` (0..1) of the samples fall. */
  percentileMs(q: number): number {
    if (this.n === 0) return 0;
    const s = this.sorted.subarray(0, this.n);
    this.forEach((ms, i) => (s[i] = ms));
    s.sort();
    return s[Math.min(this.n - 1, Math.max(0, Math.ceil(q * this.n) - 1))];
  }
}
