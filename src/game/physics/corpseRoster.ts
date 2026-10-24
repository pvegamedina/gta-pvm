// Pure lifecycle policy for persistent corpses: at most `cap` corpses stay;
// beyond it the oldest starts fading out over `fadeSeconds` and is then
// reported for removal. If corpses pile up faster than they fade (spam), the
// oldest fading one is dropped right away so at most cap + hardExtra exist.

export interface CorpseRosterOptions {
  cap: number;
  fadeSeconds: number;
  /** Fading corpses tolerated on top of `cap` before they are dropped instantly. */
  hardExtra?: number;
}

interface Entry<T> {
  item: T;
  /** null while resting; seconds since the fade started otherwise. */
  fadeT: number | null;
}

export class CorpseRoster<T> {
  private entries: Entry<T>[] = [];
  private readonly cap: number;
  private readonly fadeSeconds: number;
  private readonly hardExtra: number;

  constructor(opts: CorpseRosterOptions) {
    this.cap = Math.max(0, opts.cap);
    this.fadeSeconds = Math.max(1e-3, opts.fadeSeconds);
    this.hardExtra = Math.max(0, opts.hardExtra ?? 5);
  }

  get size(): number {
    return this.entries.length;
  }

  has(item: T): boolean {
    return this.entries.some((e) => e.item === item);
  }

  /** Tracks a new corpse. Returns corpses that must be removed immediately. */
  add(item: T): T[] {
    this.entries.push({ item, fadeT: null });
    const resting = this.entries.filter((e) => e.fadeT === null);
    // Oldest resting corpses beyond the cap start fading.
    for (let i = 0; i < resting.length - this.cap; i++) resting[i].fadeT = 0;
    const removed: T[] = [];
    while (this.entries.length > this.cap + this.hardExtra) {
      const idx = this.entries.findIndex((e) => e.fadeT !== null);
      if (idx < 0) break;
      removed.push(this.entries[idx].item);
      this.entries.splice(idx, 1);
    }
    return removed;
  }

  /** Corpses currently fading out, oldest first. */
  fading(): T[] {
    return this.entries.filter((e) => e.fadeT !== null).map((e) => e.item);
  }

  /** Opacity multiplier: 1 while resting, ramping to 0 during the fade. */
  fadeAlpha(item: T): number {
    const e = this.entries.find((x) => x.item === item);
    if (!e || e.fadeT === null) return 1;
    return Math.max(0, 1 - e.fadeT / this.fadeSeconds);
  }

  /** Advances fades; returns corpses whose fade finished (now untracked). */
  update(dt: number): T[] {
    const done: T[] = [];
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (e.fadeT === null) continue;
      e.fadeT += dt;
      if (e.fadeT >= this.fadeSeconds) {
        done.push(e.item);
        this.entries.splice(i, 1);
      }
    }
    return done.reverse();
  }

  /** Untracks everything (game reset); returns what was tracked. */
  clear(): T[] {
    const all = this.entries.map((e) => e.item);
    this.entries = [];
    return all;
  }
}
