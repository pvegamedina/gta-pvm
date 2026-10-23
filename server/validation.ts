import {
  MAX_NAME_LENGTH,
  WEAPONS,
  type CarState,
  type DamageCause,
  type PlayerMotion,
  type Vec3,
  type WeaponId,
} from "../shared/protocol";

export const WORLD_LIMIT = 400;
/** Values beyond this are treated as garbage and rejected, not clamped. */
const ABSURD = 1e5;
const DAMAGE_CAUSES: readonly DamageCause[] = ["vehicle", "fall", "explosion"];

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const sane = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= ABSURD;

const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));

export function isWeaponId(v: unknown): v is WeaponId {
  return typeof v === "string" && Object.hasOwn(WEAPONS, v);
}

export function isDamageCause(v: unknown): v is DamageCause {
  return typeof v === "string" && (DAMAGE_CAUSES as readonly string[]).includes(v);
}

export function parseVec3(v: unknown, clampTo = true): Vec3 | null {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(sane)) return null;
  const [x, y, z] = v as number[];
  return clampTo
    ? [clamp(x, WORLD_LIMIT), clamp(y, WORLD_LIMIT), clamp(z, WORLD_LIMIT)]
    : [x, y, z];
}

function parseCar(v: unknown): CarState | null | undefined {
  if (v === null) return null;
  if (!isRecord(v)) return undefined;
  const { type, color, yaw, speed, steer } = v;
  if (typeof type !== "string" || type.length > 24) return undefined;
  if (![color, yaw, speed, steer].every(sane)) return undefined;
  return { type, color: color as number, yaw: yaw as number, speed: speed as number, steer: steer as number };
}

/** Returns a sanitized motion or null when the payload is malformed. */
export function parseMotion(v: unknown): PlayerMotion | null {
  if (!isRecord(v)) return null;
  const p = parseVec3(v.p);
  const car = parseCar(v.car);
  if (!p || car === undefined) return null;
  if (!sane(v.yaw) || !sane(v.speed)) return null;
  if (typeof v.ground !== "boolean" || typeof v.aiming !== "boolean") return null;
  if (!isWeaponId(v.weapon)) return null;
  return { p, yaw: v.yaw, speed: v.speed, ground: v.ground, weapon: v.weapon, aiming: v.aiming, car };
}

export function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const cleaned = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .trim();
  return cleaned || fallback;
}
