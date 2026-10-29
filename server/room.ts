import {
  BOSS_ID,
  FIRE_RATE_TOLERANCE,
  MAX_HEALTH,
  MAX_PLAYERS,
  RANGE_TOLERANCE,
  RESPAWN_DELAY_MS,
  SESSION_REPLACED_MESSAGE,
  SPAWN_POINTS,
  WEAPONS,
  characterForColor,
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
  isValidSessionId,
  isWeaponId,
  parseCharacter,
  parseMotion,
  parseVec3,
  sanitizeName,
} from "./validation";
import { pickSpawn } from "./mapSpawns";
import type { BossBrain } from "../src/game/boss/bossBrain";

export interface RoomDeps {
  now: () => number;
  send: (clientId: string, msg: ServerMessage) => void;
  broadcast: (msg: ServerMessage, exceptId?: string) => void;
  random: () => number;
  schedule: (fn: () => void, ms: number) => void;
  /** Forcibly closes another client's live connection (used to enforce "one
   * active session per browser" — see onHello). The transport's own "close"
   * handler is expected to call room.leave() for it, same as any disconnect. */
  disconnect: (clientId: string) => void;
  /** Where players (re)spawn; defaults to the protocol's built-in list (the real server passes the map's). */
  spawns?: readonly SpawnPoint[];
  /** The minigun boss, when the server runs one (built from the map, see server/index.ts). */
  boss?: BossBrain;
}

interface Player extends PlayerSnapshot {
  character: string;
  lastShotAt: Record<string, number>;
  /** Times (ms) of recently accepted setCharacter changes (rate-limit window). */
  characterChanges: number[];
}

/** At most this many character changes per rolling window (spam guard). */
const CHARACTER_CHANGE_LIMIT = 4;
const CHARACTER_CHANGE_WINDOW_MS = 1000;

/** Fraction of damage taken while inside a vehicle. */
const CAR_DAMAGE_FACTOR = 0.6;
const BRIGHT_COLOR_SATURATION = 0.85;

/** Walking-pace contact doesn't count as a ram (mirrors client's on-foot
 * vehicle-hit threshold in combat/health.ts). */
const RAM_SPEED_THRESHOLD = 6;
const RAM_DAMAGE_PER_UNIT = 2.2;
const RAM_DAMAGE_CAP = 70;
/** Per-attacker/target cooldown so one continuous contact can't melt someone in one frame. */
const RAM_COOLDOWN_MS = 500;
/** Plausible contact distance between the two players' last known positions. */
const RAM_MAX_DISTANCE = 12;
/** Attacker-reported car speed is clamped before scaling damage. */
const RAM_MAX_SPEED = 40;

function ramDamage(speed: number): number {
  if (speed <= RAM_SPEED_THRESHOLD) return 0;
  return Math.min(RAM_DAMAGE_CAP, (speed - RAM_SPEED_THRESHOLD) * RAM_DAMAGE_PER_UNIT);
}

export class GameRoom {
  private readonly players = new Map<string, Player>();
  private readonly connected = new Set<string>();
  private readonly lastRamAt = new Map<string, number>();
  /** sessionId -> the connection id currently "owning" it (one active socket
   * per browser session). */
  private readonly sessionOwners = new Map<string, string>();
  private readonly playerSessionId = new Map<string, string>();
  private joinCounter = 0;
  private lastTickAt: number | null = null;

  constructor(private readonly deps: RoomDeps) {}

  join(id: string): void {
    this.connected.add(id);
  }

  leave(id: string): void {
    this.connected.delete(id);
    if (this.players.delete(id)) this.deps.broadcast({ t: "playerLeft", id });
    for (const key of this.lastRamAt.keys()) {
      if (key.startsWith(`${id}>`) || key.endsWith(`>${id}`)) this.lastRamAt.delete(key);
    }
    const sid = this.playerSessionId.get(id);
    this.playerSessionId.delete(id);
    // Only clear the session's owner if *this* connection still held it — a
    // reconnect may already have claimed it (see onHello), and that claim
    // must survive the old connection's belated close.
    if (sid !== undefined && this.sessionOwners.get(sid) === id) this.sessionOwners.delete(sid);
  }

  handle(id: string, msg: ClientMessage): void {
    if (!this.connected.has(id) || !isRecord(msg)) return;
    if (msg.t === "hello") return this.onHello(id, msg.name, msg.sessionId, msg.character);
    const player = this.players.get(id);
    if (!player) return;
    switch (msg.t) {
      case "state": return this.onState(player, msg.motion);
      case "shoot": return this.onShoot(player, msg);
      case "ram": return this.onRam(player, msg);
      case "selfDamage": return this.onSelfDamage(player, msg.amount, msg.cause);
      case "ping": return this.onPing(id, msg.ts);
      case "setCharacter": return this.onSetCharacter(player, msg.character);
    }
  }

  tick(): void {
    const moving = [...this.players.values()]
      .filter((p) => p.motion)
      .map((p) => ({ id: p.id, motion: p.motion as PlayerMotion }));
    if (moving.length > 0) this.deps.broadcast({ t: "states", players: moving });
    this.tickBoss();
  }

