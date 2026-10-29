// The minigun boss ("JOSE ENRIQUE"): patrols the campus, locks onto the
// nearest player it can see and hoses them with spun-up minigun bursts.
// Pure logic (no THREE / DOM / Node), so the very same brain runs on the
// server (authoritative, multiplayer) and in the client when offline.

import { BOSS_MAX_HEALTH, BOSS_MINIGUN, BOSS_RESPAWN_DELAY_MS, type BossSnapshot, type Vec3 } from "../../../shared/protocol";

/** What the brain needs to know about the world (see bossWorld.ts). */
export interface BossWorld {
  groundY(x: number, z: number): number;
  /** No building between the two points. */
  clearLine(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean;
  /** The boss may stand here (inside the map, not inside a building). */
  walkable(x: number, z: number): boolean;
  /** Patrol points (map metres). */
  waypoints: readonly (readonly [number, number])[];
  /** Centre of the patrol area. */
  home: readonly [number, number];
}

export interface BossTarget {
  id: string;
  x: number;
  /** Feet height. */
  y: number;
  z: number;
  alive: boolean;
  inCar: boolean;
}

/** Damage dealt to one target since the last flush. */
export interface BossDamage {
  targetId: string;
  amount: number;
}

export const BOSS_WALK_SPEED = 2.2;
export const BOSS_ADVANCE_SPEED = 1.6;
/** Keeps walking towards a target farther than this while shooting. */
export const BOSS_ADVANCE_DISTANCE = 28;
/** Patrol points farther than this from home are never picked. */
export const BOSS_LEASH = 220;
/** A target out of sight for this long is dropped. */
export const BOSS_LOSE_TIME = 2.5;
/** Pending damage is reported this often (s), not once per round. */
export const BOSS_DAMAGE_FLUSH = 0.25;
/** Fraction of the damage taken by someone inside a car. */
export const BOSS_CAR_FACTOR = 0.6;
const TURN_RATE = 3;
/** Only spins up once roughly facing the target (rad). */
const FIRE_CONE = 0.35;
/** Gun / eye height above the feet (the boss is a tall man). */
export const BOSS_EYE = 2.2;
const CHEST = 1.2;

/** Chance a round hits at `distance` m (the minigun sprays a lot). */
export function bossHitChance(distance: number): number {
  return Math.min(0.5, Math.max(0.12, 0.5 - distance / 200));
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export class BossBrain {
  x: number;
  y: number;
  z: number;
  yaw = 0;
  health = BOSS_MAX_HEALTH;
  alive = true;
  /** Seconds until it comes back after dying. */
  respawnIn = 0;
  /** Walking speed this step (animation). */
  speed = 0;

  private targetId: string | null = null;
  private aim: Vec3 | null = null;
  private unseenFor = 0;
  /** 0..BOSS_MINIGUN.spinUp. */
  private spin = 0;
  private firing = false;
  /** Time left in the current burst / pause. */
  private burstLeft = 0;
  private pauseLeft = 0;
  private roundAcc = 0;
  private readonly pending = new Map<string, number>();
  private flushIn = BOSS_DAMAGE_FLUSH;
  private waypoint: readonly [number, number] | null = null;
  private idleFor = 0;

  constructor(
    private readonly world: BossWorld,
    private readonly random: () => number = Math.random,
  ) {
    const [hx, hz] = this.pickSpawn();
    this.x = hx;
    this.z = hz;
    this.y = world.groundY(hx, hz);
  }

  /** Advances the boss `dt` seconds; returns the damage to apply (batched every BOSS_DAMAGE_FLUSH). */
  update(dt: number, targets: readonly BossTarget[]): BossDamage[] {
    if (!this.alive) {
      this.respawnIn -= dt;
      if (this.respawnIn <= 0) this.respawn();
      return [];
    }
    const target = this.updateTarget(dt, targets);
    if (target) this.engage(dt, target);
    else {
      this.stopShooting(dt);
      // A target that just ducked out of sight: wait for it where we stand.
      if (this.targetId) this.speed = 0;
      else this.patrol(dt);
    }
    this.y = this.world.groundY(this.x, this.z);
    return this.flush(dt);
  }

  /** A player's round hit the boss. Returns true when it killed it. */
  damage(amount: number): boolean {
    if (!this.alive || !(amount > 0)) return false;
    this.health = Math.max(0, this.health - amount);
    if (this.health > 0) return false;
    this.alive = false;
    this.respawnIn = BOSS_RESPAWN_DELAY_MS / 1000;
    this.targetId = null;
    this.aim = null;
    this.firing = false;
    this.spin = 0;
    this.speed = 0;
    this.pending.clear();
    return true;
  }

  snapshot(): BossSnapshot {
    const r = (v: number) => Math.round(v * 100) / 100;
    return {
      p: [r(this.x), r(this.y), r(this.z)],
      yaw: r(this.yaw),
      health: Math.round(this.health),
      alive: this.alive,
      targetId: this.targetId,
      spinning: this.spin > 0,
      firing: this.firing,
      aim: this.aim ? [r(this.aim[0]), r(this.aim[1]), r(this.aim[2])] : null,
    };
  }

  /* ---------- targeting ---------- */

  private canSee(t: BossTarget): boolean {
    return this.world.clearLine(this.x, this.y + BOSS_EYE, this.z, t.x, t.y + CHEST, t.z);
  }

  private updateTarget(dt: number, targets: readonly BossTarget[]): BossTarget | null {
    const range = BOSS_MINIGUN.range;
    const current = this.targetId ? targets.find((t) => t.id === this.targetId && t.alive) : undefined;
    if (current && Math.hypot(current.x - this.x, current.z - this.z) <= range * 1.15) {
      if (this.canSee(current)) {
        this.unseenFor = 0;
        return current;
      }
      this.unseenFor += dt;
      if (this.unseenFor < BOSS_LOSE_TIME) {
        // Out of sight for a moment: hold fire, keep facing where they were.
        this.firing = false;
        return null;
      }
    }
    // Nearest visible player in range.
    let best: BossTarget | null = null;
    let bestD: number = range;
    for (const t of targets) {
      if (!t.alive) continue;
      const d = Math.hypot(t.x - this.x, t.z - this.z);
      if (d <= bestD && this.canSee(t)) {
        best = t;
        bestD = d;
      }
    }
    this.targetId = best?.id ?? null;
    this.unseenFor = 0;
    if (!best) this.aim = null;
    return best;
  }

  private engage(dt: number, t: BossTarget): void {
    const dx = t.x - this.x;
    const dz = t.z - this.z;
    const dist = Math.hypot(dx, dz);
    this.aim = [t.x, t.y + CHEST, t.z];
    const facing = this.turnTowards(Math.atan2(dx, dz), dt);
    this.speed = 0;
    if (dist > BOSS_ADVANCE_DISTANCE) this.walk(BOSS_ADVANCE_SPEED, dt);

    if (facing > FIRE_CONE) {
      this.firing = false;
      return;
    }
    if (this.spin < BOSS_MINIGUN.spinUp) {
      this.spin = Math.min(BOSS_MINIGUN.spinUp, this.spin + dt);
      if (this.spin >= BOSS_MINIGUN.spinUp) this.burstLeft = BOSS_MINIGUN.burst;
      return;
    }
    if (this.pauseLeft > 0) {
      this.firing = false;
      this.pauseLeft -= dt;
      if (this.pauseLeft <= 0) this.burstLeft = BOSS_MINIGUN.burst;
      return;
    }
    this.firing = true;
    this.burstLeft -= dt;
    this.roundAcc += BOSS_MINIGUN.roundsPerSecond * dt;
    const chance = bossHitChance(Math.hypot(dist, t.y + CHEST - (this.y + BOSS_EYE)));
    const perRound = BOSS_MINIGUN.damagePerRound * (t.inCar ? BOSS_CAR_FACTOR : 1);
    while (this.roundAcc >= 1) {
      this.roundAcc -= 1;
      if (this.random() < chance) this.pending.set(t.id, (this.pending.get(t.id) ?? 0) + perRound);
    }
    if (this.burstLeft <= 0) {
      this.firing = false;
      this.pauseLeft = BOSS_MINIGUN.pause;
    }
  }

  private stopShooting(dt: number): void {
    this.firing = false;
    this.roundAcc = 0;
    this.pauseLeft = 0;
    this.spin = Math.max(0, this.spin - dt * 0.8);
  }

  /* ---------- movement ---------- */

  /** Turns towards `yaw` at TURN_RATE; returns the angle still left. */
  private turnTowards(yaw: number, dt: number): number {
    const diff = wrapAngle(yaw - this.yaw);
    const stepMax = TURN_RATE * dt;
    this.yaw = wrapAngle(this.yaw + Math.max(-stepMax, Math.min(stepMax, diff)));
    return Math.abs(wrapAngle(yaw - this.yaw));
  }

  /** Steps forward along the current yaw; false when the way is blocked. */
  private walk(speed: number, dt: number): boolean {
    const nx = this.x + Math.sin(this.yaw) * speed * dt;
    const nz = this.z + Math.cos(this.yaw) * speed * dt;
    if (!this.world.walkable(nx, nz)) return false;
    this.x = nx;
    this.z = nz;
    this.speed = speed;
    return true;
  }

  private patrol(dt: number): void {
    this.speed = 0;
    if (this.idleFor > 0) {
      this.idleFor -= dt;
      return;
    }
    if (!this.waypoint) this.waypoint = this.pickWaypoint();
    if (!this.waypoint) return;
    const dx = this.waypoint[0] - this.x;
    const dz = this.waypoint[1] - this.z;
    if (Math.hypot(dx, dz) < 2) {
      this.waypoint = null;
      this.idleFor = 1.5 + this.random() * 2;
      return;
    }
    const left = this.turnTowards(Math.atan2(dx, dz), dt);
    if (left < 0.6 && !this.walk(BOSS_WALK_SPEED, dt)) this.waypoint = null;
  }

  /** A random patrol point within the leash that can be walked to in a straight line. */
  private pickWaypoint(): readonly [number, number] | null {
    const { waypoints, home } = this.world;
    for (let tries = 0; tries < 12 && waypoints.length > 0; tries++) {
      const w = waypoints[Math.floor(this.random() * waypoints.length) % waypoints.length];
      const d = Math.hypot(w[0] - this.x, w[1] - this.z);
      if (d < 8 || d > 90 || Math.hypot(w[0] - home[0], w[1] - home[1]) > BOSS_LEASH) continue;
      if (this.straightWalk(w[0], w[1])) return w;
    }
    return null;
  }

  private straightWalk(x: number, z: number): boolean {
    const d = Math.hypot(x - this.x, z - this.z);
    const n = Math.ceil(d / 2);
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      if (!this.world.walkable(this.x + (x - this.x) * f, this.z + (z - this.z) * f)) return false;
    }
    return true;
  }

  private pickSpawn(): readonly [number, number] {
    const { waypoints, home } = this.world;
    const near = waypoints.filter((w) => Math.hypot(w[0] - home[0], w[1] - home[1]) <= BOSS_LEASH * 0.6);
    if (near.length === 0) return home;
    return near[Math.floor(this.random() * near.length) % near.length];
  }

  private respawn(): void {
    const [x, z] = this.pickSpawn();
    this.x = x;
    this.z = z;
    this.y = this.world.groundY(x, z);
    this.health = BOSS_MAX_HEALTH;
    this.alive = true;
    this.waypoint = null;
    this.idleFor = 0;
  }

  private flush(dt: number): BossDamage[] {
    this.flushIn -= dt;
    if (this.flushIn > 0 || this.pending.size === 0) return [];
    this.flushIn = BOSS_DAMAGE_FLUSH;
    const out: BossDamage[] = [];
    for (const [targetId, amount] of this.pending) out.push({ targetId, amount: Math.round(amount) });
    this.pending.clear();
    return out.filter((d) => d.amount > 0);
  }
}
