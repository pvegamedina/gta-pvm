// Loading-screen progress: weighted stages (map JSON, GLB packs, Rapier, the
// world build) each report a fraction while running and end done or failed.
// The aggregate is monotonic, a stage only counts as complete once it is
// done or failed (partial progress tops out just below), so the bar reaches
// exactly 1.0 when everything settled — failures included, so a missing
// asset pack never hangs the screen. Pure, tested.

export interface LoadStage {
  id: string;
  /** Player-facing label shown while this stage is the current one. */
  label: string;
  weight: number;
}

type StageState = "pending" | "done" | "failed";

/** Partial progress of a running stage never reaches its full weight. */
const PARTIAL_CAP = 0.99;

export class LoadProgress {
  private readonly frac = new Map<string, number>();
  private readonly state = new Map<string, StageState>();
  private readonly total: number;
  private last = 0;
  private readonly listeners: ((value: number, label: string) => void)[] = [];

  constructor(private readonly stages: readonly LoadStage[]) {
    this.total = stages.reduce((s, st) => s + Math.max(0, st.weight), 0) || 1;
    for (const s of stages) {
      this.frac.set(s.id, 0);
      this.state.set(s.id, "pending");
    }
  }

  /** Reports a running stage's fraction (0..1); ignored once it settled. */
  progress(id: string, f: number): void {
    if (this.state.get(id) !== "pending" || !Number.isFinite(f)) return;
    const v = Math.min(PARTIAL_CAP, Math.max(0, f));
    if (v <= (this.frac.get(id) ?? 0)) return;
    this.frac.set(id, v);
    this.emit();
  }

  done(id: string): void {
    this.settle(id, "done");
  }

  fail(id: string): void {
    this.settle(id, "failed");
  }

  /** Marks `id` done/failed when `p` settles; passes the result (or rejection) through. */
  track<T>(id: string, p: Promise<T>): Promise<T> {
    return p.then(
      (v) => {
        this.done(id);
        return v;
      },
      (err: unknown) => {
        this.fail(id);
        throw err;
      },
    );
  }

  /** Aggregate 0..1, never decreasing. */
  value(): number {
    if (this.finished()) return 1;
    let s = 0;
    for (const st of this.stages) s += Math.max(0, st.weight) * (this.state.get(st.id) === "pending" ? (this.frac.get(st.id) ?? 0) : 1);
    this.last = Math.max(this.last, Math.min(1, s / this.total));
    return this.last;
  }

  /** Label of the first stage (in declaration order) still pending, or "" when finished. */
  label(): string {
    for (const st of this.stages) if (this.state.get(st.id) === "pending") return st.label;
    return "";
  }

  finished(): boolean {
    for (const st of this.stages) if (this.state.get(st.id) === "pending") return false;
    return true;
  }

  failed(): string[] {
    return this.stages.filter((st) => this.state.get(st.id) === "failed").map((st) => st.id);
  }

  onChange(fn: (value: number, label: string) => void): void {
    this.listeners.push(fn);
  }

  private settle(id: string, s: StageState): void {
    if (this.state.get(id) !== "pending") return;
    this.state.set(id, s);
    this.emit();
  }

  private emit(): void {
    const v = this.value();
    const l = this.label();
    for (const fn of this.listeners) fn(v, l);
  }
}
