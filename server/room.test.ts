import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_HEALTH,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  RESPAWN_DELAY_MS,
  WEAPONS,
  CHARACTER_IDS,
  characterForColor,
  type ClientMessage,
  type PlayerMotion,
  type ServerMessage,
} from "../shared/protocol";
import { BOSS_ID, BOSS_MAX_HEALTH, BOSS_MINIGUN } from "../shared/protocol";
import { BossBrain, type BossWorld } from "../src/game/boss/bossBrain";
import { GameRoom, type RoomDeps } from "./room";
import { WORLD_LIMIT } from "./validation";

interface Sent { to: string; msg: ServerMessage }
interface Broadcast { msg: ServerMessage; except?: string }

function setup(extra: Partial<RoomDeps> = {}) {
  let time = 1000;
  const sent: Sent[] = [];
  const broadcasts: Broadcast[] = [];
  const timers: { fn: () => void; at: number }[] = [];
  const disconnected: string[] = [];
  const room = new GameRoom({
    now: () => time,
    send: (to, msg) => sent.push({ to, msg }),
    broadcast: (msg, except) => broadcasts.push({ msg, except }),
    random: () => 0.5,
    schedule: (fn, ms) => { timers.push({ fn, at: time + ms }); },
    disconnect: (id) => {
      disconnected.push(id);
      room.leave(id); // mirrors the real socket "close" handler in server/index.ts
    },
    ...extra,
  });
  const advance = (ms: number) => {
    time += ms;
    for (const t of timers.filter((x) => x.at <= time)) {
      timers.splice(timers.indexOf(t), 1);
      t.fn();
    }
  };
  const sentTo = (id: string, type: ServerMessage["t"]) =>
    sent.filter((s) => s.to === id && s.msg.t === type).map((s) => s.msg);
  const bcast = (type: ServerMessage["t"]) =>
    broadcasts.filter((b) => b.msg.t === type);
  return { room, sent, broadcasts, advance, sentTo, bcast, disconnected };
}

const motion = (x: number, z = 0, car: PlayerMotion["car"] = null): PlayerMotion => ({
  p: [x, 0, z], yaw: 0, speed: 0, ground: true, weapon: "pistol", aiming: false, car,
});

const shoot = (targetId: string | null, weapon: "fists" | "pistol" | "m4" = "pistol"): ClientMessage => ({
  t: "shoot", weapon, origin: [0, 1, 0], end: [5, 1, 0], targetId,
});

type Ctx = ReturnType<typeof setup>;

function joinPlayer(c: Ctx, id: string, name = id, x = 0) {
  c.room.join(id);
  c.room.handle(id, { t: "hello", name });
  c.room.handle(id, { t: "state", motion: motion(x) });
}

