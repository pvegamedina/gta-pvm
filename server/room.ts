import {
  FIRE_RATE_TOLERANCE,
  MAX_HEALTH,
  MAX_PLAYERS,
  RANGE_TOLERANCE,
  RESPAWN_DELAY_MS,
  SPAWN_POINTS,
  WEAPONS,
  type ClientMessage,
  type DamageCause,
  type PlayerMotion,
  type PlayerSnapshot,
  type ServerMessage,
  type SpawnPoint,
  type WeaponId,
} from "../shared/protocol";
import {
  isDamageCause,
  isRecord,
  isWeaponId,
  parseMotion,
  parseVec3,
  sanitizeName,
} from "./validation";

export interface RoomDeps {
  now: () => number;
  send: (clientId: string, msg: ServerMessage) => void;
  broadcast: (msg: ServerMessage, exceptId?: string) => void;
  random: () => number;
  schedule: (fn: () => void, ms: number) => void;
}

interface Player extends PlayerSnapshot {
  lastShotAt: Record<string, number>;
}

/** Fraction of damage taken while inside a vehicle. */
const CAR_DAMAGE_FACTOR = 0.6;
const BRIGHT_COLOR_SATURATION = 0.85;

export class GameRoom {
  private readonly players = new Map<string, Player>();
  private readonly connected = new Set<string>();
  private joinCounter = 0;

  constructor(private readonly deps: RoomDeps) {}

  join(id: string): void {
    this.connected.add(id);
  }

  leave(id: string): void {
    this.connected.delete(id);
    if (this.players.delete(id)) this.deps.broadcast({ t: "playerLeft", id });
  }

  handle(id: string, msg: ClientMessage): void {
    if (!this.connected.has(id) || !isRecord(msg)) return;
    if (msg.t === "hello") return this.onHello(id, msg.name);
    const player = this.players.get(id);
    if (!player) return;
    switch (msg.t) {
      case "state": return this.onState(player, msg.motion);
      case "shoot": return this.onShoot(player, msg);
      case "selfDamage": return this.onSelfDamage(player, msg.amount, msg.cause);
      case "ping": return this.onPing(id, msg.ts);
    }
  }

  tick(): void {
    const moving = [...this.players.values()]
      .filter((p) => p.motion)
      .map((p) => ({ id: p.id, motion: p.motion as PlayerMotion }));
    if (moving.length > 0) this.deps.broadcast({ t: "states", players: moving });
  }

  /* ---------- handlers ---------- */

  private onHello(id: string, rawName: unknown): void {
    if (this.players.has(id)) return;
    if (this.players.size >= MAX_PLAYERS) {
      this.deps.send(id, { t: "error", message: "Servidor lleno" });
      return;
    }
    this.joinCounter++;
    const player: Player = {
      id,
      name: sanitizeName(rawName, `Jugador ${this.joinCounter}`),
      color: this.randomColor(),
      health: MAX_HEALTH,
      alive: true,
      kills: 0,
      deaths: 0,
      motion: null,
      lastShotAt: {},
    };
    this.players.set(id, player);
    this.deps.send(id, {
      t: "welcome",
      id,
      players: [...this.players.values()].map(snapshot),
      spawn: this.pickSpawn(),
    });
    this.deps.broadcast({ t: "playerJoined", player: snapshot(player) }, id);
  }

  private onState(player: Player, raw: unknown): void {
    if (!player.alive) return;
    const motion = parseMotion(raw);
    if (motion) player.motion = motion;
  }

  private onShoot(shooter: Player, msg: Record<string, unknown>): void {
    if (!shooter.alive || !isWeaponId(msg.weapon)) return;
    const origin = parseVec3(msg.origin);
    const end = parseVec3(msg.end);
    if (!origin || !end) return;
    if (!this.consumeFireRate(shooter, msg.weapon)) return;

    const target = this.validTarget(shooter, msg.weapon, msg.targetId);
    this.deps.broadcast(
      { t: "shot", shooterId: shooter.id, weapon: msg.weapon, origin, end, hit: target !== null },
      shooter.id,
    );
    if (!target) return;
    const base = WEAPONS[msg.weapon].damage;
    const damage = target.motion?.car ? Math.round(base * CAR_DAMAGE_FACTOR) : base;
    this.applyDamage(target, damage, { attackerId: shooter.id, weapon: msg.weapon, cause: null });
  }

