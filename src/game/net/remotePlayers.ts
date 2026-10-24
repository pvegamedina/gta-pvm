// Remote player rendering: animated character rig (foot) or vehicle mesh (in
// a car), name tag + health bar sprites, snapshot-interpolated motion, weapon/
// aim/death animation, and minimap dots. Scoreboard (kills/deaths/ping) is
// tracked alongside. The character model is derived from the server-assigned
// color, so every client shows the same model for the same player.

import * as THREE from "three";
import type { PlayerMotion, PlayerSnapshot, WeaponId } from "@shared/protocol";
import { addVeh, removeVeh, visualVeh, type Vehicle } from "../vehicles/meshes";
import type { VehicleTypeKey } from "../vehicles/types";
import { parseCharacterId, resolveCharacter } from "../characters/characterChoice";
import type { CharacterRig, RigFactory } from "../characters/characterRig";
import { InterpolationBuffer } from "./interpolation";
import { ShootableRegistry } from "../combat/shootables";

export interface RemotePlayer {
  id: string;
  name: string;
  color: number;
  /** Chosen character from the server (validated id), or undefined for old servers. */
  character?: string;
  health: number;
  alive: boolean;
  kills: number;
  deaths: number;
  ping: number;
  buffer: InterpolationBuffer;
  /** null until character assets are ready (see RemotePlayerManager.setRigFactory). */
  rig: CharacterRig | null;
  car: Vehicle | null;
  nameSprite: THREE.Sprite;
  healthSprite: THREE.Sprite;
  lastMotion: PlayerMotion | null;
}

function colorToCss(color: number): string {
  return "#" + color.toString(16).padStart(6, "0");
}

function makeLabelSprite(text: string, color: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "rgba(0,0,0,0.0)";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.font = "bold 32px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.strokeText(text, 128, 36);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 36);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(1.6, 0.4, 1);
  return spr;
}

function makeHealthSprite(): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 16;
  const mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(1.0, 0.12, 1);
  drawHealthBar(spr, 100);
  return spr;
}

function drawHealthBar(spr: THREE.Sprite, health: number): void {
  const tex = (spr.material as THREE.SpriteMaterial).map as THREE.CanvasTexture;
  const c = tex.image as HTMLCanvasElement;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(0, 0, c.width, c.height);
  const pct = Math.max(0, Math.min(1, health / 100));
  ctx.fillStyle = pct > 0.6 ? "#4ade80" : pct > 0.3 ? "#facc15" : "#ef4444";
  ctx.fillRect(2, 2, (c.width - 4) * pct, c.height - 4);
  tex.needsUpdate = true;
}

/** Name tag / health bar heights above the feet (character models are ~1.85 m tall). */
const NAME_TAG_Y = 2.3;
const HEALTH_BAR_Y = 2.05;

export class RemotePlayerManager {
  private players = new Map<string, RemotePlayer>();
  private rigFactory: RigFactory | null = null;

  constructor(
    private scene: THREE.Scene,
    private shootables: ShootableRegistry,
  ) {}

  /** Sets how character rigs are built and (re)creates rigs for players that joined before it was known. */
  setRigFactory(factory: RigFactory): void {
    this.rigFactory = factory;
    for (const rp of this.players.values()) {
      this.detachRig(rp);
      this.attachRig(rp);
    }
  }

  private attachRig(rp: RemotePlayer): void {
    if (!this.rigFactory) return;
    const rig = this.rigFactory({
      character: resolveCharacter(rp.character, rp.color),
      colors: { skin: 0xe0ac84, shirt: rp.color, pants: 0x2b3a55, hair: 0x2a1c14, shoe: 0xf0f0f0 },
      castShadow: true,
    });
    rig.group.add(rp.nameSprite, rp.healthSprite);
    this.scene.add(rig.group);
    this.shootables.add(rig.group, { kind: "remotePlayer", refId: rp.id });
    rp.rig = rig;
  }

  private detachRig(rp: RemotePlayer): void {
    if (!rp.rig) return;
    this.shootables.remove(rp.rig.group);
    rp.rig.group.remove(rp.nameSprite, rp.healthSprite);
    rp.rig.dispose();
    rp.rig = null;
  }

  all(): RemotePlayer[] {
    return Array.from(this.players.values());
  }

  get(id: string): RemotePlayer | undefined {
    return this.players.get(id);
  }

  add(snapshot: PlayerSnapshot): void {
    if (this.players.has(snapshot.id)) return;
    const nameSprite = makeLabelSprite(snapshot.name, colorToCss(snapshot.color));
    nameSprite.position.set(0, NAME_TAG_Y, 0);
    const healthSprite = makeHealthSprite();
    healthSprite.position.set(0, HEALTH_BAR_Y, 0);
    const rp: RemotePlayer = {
      id: snapshot.id,
      name: snapshot.name,
      color: snapshot.color,
      character: snapshot.character,
      health: snapshot.health,
      alive: snapshot.alive,
      kills: snapshot.kills,
      deaths: snapshot.deaths,
      ping: 0,
      buffer: new InterpolationBuffer(),
      rig: null,
      car: null,
      nameSprite,
      healthSprite,
      lastMotion: snapshot.motion,
    };
    this.players.set(snapshot.id, rp);
    this.attachRig(rp);
    if (snapshot.motion) rp.buffer.push(snapshot.motion, performance.now());
  }