describe("GameRoom", () => {
  let c: Ctx;
  beforeEach(() => { c = setup(); });

  it("replies welcome with existing players and broadcasts playerJoined", () => {
    joinPlayer(c, "a", "Ana");
    c.room.join("b");
    c.room.handle("b", { t: "hello", name: "Beto" });
    const welcome = c.sentTo("b", "welcome")[0] as Extract<ServerMessage, { t: "welcome" }>;
    expect(welcome.id).toBe("b");
    expect(welcome.players.map((p) => p.id).sort()).toEqual(["a", "b"]);
    expect(welcome.spawn).toHaveProperty("x");
    const joined = c.bcast("playerJoined").find(
      (b) => (b.msg as { player: { id: string } }).player.id === "b",
    );
    expect(joined?.except).toBe("b");
  });

  it("sanitizes names", () => {
    c.room.join("a");
    c.room.handle("a", { t: "hello", name: "  \u0007Bad\u0000Name" + "x".repeat(40) + " " });
    const w = c.sentTo("a", "welcome")[0] as Extract<ServerMessage, { t: "welcome" }>;
    const name = w.players[0].name;
    expect(name.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
    expect(name.startsWith("BadName")).toBe(true);
    c.room.join("b");
    c.room.handle("b", { t: "hello", name: "   " });
    const w2 = c.sentTo("b", "welcome")[0] as Extract<ServerMessage, { t: "welcome" }>;
    expect(w2.players.find((p) => p.id === "b")?.name).toMatch(/^Jugador \d+$/);
  });

  it("replaces the previous live socket when the same sessionId reconnects", () => {
    c.room.join("old");
    c.room.handle("old", { t: "hello", name: "Ana", sessionId: "S1" } as unknown as ClientMessage);
    c.room.join("new");
    c.room.handle("new", { t: "hello", name: "Ana2", sessionId: "S1" } as unknown as ClientMessage);

    expect(c.disconnected).toEqual(["old"]);
    expect(c.sentTo("old", "error")).toHaveLength(1);
    expect((c.sentTo("old", "error")[0] as Extract<ServerMessage, { t: "error" }>).message).toMatch(/sesión|session/i);
    expect(c.bcast("playerLeft").some((b) => (b.msg as { id: string }).id === "old")).toBe(true);

    const welcome = c.sentTo("new", "welcome")[0] as Extract<ServerMessage, { t: "welcome" }>;
    expect(welcome.id).toBe("new");
    // Simpler, GameRoom-clean design: a resumed session frees the slot and
    // starts fresh stats/name rather than transplanting old state.
    expect(welcome.players.find((p) => p.id === "new")?.name).toBe("Ana2");
    expect(welcome.players.find((p) => p.id === "old")).toBeUndefined();
  });

  it("does not kick anyone for a brand-new sessionId", () => {
    joinPlayer(c, "a", "A");
    c.room.join("b");
    c.room.handle("b", { t: "hello", name: "B", sessionId: "different" } as unknown as ClientMessage);
    expect(c.disconnected).toHaveLength(0);
    expect(c.sentTo("a", "error")).toHaveLength(0);
  });

  it("does not kick a live session when a sessionId is reused after the old owner already left", () => {
    c.room.join("old");
    c.room.handle("old", { t: "hello", name: "Ana", sessionId: "S1" } as unknown as ClientMessage);
    c.room.leave("old");
    c.disconnected.length = 0;
    c.broadcasts.length = 0;

    c.room.join("new");
    c.room.handle("new", { t: "hello", name: "Ana2", sessionId: "S1" } as unknown as ClientMessage);
    expect(c.disconnected).toHaveLength(0);
    expect(c.sentTo("new", "welcome")).toHaveLength(1);
  });

  it("treats a missing sessionId as a normal anonymous join", () => {
    joinPlayer(c, "a", "A");
    expect(c.disconnected).toHaveLength(0);
    expect(c.sentTo("a", "welcome")).toHaveLength(1);
  });

  it("ignores messages before hello", () => {
    c.room.join("a");
    c.room.handle("a", { t: "state", motion: motion(0) });
    c.room.handle("a", shoot(null));
    c.room.handle("a", { t: "ping", ts: 1 });
    expect(c.sent).toHaveLength(0);
    expect(c.broadcasts).toHaveLength(0);
  });

  it("rejects joins beyond MAX_PLAYERS", () => {
    for (let i = 0; i < MAX_PLAYERS; i++) joinPlayer(c, `p${i}`);
    c.room.join("extra");
    c.room.handle("extra", { t: "hello", name: "X" });
    expect(c.sentTo("extra", "error")).toHaveLength(1);
    expect(c.sentTo("extra", "welcome")).toHaveLength(0);
  });

  it("ignores invalid state and clamps coordinates", () => {
    joinPlayer(c, "a");
    c.room.tick();
    c.broadcasts.length = 0;
    c.room.handle("a", { t: "state", motion: { ...motion(0), p: [NaN, 0, 0] } });
    c.room.handle("a", { t: "state", motion: { ...motion(0), p: [1e12, 0, 0] } });
    c.room.handle("a", { t: "state", motion: "junk" } as unknown as ClientMessage);
    c.room.handle("a", { t: "state", motion: { ...motion(0), weapon: "bazooka" } } as unknown as ClientMessage);
    c.room.tick();
    const states = c.bcast("states")[0].msg as Extract<ServerMessage, { t: "states" }>;
    expect(states.players[0].motion.p[0]).toBe(0);

    c.room.handle("a", { t: "state", motion: motion(5000, -5000) });
    c.broadcasts.length = 0;
    c.room.tick();
    const s2 = c.bcast("states")[0].msg as Extract<ServerMessage, { t: "states" }>;
    expect(s2.players[0].motion.p[0]).toBe(WORLD_LIMIT);
    expect(s2.players[0].motion.p[2]).toBe(-WORLD_LIMIT);
  });

  it("applies weapon damage on a valid hit and broadcasts shot with hit=true", () => {
    joinPlayer(c, "a", "A", 0);
    joinPlayer(c, "b", "B", 10);
    c.room.handle("a", shoot("b"));
    const health = c.bcast("health").at(-1)!.msg as Extract<ServerMessage, { t: "health" }>;
    expect(health).toMatchObject({ id: "b", health: MAX_HEALTH - WEAPONS.pistol.damage, attackerId: "a" });
    const shot = c.bcast("shot").at(-1)!;
    expect(shot.except).toBe("a");
    expect((shot.msg as { hit: boolean }).hit).toBe(true);
  });

  it("broadcasts car motion with a real RGB hex color (not clamped to the position sanity range)", () => {
    joinPlayer(c, "a");
    c.broadcasts.length = 0;
    // 0xc0392b (12599851) is a typical vehicle color, far above the generic
    // "absurd value" guard used for positions/speeds — it must still pass.
    c.room.handle("a", {
      t: "state",
      motion: motion(0, 0, { type: "sedan", color: 0xc0392b, yaw: 0, speed: 0, steer: 0 }),
    });
    c.room.tick();
    const states = c.bcast("states")[0].msg as Extract<ServerMessage, { t: "states" }>;
    expect(states.players[0].motion.car).toMatchObject({ type: "sedan", color: 0xc0392b });
  });

  it("reduces damage to 60% for players in a car", () => {
    joinPlayer(c, "a", "A", 0);
    joinPlayer(c, "b", "B", 10);
    c.room.handle("b", {
      t: "state",
      motion: motion(10, 0, { type: "sedan", color: 0, yaw: 0, speed: 0, steer: 0 }),
    });
    c.room.handle("a", shoot("b"));
    const health = c.bcast("health").at(-1)!.msg as Extract<ServerMessage, { t: "health" }>;
    expect(health.health).toBe(MAX_HEALTH - Math.round(WEAPONS.pistol.damage * 0.6));
  });

  it("does not apply an out-of-range hit but still broadcasts the shot", () => {
    joinPlayer(c, "a", "A", 0);
    joinPlayer(c, "b", "B", WEAPONS.pistol.range + 100);
    c.room.handle("a", shoot("b"));
    expect(c.bcast("health")).toHaveLength(0);
    const shot = c.bcast("shot").at(-1)!.msg as { hit: boolean };
    expect(shot.hit).toBe(false);
  });

  it("drops too-fast fire silently", () => {
    joinPlayer(c, "a", "A", 0);
    joinPlayer(c, "b", "B", 10);
    c.room.handle("a", shoot("b"));
    c.advance(10);
    c.room.handle("a", shoot("b"));
    expect(c.bcast("shot")).toHaveLength(1);
    expect(c.bcast("health")).toHaveLength(1);
    c.advance(WEAPONS.pistol.fireInterval * 1000);
    c.room.handle("a", shoot("b"));
    expect(c.bcast("shot")).toHaveLength(2);
  });

  it("rejects unknown weapons", () => {
    joinPlayer(c, "a");
    c.room.handle("a", { ...shoot(null), weapon: "rpg" } as unknown as ClientMessage);
    expect(c.bcast("shot")).toHaveLength(0);
  });

  it("does not damage dead targets", () => {
    joinPlayer(c, "a", "A", 0);
    joinPlayer(c, "b", "B", 5);
    c.room.handle("b", { t: "selfDamage", amount: 1000, cause: "fall" });
    const healthCount = c.bcast("health").length;
    c.advance(1000);
    c.room.handle("a", shoot("b"));
    expect(c.bcast("health")).toHaveLength(healthCount);
  });

  it("credits kills and deaths and broadcasts killed + scores", () => {
    joinPlayer(c, "a", "A", 0);
    joinPlayer(c, "b", "B", 5);
    for (let i = 0; i < 5; i++) {
      c.room.handle("a", shoot("b"));
      c.advance(500);
    }
    const killed = c.bcast("killed")[0].msg as Extract<ServerMessage, { t: "killed" }>;
    expect(killed).toMatchObject({ victimId: "b", killerId: "a", weapon: "pistol", cause: null });
    const scores = c.bcast("scores").at(-1)!.msg as Extract<ServerMessage, { t: "scores" }>;
    expect(scores.players.find((p) => p.id === "a")).toMatchObject({ kills: 1, deaths: 0 });
    expect(scores.players.find((p) => p.id === "b")).toMatchObject({ kills: 0, deaths: 1 });
  });

  it("spawns and respawns players at the map's spawn points when given", () => {
    const spawns = [{ x: 91.5, z: 105.4, yaw: 0.647 }, { x: -25.2, z: 212.3, yaw: 0.633 }];
    const m = setup({ spawns, random: () => 0.75 });
    joinPlayer(m as Ctx, "a");
    const welcome = m.sentTo("a", "welcome")[0] as Extract<ServerMessage, { t: "welcome" }>;
    expect(welcome.spawn).toEqual(spawns[1]);
    joinPlayer(m as Ctx, "b");
    m.room.handle("b", { t: "selfDamage", amount: MAX_HEALTH, cause: "fall" });
    m.advance(RESPAWN_DELAY_MS);
    const r = m.bcast("respawned")[0].msg as Extract<ServerMessage, { t: "respawned" }>;
    expect(spawns).toContainEqual(r.spawn);
  });

  it("accepts positions anywhere on the 1.2 km campus", () => {
    joinPlayer(c, "a");
    c.room.handle("a", { t: "state", motion: motion(575, 640) });
    c.broadcasts.length = 0;
    c.room.tick();
    const s = c.bcast("states")[0].msg as Extract<ServerMessage, { t: "states" }>;
    expect(s.players[0].motion.p[0]).toBe(575);
    expect(s.players[0].motion.p[2]).toBe(640);
  });

  it("respawns after the delay with full health", () => {
    joinPlayer(c, "a", "A", 0);
    c.room.handle("a", { t: "selfDamage", amount: MAX_HEALTH, cause: "fall" });
    expect(c.bcast("respawned")).toHaveLength(0);
    c.advance(RESPAWN_DELAY_MS);
    const r = c.bcast("respawned")[0].msg as Extract<ServerMessage, { t: "respawned" }>;
    expect(r).toMatchObject({ id: "a", health: MAX_HEALTH });
    c.room.handle("a", { t: "selfDamage", amount: 10, cause: "fall" });
    const h = c.bcast("health").at(-1)!.msg as Extract<ServerMessage, { t: "health" }>;
    expect(h.health).toBe(MAX_HEALTH - 10);
  });

  it("clamps selfDamage, kills without killer credit, and ignores non-finite", () => {
    joinPlayer(c, "a", "A", 0);
    c.room.handle("a", { t: "selfDamage", amount: NaN, cause: "fall" });
    c.room.handle("a", { t: "selfDamage", amount: -50, cause: "fall" });
    expect(c.bcast("health").every((b) => (b.msg as { health: number }).health <= MAX_HEALTH)).toBe(true);
    c.room.handle("a", { t: "selfDamage", amount: 1e9, cause: "vehicle" });
    const killed = c.bcast("killed")[0].msg as Extract<ServerMessage, { t: "killed" }>;
    expect(killed).toMatchObject({ victimId: "a", killerId: null, weapon: null, cause: "vehicle" });
    const scores = c.bcast("scores").at(-1)!.msg as Extract<ServerMessage, { t: "scores" }>;
    expect(scores.players[0]).toMatchObject({ kills: 0, deaths: 1 });
  });

  it("applies ram damage scaled by speed and broadcasts health", () => {
    joinPlayer(c, "a", "A", 0);
    joinPlayer(c, "b", "B", 5);
    c.room.handle("a", { t: "ram", targetId: "b", speed: 20 });
    const health = c.bcast("health").at(-1)!.msg as Extract<ServerMessage, { t: "health" }>;
    // threshold 6, per-unit 2.2, cap 70 => (20-6)*2.2 = 30.8 -> rounds in applyDamage? applyDamage uses raw.
    expect(health.id).toBe("b");
    expect(health.health).toBeLessThan(MAX_HEALTH);
    expect(health.attackerId).toBe("a");
  });

  it("ignores ram contact at walking-pace speed (no damage)", () => {
    joinPlayer(c, "a", "A", 0);
    joinPlayer(c, "b", "B", 5);
    c.room.handle("a", { t: "ram", targetId: "b", speed: 2 });
    expect(c.bcast("health")).toHaveLength(0);
  });

  it("rate-limits ram damage between the same attacker/target pair", () => {
    joinPlayer(c, "a", "A", 0);
    joinPlayer(c, "b", "B", 5);
    c.room.handle("a", { t: "ram", targetId: "b", speed: 20 });
    c.room.handle("a", { t: "ram", targetId: "b", speed: 20 });
    expect(c.bcast("health")).toHaveLength(1);
    c.advance(1000);
    c.room.handle("a", { t: "ram", targetId: "b", speed: 20 });
    expect(c.bcast("health")).toHaveLength(2);
  });

  it("rejects ram against a target that is too far away", () => {
    joinPlayer(c, "a", "A", 0);
    joinPlayer(c, "b", "B", 50);
    c.room.handle("a", { t: "ram", targetId: "b", speed: 20 });
    expect(c.bcast("health")).toHaveLength(0);
  });

  it("rejects self-ram and ram against a dead or unknown target", () => {
    joinPlayer(c, "a", "A", 0);
    joinPlayer(c, "b", "B", 5);
    c.room.handle("a", { t: "ram", targetId: "a", speed: 20 });
    c.room.handle("a", { t: "ram", targetId: "ghost", speed: 20 });
    c.room.handle("b", { t: "selfDamage", amount: MAX_HEALTH, cause: "fall" });
    c.broadcasts.length = 0;
    c.room.handle("a", { t: "ram", targetId: "b", speed: 20 });
    expect(c.bcast("health")).toHaveLength(0);
  });

  it("answers ping with pong", () => {
    joinPlayer(c, "a");
    c.room.handle("a", { t: "ping", ts: 42 });
    expect(c.sentTo("a", "pong")[0]).toEqual({ t: "pong", ts: 42 });
  });

  it("broadcasts playerLeft on leave", () => {
    joinPlayer(c, "a");
    c.room.leave("a");
    expect(c.bcast("playerLeft")[0].msg).toEqual({ t: "playerLeft", id: "a" });
  });

  it("does not broadcast playerLeft for a client that never said hello", () => {
    c.room.join("a");
    c.room.leave("a");
    expect(c.bcast("playerLeft")).toHaveLength(0);
  });

  describe("character selection", () => {
    const welcomeOf = (id: string) => c.sentTo(id, "welcome")[0] as Extract<ServerMessage, { t: "welcome" }>;

    it("stores a valid chosen character and shares it in welcome/playerJoined", () => {
      c.room.join("a");
      c.room.handle("a", { t: "hello", name: "Ana", character: "swat" });
      expect(welcomeOf("a").players.find((p) => p.id === "a")?.character).toBe("swat");
      const joined = c.bcast("playerJoined")[0].msg as Extract<ServerMessage, { t: "playerJoined" }>;
      expect(joined.player.character).toBe("swat");
      c.room.join("b");
      c.room.handle("b", { t: "hello", name: "Beto" });
      expect(welcomeOf("b").players.find((p) => p.id === "a")?.character).toBe("swat");
    });

    it("falls back to the colour-derived character for invalid or missing choices", () => {
      c.room.join("a");
      c.room.handle("a", { t: "hello", name: "Ana", character: "dragon" });
      const a = welcomeOf("a").players.find((p) => p.id === "a")!;
      expect(a.character).toBe(characterForColor(a.color));
      c.room.join("b");
      c.room.handle("b", { t: "hello", name: "Beto" }); // old client: no field
      const b = welcomeOf("b").players.find((p) => p.id === "b")!;
      expect(CHARACTER_IDS).toContain(b.character);
      expect(b.character).toBe(characterForColor(b.color));
    });

    it("broadcasts characterChanged on a valid change and ignores invalid ones", () => {
      joinPlayer(c, "a");
      c.room.handle("a", { t: "setCharacter", character: "punk" });
      const changed = c.bcast("characterChanged");
      expect(changed).toHaveLength(1);
      expect(changed[0].msg).toEqual({ t: "characterChanged", id: "a", character: "punk" });
      c.room.handle("a", { t: "setCharacter", character: "nope" });
      c.room.handle("a", { t: "setCharacter", character: 42 } as unknown as ClientMessage);
      expect(c.bcast("characterChanged")).toHaveLength(1);
      // new joiners see the current choice
      c.room.join("b");
      c.room.handle("b", { t: "hello", name: "Beto" });
      expect(welcomeOf("b").players.find((p) => p.id === "a")?.character).toBe("punk");
    });

    it("does not broadcast when the character doesn't actually change", () => {
      c.room.join("a");
      c.room.handle("a", { t: "hello", name: "Ana", character: "farmer" });
      c.room.handle("a", { t: "setCharacter", character: "farmer" });
      expect(c.bcast("characterChanged")).toHaveLength(0);
    });

    it("rate-limits setCharacter spam", () => {
      joinPlayer(c, "a");
      for (let i = 0; i < 20; i++) c.room.handle("a", { t: "setCharacter", character: CHARACTER_IDS[i % CHARACTER_IDS.length] });
      const burst = c.bcast("characterChanged").length;
      expect(burst).toBeGreaterThan(0);
      expect(burst).toBeLessThanOrEqual(4);
      // Allowed again once the window has passed.
      c.advance(1100);
      c.room.handle("a", { t: "setCharacter", character: "beach" });
      c.room.handle("a", { t: "setCharacter", character: "suit" });
      expect(c.bcast("characterChanged").length).toBeGreaterThan(burst);
    });
  });

  describe("boss", () => {
    const open: BossWorld = {
      groundY: () => 0,
      walkable: () => true,
      clearLine: () => true,
      waypoints: [[0, 0]],
      home: [0, 0],
    };
    /** Boss at the origin facing +x (where joinPlayer puts players); every round hits. */
    function withBoss() {
      const boss = new BossBrain(open, () => 0);
      boss.yaw = Math.PI / 2;
      return { ctx: setup({ boss }), boss };
    }
    const tickFor = (ctx: Ctx, seconds: number) => {
      for (let t = 0; t < seconds; t += 0.05) {
        ctx.advance(50);
        ctx.room.tick();
      }
    };

    it("broadcasts its state every tick once someone is playing", () => {
      const { ctx } = withBoss();
      ctx.room.tick();
      expect(ctx.bcast("boss")).toHaveLength(0);
      joinPlayer(ctx, "a", "Ana", 10);
      ctx.room.tick();
      const msg = ctx.bcast("boss").at(-1)?.msg as Extract<ServerMessage, { t: "boss" }>;
      expect(msg.boss.alive).toBe(true);
      expect(msg.boss.health).toBe(BOSS_MAX_HEALTH);
    });

    it("shoots players with the minigun and gets the kill", () => {
      const { ctx } = withBoss();
      joinPlayer(ctx, "a", "Ana", 10);
      tickFor(ctx, BOSS_MINIGUN.spinUp + 0.5);
      const hurt = ctx.bcast("health").map((b) => b.msg as Extract<ServerMessage, { t: "health" }>);
      expect(hurt.length).toBeGreaterThan(0);
      expect(hurt.every((h) => h.id === "a" && h.attackerId === BOSS_ID)).toBe(true);
      tickFor(ctx, 4);
      const killed = ctx.bcast("killed")[0]?.msg as Extract<ServerMessage, { t: "killed" }>;
      expect(killed).toMatchObject({ victimId: "a", killerId: BOSS_ID });
    });

    it("takes damage from player shots and credits the kill", () => {
      const { ctx, boss } = withBoss();
      joinPlayer(ctx, "a", "Ana", 10);
      boss.health = WEAPONS.pistol.damage;
      ctx.room.handle("a", shoot(BOSS_ID));
      expect(boss.alive).toBe(false);
      const killed = ctx.bcast("killed")[0]?.msg as Extract<ServerMessage, { t: "killed" }>;
      expect(killed).toMatchObject({ victimId: BOSS_ID, killerId: "a", weapon: "pistol" });
      const scores = ctx.bcast("scores").at(-1)?.msg as Extract<ServerMessage, { t: "scores" }>;
      expect(scores.players.find((p) => p.id === "a")?.kills).toBe(1);
    });

    it("ignores shots at the boss from out of range", () => {
      const { ctx, boss } = withBoss();
      joinPlayer(ctx, "a", "Ana", WEAPONS.pistol.range + 100);
      ctx.room.handle("a", shoot(BOSS_ID));
      expect(boss.health).toBe(BOSS_MAX_HEALTH);
    });
  });
});