  private onSelfDamage(player: Player, amount: unknown, cause: unknown): void {
    if (!player.alive || typeof amount !== "number" || !Number.isFinite(amount)) return;
    if (!isDamageCause(cause)) return;
    const clamped = Math.min(Math.max(amount, 0), MAX_HEALTH);
    if (clamped === 0) return;
    this.applyDamage(player, clamped, { attackerId: null, weapon: null, cause });
  }

  private onPing(id: string, ts: unknown): void {
    if (typeof ts === "number" && Number.isFinite(ts)) this.deps.send(id, { t: "pong", ts });
  }

  /* ---------- rules ---------- */

  private consumeFireRate(shooter: Player, weapon: WeaponId): boolean {
    const now = this.deps.now();
    const minGap = WEAPONS[weapon].fireInterval * 1000 * FIRE_RATE_TOLERANCE;
    const last = shooter.lastShotAt[weapon];
    if (last !== undefined && now - last < minGap) return false;
    shooter.lastShotAt[weapon] = now;
    return true;
  }

  private validTarget(shooter: Player, weapon: WeaponId, targetId: unknown): Player | null {
    if (typeof targetId !== "string" || targetId === shooter.id) return null;
    const target = this.players.get(targetId);
    if (!target || !target.alive || !target.motion || !shooter.motion) return null;
    const reach = WEAPONS[weapon].range + RANGE_TOLERANCE;
    return distance(shooter.motion.p, target.motion.p) <= reach ? target : null;
  }

  private applyDamage(
    victim: Player,
    damage: number,
    src: { attackerId: string | null; weapon: WeaponId | null; cause: DamageCause | null },
  ): void {
    victim.health = Math.max(0, victim.health - damage);
    this.deps.broadcast({ t: "health", id: victim.id, health: victim.health, attackerId: src.attackerId });
    if (victim.health > 0) return;

    victim.alive = false;
    victim.deaths++;
    const killer = src.attackerId ? this.players.get(src.attackerId) : undefined;
    if (killer && killer !== victim) killer.kills++;
    this.deps.broadcast({
      t: "killed",
      victimId: victim.id,
      killerId: src.attackerId,
      weapon: src.weapon,
      cause: src.cause,
    });
    this.broadcastScores();
    this.deps.schedule(() => this.respawn(victim.id), RESPAWN_DELAY_MS);
  }

  private respawn(id: string): void {
    const player = this.players.get(id);
    if (!player || player.alive) return;
    player.health = MAX_HEALTH;
    player.alive = true;
    player.motion = null;
    this.deps.broadcast({ t: "respawned", id, spawn: this.pickSpawn(), health: MAX_HEALTH });
  }

  private broadcastScores(): void {
    this.deps.broadcast({
      t: "scores",
      players: [...this.players.values()].map((p) => ({ id: p.id, kills: p.kills, deaths: p.deaths })),
    });
  }

  private pickSpawn(): SpawnPoint {
    const i = Math.floor(this.deps.random() * SPAWN_POINTS.length) % SPAWN_POINTS.length;
    return SPAWN_POINTS[i];
  }

  private randomColor(): number {
    const hue = this.deps.random();
    return hslToHex(hue, BRIGHT_COLOR_SATURATION, 0.55);
  }
}

function snapshot(p: Player): PlayerSnapshot {
  const { id, name, color, health, alive, kills, deaths, motion } = p;
  return { id, name, color, health, alive, kills, deaths, motion };
}

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function hslToHex(h: number, s: number, l: number): number {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const to255 = (v: number) => Math.round(v * 255);
  return (to255(f(0)) << 16) | (to255(f(8)) << 8) | to255(f(4));
}
