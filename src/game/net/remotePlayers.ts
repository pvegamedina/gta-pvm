// Remote player rendering: human mesh (foot) or vehicle mesh (in a car), name
// tag + health bar sprites, snapshot-interpolated motion, weapon/aim pose, and
// minimap dots. Scoreboard (kills/deaths/ping) is tracked alongside.

import * as THREE from "three";
import type { PlayerMotion, PlayerSnapshot } from "@shared/protocol";
import { makeHuman, type HumanRig } from "../player/human";
import { addVeh, removeVeh, visualVeh, type Vehicle } from "../vehicles/meshes";
import type { VehicleTypeKey } from "../vehicles/types";
import { setHeldWeapon, applyAimPose, type WeaponMeshHandle } from "../combat/weaponMesh";
import { InterpolationBuffer } from "./interpolation";
import { ShootableRegistry } from "../combat/shootables";

export interface RemotePlayer {
  id: string;
  name: string;
  color: number;
  health: number;
  alive: boolean;
  kills: number;
  deaths: number;
  ping: number;
  buffer: InterpolationBuffer;
  humanRig: HumanRig;
  car: Vehicle | null;
  weaponHandle: WeaponMeshHandle | null;
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

export class RemotePlayerManager {
  private players = new Map<string, RemotePlayer>();

  constructor(
    private scene: THREE.Scene,
    private shootables: ShootableRegistry,
  ) {}

  all(): RemotePlayer[] {
    return Array.from(this.players.values());
  }

  get(id: string): RemotePlayer | undefined {
    return this.players.get(id);
  }

  add(snapshot: PlayerSnapshot): void {
    if (this.players.has(snapshot.id)) return;
    const humanRig = makeHuman({ skin: 0xe0ac84, shirt: snapshot.color, pants: 0x2b3a55, hair: 0x2a1c14, shoe: 0xf0f0f0 });
    humanRig.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
    });
    this.scene.add(humanRig.group);
    this.shootables.add(humanRig.group, { kind: "remotePlayer", refId: snapshot.id });
    const nameSprite = makeLabelSprite(snapshot.name, colorToCss(snapshot.color));
    nameSprite.position.set(0, 2.25, 0);
    humanRig.group.add(nameSprite);
    const healthSprite = makeHealthSprite();
    healthSprite.position.set(0, 2.0, 0);
    humanRig.group.add(healthSprite);
    const rp: RemotePlayer = {
      id: snapshot.id,
      name: snapshot.name,
      color: snapshot.color,
      health: snapshot.health,
      alive: snapshot.alive,
      kills: snapshot.kills,
      deaths: snapshot.deaths,
      ping: 0,
      buffer: new InterpolationBuffer(),
      humanRig,
      car: null,
      weaponHandle: null,
      nameSprite,
      healthSprite,
      lastMotion: snapshot.motion,
    };
    this.players.set(snapshot.id, rp);
    if (snapshot.motion) rp.buffer.push(snapshot.motion, performance.now());
  }

  remove(id: string): void {
    const rp = this.players.get(id);
    if (!rp) return;
    this.scene.remove(rp.humanRig.group);
    this.shootables.remove(rp.humanRig.group);
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

  setPing(id: string, ping: number): void {
    const rp = this.players.get(id);
    if (rp) rp.ping = ping;
  }

  /** Interpolates + applies motion to each remote player's mesh (human or car). */
  update(nightF: number): void {
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
        rp.humanRig.group.visible = false;
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
        rp.humanRig.group.visible = true;
        rp.humanRig.group.position.set(motion.p[0], motion.p[1], motion.p[2]);
        rp.humanRig.group.rotation.y = motion.yaw;
        const amp = Math.min(1, motion.speed / 3.4) * 0.7;
        const phase = (now / 1000) * motion.speed * 4.5;
        const s = Math.sin(phase) * amp;
        if (motion.ground) {
          rp.humanRig.lLeg.rotation.x = s;
          rp.humanRig.rLeg.rotation.x = -s;
        }
        if (rp.weaponHandle?.weapon !== motion.weapon) {
          rp.weaponHandle = setHeldWeapon(rp.humanRig, rp.weaponHandle, motion.weapon);
        }
        applyAimPose(rp.humanRig, motion.aiming, motion.weapon !== "fists");
      }
    }
  }
}
