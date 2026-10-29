import { describe, expect, it } from "vitest";
import { BOSS_MAX_HEALTH, BOSS_MINIGUN, BOSS_RESPAWN_DELAY_MS } from "@shared/protocol";
import { BOSS_CAR_FACTOR, BOSS_DAMAGE_FLUSH, BossBrain, bossHitChance, type BossDamage, type BossTarget, type BossWorld } from "../bossBrain";

/** Flat open field; an optional wall (x in [wallX0, wallX1]) blocks sight and walking. */
function field(opts: { wall?: [number, number] } = {}): BossWorld {
  const inWall = (x: number) => !!opts.wall && x >= opts.wall[0] && x <= opts.wall[1];
  return {
    groundY: () => 0,
    walkable: (x) => !inWall(x),
    clearLine: (ax, _ay, _az, bx) => {
      if (!opts.wall) return true;
      const lo = Math.min(ax, bx);
      const hi = Math.max(ax, bx);
      return hi < opts.wall[0] || lo > opts.wall[1];
    },
    waypoints: [[0, 0], [30, 0], [0, 30], [-30, 0]],
    home: [0, 0],
  };
}

/** A boss standing at the origin facing +z. */
function bossAt(world = field(), random = () => 0): BossBrain {
  const b = new BossBrain(world, random);
  b.x = 0;
  b.z = 0;
  b.yaw = 0;
  return b;
}

const target = (id: string, x: number, z: number, extra: Partial<BossTarget> = {}): BossTarget => ({ id, x, y: 0, z, alive: true, inCar: false, ...extra });

function run(b: BossBrain, seconds: number, targets: BossTarget[], dt = 0.05): BossDamage[] {
  const out: BossDamage[] = [];
  for (let t = 0; t < seconds - 1e-9; t += dt) out.push(...b.update(dt, targets));
  return out;
}

describe("BossBrain", () => {
  it("locks onto the nearest visible player in range", () => {
    const b = bossAt();
    b.update(0.05, [target("far", 0, 60), target("near", 0, 20), target("out", 0, 200)]);
    expect(b.snapshot().targetId).toBe("near");
    expect(b.snapshot().aim).toEqual([0, 1.2, 20]);
  });

  it("ignores dead players and players behind a building", () => {
    const b = bossAt(field({ wall: [5, 6] }));
    b.update(0.05, [target("hidden", 10, 0), target("dead", 0, 10, { alive: false })]);
    expect(b.snapshot().targetId).toBeNull();
  });

  it("spins the barrels up before the first round", () => {
    const b = bossAt();
    const early = run(b, BOSS_MINIGUN.spinUp * 0.8, [target("p", 0, 10)]);
    expect(early).toEqual([]);
    expect(b.snapshot().spinning).toBe(true);
    expect(b.snapshot().firing).toBe(false);
    run(b, 0.5, [target("p", 0, 10)]);
    expect(b.snapshot().firing).toBe(true);
  });

  it("deals batched damage at roughly rounds/s × damage × hit chance", () => {
    // random() = 0 → every round hits.
    const b = bossAt();
    const hits = run(b, BOSS_MINIGUN.spinUp + 1, [target("p", 0, 10)]);
    const total = hits.reduce((s, h) => s + h.amount, 0);
    const expected = BOSS_MINIGUN.roundsPerSecond * BOSS_MINIGUN.damagePerRound;
    expect(total).toBeGreaterThan(expected * 0.7);
    expect(total).toBeLessThan(expected * 1.3);
    // Batched, not one message per round.
    expect(hits.length).toBeLessThanOrEqual(Math.ceil(1.2 / BOSS_DAMAGE_FLUSH));
    expect(hits.every((h) => h.targetId === "p")).toBe(true);
  });

  it("misses everything when the dice say so, and hurts less inside a car", () => {
    const misses = run(bossAt(field(), () => 0.99), BOSS_MINIGUN.spinUp + 1, [target("p", 0, 10)]);
    expect(misses).toEqual([]);
    const onFoot = run(bossAt(), BOSS_MINIGUN.spinUp + 1, [target("p", 0, 10)]).reduce((s, h) => s + h.amount, 0);
    const inCar = run(bossAt(), BOSS_MINIGUN.spinUp + 1, [target("p", 0, 10, { inCar: true })]).reduce((s, h) => s + h.amount, 0);
    expect(inCar).toBeCloseTo(onFoot * BOSS_CAR_FACTOR, -1);
  });

  it("fires in bursts with pauses", () => {
    const b = bossAt();
    run(b, BOSS_MINIGUN.spinUp + BOSS_MINIGUN.burst + 0.2, [target("p", 0, 10)]);
    expect(b.snapshot().firing).toBe(false);
    run(b, BOSS_MINIGUN.pause + 0.1, [target("p", 0, 10)]);
    expect(b.snapshot().firing).toBe(true);
  });

  it("turns to face a target before shooting", () => {
    const b = bossAt();
    b.update(0.05, [target("p", 0, -20)]); // straight behind
    expect(b.snapshot().spinning).toBe(false);
    run(b, 2, [target("p", 0, -20)]);
    expect(Math.abs(Math.abs(b.yaw) - Math.PI)).toBeLessThan(0.05);
  });

  it("walks towards a far target but holds position up close", () => {
    const far = bossAt();
    run(far, 1, [target("p", 0, 60)]);
    expect(far.z).toBeGreaterThan(1);
    const close = bossAt();
    run(close, 1, [target("p", 0, 15)]);
    expect(close.z).toBe(0);
  });

  it("drops a target that stays hidden, and patrols when nobody is around", () => {
    let k = 0;
    const b = bossAt(field({ wall: [5, 6] }), () => (k++ * 0.37) % 1);
    b.update(0.05, [target("p", 0, 10)]);
    expect(b.snapshot().targetId).toBe("p");
    run(b, 3, [target("p", 10, 0)]); // went behind the wall
    expect(b.snapshot().targetId).toBeNull();
    const before = [b.x, b.z];
    run(b, 6, []);
    expect(Math.hypot(b.x - before[0], b.z - before[1])).toBeGreaterThan(1);
  });

  it("dies, stops shooting and comes back with full health", () => {
    const b = bossAt();
    expect(b.damage(BOSS_MAX_HEALTH - 1)).toBe(false);
    expect(b.damage(5)).toBe(true);
    expect(b.damage(5)).toBe(false);
    const s = b.snapshot();
    expect(s.alive).toBe(false);
    expect(s.health).toBe(0);
    expect(run(b, 1, [target("p", 0, 10)])).toEqual([]);
    run(b, BOSS_RESPAWN_DELAY_MS / 1000, [], 0.5);
    expect(b.alive).toBe(true);
    expect(b.health).toBe(BOSS_MAX_HEALTH);
  });

  it("hit chance falls with distance within sane bounds", () => {
    expect(bossHitChance(5)).toBeGreaterThan(bossHitChance(60));
    expect(bossHitChance(0)).toBeLessThanOrEqual(0.5);
    expect(bossHitChance(1000)).toBeGreaterThanOrEqual(0.12);
  });
});
