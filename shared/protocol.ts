// Shared network contract between the browser client and the WebSocket server.
// Both sides import this file; keep it free of DOM and Node-only APIs.

export const SERVER_PORT = 3001;
export const WS_PATH = "/";
export const TICK_RATE_HZ = 20;
export const MAX_HEALTH = 100;
export const RESPAWN_DELAY_MS = 3000;
export const MAX_NAME_LENGTH = 16;
export const MAX_PLAYERS = 16;

export type Vec3 = [number, number, number];

/* ================= WEAPONS ================= */
export type WeaponId = "fists" | "pistol" | "m4";

export interface WeaponSpec {
  id: WeaponId;
  name: string;
  damage: number;
  /** Minimum seconds between two shots. */
  fireInterval: number;
  /** Max effective range in world units (metres). */
  range: number;
  magSize: number;
  /** Spare ammo the player spawns with (outside the magazine). */
  reserve: number;
  reloadTime: number;
  /** true = hold to keep firing. */
  automatic: boolean;
  /** Base cone half-angle in radians. */
  spread: number;
  /** Extra spread added per consecutive shot (recoil bloom), capped by maxSpread. */
  spreadPerShot: number;
  maxSpread: number;
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  fists: {
    id: "fists", name: "Puños", damage: 8, fireInterval: 0.45, range: 1.8,
    magSize: 0, reserve: 0, reloadTime: 0, automatic: false,
    spread: 0, spreadPerShot: 0, maxSpread: 0,
  },
  pistol: {
    id: "pistol", name: "Pistola", damage: 22, fireInterval: 0.22, range: 140,
    magSize: 12, reserve: 96, reloadTime: 1.3, automatic: false,
    spread: 0.004, spreadPerShot: 0.006, maxSpread: 0.03,
  },
  m4: {
    id: "m4", name: "Rifle M4", damage: 15, fireInterval: 0.095, range: 260,
    magSize: 30, reserve: 210, reloadTime: 2.1, automatic: true,
    spread: 0.006, spreadPerShot: 0.0035, maxSpread: 0.045,
  },
};

export const WEAPON_ORDER: WeaponId[] = ["fists", "pistol", "m4"];

/** Server tolerance for fire-rate validation (network jitter). */
export const FIRE_RATE_TOLERANCE = 0.6;
/** Extra metres tolerated on range validation (position latency). */
export const RANGE_TOLERANCE = 12;

/* ================= SPAWNS ================= */
export interface SpawnPoint { x: number; z: number; yaw: number }

// City layout mirrors the client: G=6 blocks, P=78 (block 60 + road 18).
// Points sit on the sidewalk ring, clear of street furniture.
const G = 6, P = 78;
const rc = (i: number) => (i - G / 2) * P;
const bc = (i: number) => (i + 0.5 - G / 2) * P;

export const SPAWN_POINTS: SpawnPoint[] = (() => {
  const pts: SpawnPoint[] = [{ x: 21, z: 10.2, yaw: 2.3 }];
  for (let i = 0; i < G; i++) {
    for (let j = 0; j < G; j++) {
      if ((i + j) % 2 !== 0) continue;
      pts.push({ x: rc(i) + 12.3, z: bc(j), yaw: Math.PI / 2 });
      pts.push({ x: bc(i), z: rc(j + 1) - 12.3, yaw: Math.PI });
    }
  }
  return pts;
})();

/* ================= PLAYER STATE ================= */
export interface CarState {
  /** Vehicle type key on the client (sedan, hatch, suv, sport, van, taxi). */
  type: string;
  color: number;
  yaw: number;
  speed: number;
  steer: number;
}

/** What each client streams about itself ~TICK_RATE_HZ times per second. */
export interface PlayerMotion {
  p: Vec3;
  yaw: number;
  /** Horizontal speed on foot, used for the walk animation. */
  speed: number;
  ground: boolean;
  weapon: WeaponId;
  aiming: boolean;
  car: CarState | null;
}

export interface PlayerSnapshot {
  id: string;
  name: string;
  color: number;
  health: number;
  alive: boolean;
  kills: number;
  deaths: number;
  motion: PlayerMotion | null;
}

export type DamageCause = "vehicle" | "fall" | "explosion";

/* ================= CLIENT -> SERVER ================= */
export type ClientMessage =
  | { t: "hello"; name: string }
  | { t: "state"; motion: PlayerMotion }
  | {
      t: "shoot";
      weapon: WeaponId;
      origin: Vec3;
      /** Where the bullet stopped (hit point or max range). */
      end: Vec3;
      /** Player the client's raycast hit, if any. Server validates it. */
      targetId: string | null;
    }
  | { t: "selfDamage"; amount: number; cause: DamageCause }
  | { t: "ping"; ts: number };

/* ================= SERVER -> CLIENT ================= */
export type ServerMessage =
  | { t: "welcome"; id: string; players: PlayerSnapshot[]; spawn: SpawnPoint }
  | { t: "playerJoined"; player: PlayerSnapshot }
  | { t: "playerLeft"; id: string }
  | { t: "states"; players: { id: string; motion: PlayerMotion }[] }
  | { t: "shot"; shooterId: string; weapon: WeaponId; origin: Vec3; end: Vec3; hit: boolean }
  | { t: "health"; id: string; health: number; attackerId: string | null }
  | { t: "killed"; victimId: string; killerId: string | null; weapon: WeaponId | null; cause: DamageCause | null }
  | { t: "respawned"; id: string; spawn: SpawnPoint; health: number }
  | { t: "scores"; players: { id: string; kills: number; deaths: number }[] }
  | { t: "pong"; ts: number }
  | { t: "error"; message: string };

export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}