  remove(id: string): void {
    const rp = this.players.get(id);
    if (!rp) return;
    this.detachRig(rp);
    if (rp.car) {
      this.shootables.remove(rp.car.root);
      removeVeh(this.scene, rp.car);
    }
    this.players.delete(id);
  }

  pushMotion(id: string, motion: PlayerMotion): void {
    const rp = this.players.get(id);
    if (!rp) return;
    rp.buffer.push(motion, performance.now());
    rp.lastMotion = motion;
  }

  setHealth(id: string, health: number, alive: boolean): void {
    const rp = this.players.get(id);
    if (!rp) return;
    rp.health = health;
    rp.alive = alive;
  }

  setScores(scores: { id: string; kills: number; deaths: number }[]): void {
    for (const s of scores) {
      const rp = this.players.get(s.id);
      if (rp) {
        rp.kills = s.kills;
        rp.deaths = s.deaths;
      }
    }
  }

  /**
   * A remote player picked another character: rebuild their rig (interpolation
   * buffer, name tag and health bar are kept). A corpse they left keeps the
   * old model because it was already detached.
   */
  setCharacter(id: string, character: string): void {
    const rp = this.players.get(id);
    const valid = parseCharacterId(character);
    if (!rp || !valid || rp.character === valid) return;
    rp.character = valid;
    if (!this.rigFactory) return;
    const old = rp.rig;
    const pos = old?.group.position.clone();
    const yaw = old?.group.rotation.y ?? 0;
    this.detachRig(rp);
    this.attachRig(rp);
    if (rp.rig && pos) {
      (rp.rig as CharacterRig).group.position.copy(pos);
      (rp.rig as CharacterRig).group.rotation.y = yaw;
    }
  }

  /** A remote player fired/punched (from a "shot" broadcast): plays the matching animation. */
  notifyAttack(id: string, weapon: WeaponId): void {
    this.players.get(id)?.rig?.triggerAttack(weapon);
  }

  /**
   * Detaches a dying remote player's rig (name tag/health bar stay with the
   * player) so it can become a persistent corpse; a fresh rig takes its place,
   * hidden until the player is alive again.
   */
  detachRigForCorpse(id: string): CharacterRig | null {
    const rp = this.players.get(id);
    if (!rp?.rig || rp.car) return null;
    const old = rp.rig;
    this.shootables.remove(old.group);
    old.group.remove(rp.nameSprite, rp.healthSprite);
    rp.rig = null;
    this.attachRig(rp);
    if (rp.rig) (rp.rig as CharacterRig).group.visible = false;
    return old;
  }

  /** Approximate world velocity (m/s) of a remote player on foot, from its last motion. */
  velocityOf(id: string): { x: number; y: number; z: number } {
    const m = this.players.get(id)?.lastMotion;
    if (!m || m.car) return { x: 0, y: 0, z: 0 };
    return { x: Math.sin(m.yaw) * m.speed, y: 0, z: Math.cos(m.yaw) * m.speed };
  }

  /** World position of a remote player's gun muzzle (into `out`), or null when unknown. */
  muzzleWorldPosition(id: string, out: THREE.Vector3): THREE.Vector3 | null {
    const rig = this.players.get(id)?.rig;
    return rig && rig.group.visible && rig.muzzleWorldPosition(out) ? out : null;
  }

  /** Removes every remote player (rigs, cars, shootables). */
  dispose(): void {
    for (const id of Array.from(this.players.keys())) this.remove(id);
  }

  setPing(id: string, ping: number): void {
    const rp = this.players.get(id);
    if (rp) rp.ping = ping;
  }

  /** Interpolates + applies motion to each remote player's mesh (character or car). */
  update(dt: number, nightF: number): void {
    const now = performance.now();
    for (const rp of this.players.values()) {
      drawHealthBar(rp.healthSprite, rp.alive ? rp.health : 0);
      const motion = rp.buffer.sample(now);
      if (!motion) continue;
      // Name/health sprites billboard automatically (THREE.Sprite always faces the camera).
      if (motion.car) {
        if (!rp.car || rp.car.type !== motion.car.type) {
          if (rp.car) {
            this.shootables.remove(rp.car.root);
            removeVeh(this.scene, rp.car);
          }
          rp.car = addVeh(this.scene, motion.car.type as VehicleTypeKey, motion.car.color, motion.p[0], motion.p[2], motion.car.yaw, "ai");
          rp.car.ai = null;
          this.shootables.add(rp.car.root, { kind: "remoteCar", refId: rp.id });
        }
        if (rp.rig) rp.rig.group.visible = false;
        rp.car.root.visible = true;
        rp.car.x = motion.p[0];
        rp.car.y = motion.p[1];
        rp.car.z = motion.p[2];
        rp.car.yaw = motion.car.yaw;
        rp.car.speed = motion.car.speed;
        rp.car.steerVis = motion.car.steer;
        visualVeh(rp.car, 0, nightF);
      } else {
        if (rp.car) {
          rp.car.root.visible = false;
        }
        const rig = rp.rig;
        if (!rig) continue;
        // Dead players' bodies are corpses now (game.ts); the fresh rig waits hidden.
        rig.group.visible = rp.alive;
        if (!rp.alive) continue;
        rig.group.position.set(motion.p[0], motion.p[1], motion.p[2]);
        rig.group.rotation.y = motion.yaw;
        rig.update(dt, {
          speed: rp.alive ? motion.speed : 0,
          ground: motion.ground,
          weapon: motion.weapon,
          aiming: motion.aiming,
          alive: rp.alive,
        });
      }
    }
  }
}