  /** Moves the boss, applies its minigun damage and broadcasts its state. */
  private tickBoss(): void {
    const boss = this.deps.boss;
    const now = this.deps.now();
    const dt = this.lastTickAt === null ? 0 : Math.min(0.25, Math.max(0, (now - this.lastTickAt) / 1000));
    this.lastTickAt = now;
    if (!boss || this.players.size === 0) return;
    const targets = [...this.players.values()]
      .filter((p) => p.motion)
      .map((p) => {
        const m = p.motion as PlayerMotion;
        return { id: p.id, x: m.p[0], y: m.p[1], z: m.p[2], alive: p.alive, inCar: m.car !== null };
      });
    for (const hit of boss.update(dt, targets)) {
      const victim = this.players.get(hit.targetId);
      if (victim?.alive) this.applyDamage(victim, hit.amount, { attackerId: BOSS_ID, weapon: null, cause: null });
    }
    this.deps.broadcast({ t: "boss", boss: boss.snapshot() });
  }

  /* ---------- handlers ---------- */

  /** Enforces "one active session per browser": a fresh sessionId just
   * registers; a sessionId already owned by another LIVE connection kicks
   * that connection (error + forced close) before this one claims it. The
   * resumed session gets a fresh player slot (simpler than transplanting
   * kills/deaths/name across two Player records, and keeps GameRoom's model
   * — one Player per connection id — unchanged). */
  private claimSession(id: string, sessionId: string): void {
    const previousOwner = this.sessionOwners.get(sessionId);
    if (previousOwner !== undefined && previousOwner !== id && this.connected.has(previousOwner)) {
      this.deps.send(previousOwner, { t: "error", message: SESSION_REPLACED_MESSAGE });
      this.deps.disconnect(previousOwner);
    }
    this.sessionOwners.set(sessionId, id);
    this.playerSessionId.set(id, sessionId);
  }

  private onHello(id: string, rawName: unknown, rawSessionId: unknown, rawCharacter?: unknown): void {
    if (this.players.has(id)) return;
    if (this.players.size >= MAX_PLAYERS) {
      this.deps.send(id, { t: "error", message: "Servidor lleno" });
      return;
    }
    if (isValidSessionId(rawSessionId)) this.claimSession(id, rawSessionId);
    this.joinCounter++;
    const color = this.randomColor();
    const player: Player = {
      id,
      name: sanitizeName(rawName, `Jugador ${this.joinCounter}`),
      color,
      health: MAX_HEALTH,
      alive: true,
      kills: 0,
      deaths: 0,
      motion: null,
      // An explicit (valid) choice wins; otherwise the colour-derived default.
      character: parseCharacter(rawCharacter) ?? characterForColor(color),
      lastShotAt: {},
      characterChanges: [],
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

  /** Validated, rate-limited character change, broadcast to the other clients. */
  private onSetCharacter(player: Player, raw: unknown): void {
    const character = parseCharacter(raw);
    if (!character || character === player.character) return;
    const now = this.deps.now();
    player.characterChanges = player.characterChanges.filter((t) => now - t < CHARACTER_CHANGE_WINDOW_MS);
    if (player.characterChanges.length >= CHARACTER_CHANGE_LIMIT) return;
    player.characterChanges.push(now);
    player.character = character;
    this.deps.broadcast({ t: "characterChanged", id: player.id, character }, player.id);
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
    if (msg.targetId === BOSS_ID) return this.onShootBoss(shooter, msg.weapon, origin, end);

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

  private onShootBoss(shooter: Player, weapon: WeaponId, origin: [number, number, number], end: [number, number, number]): void {
    const boss = this.deps.boss;
    const reach = WEAPONS[weapon].range + RANGE_TOLERANCE;
    const inReach = !!boss?.alive && !!shooter.motion && distance(shooter.motion.p, [boss.x, boss.y, boss.z]) <= reach;
    this.deps.broadcast({ t: "shot", shooterId: shooter.id, weapon, origin, end, hit: inReach }, shooter.id);
    if (!boss || !inReach || !boss.damage(WEAPONS[weapon].damage)) return;
    shooter.kills++;
    this.deps.broadcast({ t: "killed", victimId: BOSS_ID, killerId: shooter.id, weapon, cause: null });
    this.broadcastScores();
  }

  private onRam(attacker: Player, msg: Record<string, unknown>): void {
    if (!attacker.alive) return;
    const { targetId, speed } = msg;
    if (typeof targetId !== "string" || targetId === attacker.id) return;
    if (typeof speed !== "number" || !Number.isFinite(speed)) return;
    const target = this.players.get(targetId);
    if (!target || !target.alive || !target.motion || !attacker.motion) return;
    if (distance(attacker.motion.p, target.motion.p) > RAM_MAX_DISTANCE) return;
    const key = `${attacker.id}>${targetId}`;
    const now = this.deps.now();
    const last = this.lastRamAt.get(key);
    if (last !== undefined && now - last < RAM_COOLDOWN_MS) return;
    this.lastRamAt.set(key, now);
    const damage = ramDamage(Math.min(Math.abs(speed), RAM_MAX_SPEED));
    if (damage <= 0) return;
    this.applyDamage(target, damage, { attackerId: attacker.id, weapon: null, cause: "vehicle" });
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
    return pickSpawn(this.deps.spawns ?? SPAWN_POINTS, this.deps.random);
  }

  private randomColor(): number {
    const hue = this.deps.random();
    return hslToHex(hue, BRIGHT_COLOR_SATURATION, 0.55);
  }
}

function snapshot(p: Player): PlayerSnapshot {
  const { id, name, color, health, alive, kills, deaths, motion, character } = p;
  return { id, name, color, health, alive, kills, deaths, motion, character };
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
