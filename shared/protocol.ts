// Shared network contract between the browser client and the WebSocket server.
// Both sides import this file; keep it free of DOM and Node-only APIs.

export const SERVER_PORT = 3001;
export const WS_PATH = "/";
export const TICK_RATE_HZ = 20;
export const MAX_HEALTH = 100;
export const RESPAWN_DELAY_MS = 3000;
export const MAX_NAME_LENGTH = 16;
export const MAX_SESSION_ID_LENGTH = 100;
/** Sent to (and matched by) both sides when a sessionId reconnect kicks the
 * previous live socket for the same browser session — see server/room.ts
 * onHello/claimSession and the client's "error" handling in game.ts. */
export const SESSION_REPLACED_MESSAGE = "Sesión reemplazada por otra pestaña";
export const MAX_PLAYERS = 16;

export type Vec3 = [number, number, number];

/* ================= CHARACTERS ================= */
/** Character models (public/models/characters/<id>.glb). Order matters: it
 * defines the colour -> character fallback, so append new ids at the end. */
export const CHARACTER_IDS = ["casual_hoodie", "casual_2", "suit", "worker", "punk", "swat", "beach", "farmer"] as const;
export type CharacterId = (typeof CHARACTER_IDS)[number];
/** Used when there is neither an explicit choice nor a server colour yet. */
export const DEFAULT_CHARACTER: CharacterId = "casual_hoodie";

export function isCharacterId(v: unknown): v is CharacterId {
  return typeof v === "string" && (CHARACTER_IDS as readonly string[]).includes(v);
}

/** Deterministic fallback character for a server-assigned colour (`color % N`). */
export function characterForColor(color: number | null | undefined): CharacterId {
  if (color == null || !Number.isFinite(color)) return DEFAULT_CHARACTER;
  const i = Math.abs(Math.trunc(color)) % CHARACTER_IDS.length;
  return CHARACTER_IDS[i];
}

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

// Fallback spawn points on the Campus de El Carmen (map metres, x east, z
// south). The server normally reads the full list from the map file
// (server/mapSpawns.ts) and the client from its loaded map; these keep both
// working when the map is unavailable.
export const SPAWN_POINTS: SpawnPoint[] = [
  { x: -82.3, z: -112, yaw: -0.814 }, // Aulario Galileo Galilei
  { x: 91.5, z: 105.4, yaw: 0.647 }, // Aulario Paulo Freire
  { x: -25.2, z: 212.3, yaw: 0.633 }, // Biblioteca Central
  { x: 290.6, z: 297.9, yaw: -2.484 }, // Comedor Universitario
  { x: 135.2, z: 428.6, yaw: 0.656 }, // Edificio Alan Turing
  { x: -82.3, z: 134.9, yaw: 0.646 }, // Edificio Marie Curie
  { x: 143.5, z: 190.1, yaw: -0.895 }, // Edificio Jacobo del Barco
  { x: -14.6, z: -265, yaw: 2.253 }, // ETS de Ingeniería
];

/* ================= PLAYER STATE ================= */
export interface CarState {
  /** Vehicle catalogue key (src/game/vehicles/catalog.ts); old strings such as "van" are mapped on receipt. */
  type: string;
  color: number;
  yaw: number;
  speed: number;
  steer: number;
  /** Police light bar + siren on. Optional/additive: older clients omit it. */
  siren?: boolean;
  /** Brake lights on. Optional/additive: older clients omit it. */
  brake?: boolean;
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
  /** Aim pitch (rad, + = up) so others see the gun levelled where we look.
   * Optional/additive: older clients omit it (their guns stay level). */
  aimPitch?: number;
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
  /** Chosen character (validated server-side; colour-derived when the client
   * didn't choose). Optional so older servers/clients keep working. */
  character?: string;
}

export type DamageCause = "vehicle" | "fall" | "explosion";

/* ================= CLIENT -> SERVER ================= */
export type ClientMessage =
  | {
      t: "hello";
      name: string;
      /** Client-generated id persisted in localStorage (falls back to an
       * ephemeral per-tab id when storage is unavailable). Optional/additive
       * so older clients without it still work — see server/room.ts. */
      sessionId?: string;
      /** Chosen character id (one of CHARACTER_IDS); optional/additive. */
      character?: string;
    }
  | { t: "state"; motion: PlayerMotion }
  /** Changes the character mid-game (validated + rate-limited server-side). */
  | { t: "setCharacter"; character: string }
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
  | {
      /** The local driver's car hit another player's hitbox — server-validated
       * analogous to "shoot" (alive/self/distance checks + damage scaling). */
      t: "ram";
      targetId: string;
      /** Attacker's car speed (m/s) at the moment of contact; drives damage scaling. */
      speed: number;
    }
  | { t: "ping"; ts: number };

/* ================= SERVER -> CLIENT ================= */
export type ServerMessage =
  | { t: "welcome"; id: string; players: PlayerSnapshot[]; spawn: SpawnPoint }
  | { t: "playerJoined"; player: PlayerSnapshot }
  | { t: "playerLeft"; id: string }
  | { t: "characterChanged"; id: string; character: string }
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
