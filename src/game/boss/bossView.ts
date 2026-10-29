// How the minigun boss looks: a big SWAT character holding a six-barrel
// minigun (barrels spin while it fires), with its name and a health bar over
// its head. Driven by BossSnapshots — from the server, or from the local
// BossBrain when offline — smoothed between updates. game.ts owns the rounds'
// effects (fireRound) and the corpse (onDeath).

import * as THREE from "three";
import { BOSS_ID, BOSS_MAX_HEALTH, BOSS_MINIGUN, BOSS_NAME, type BossSnapshot } from "@shared/protocol";
import type { CharacterRig, RigFactory } from "../characters/characterRig";
import { MUZZLE_NAME } from "../characters/weaponPose";
import type { ShootableRegistry } from "../combat/shootables";
import { gunmetal, accentMat } from "../combat/weaponTextures";

export const BOSS_SCALE = 1.3;
/** Bullet spread of the minigun around the aim point (rad). */
const SPREAD = 0.035;
const TIP_NAME = "bossMinigunTip";
const NAME_TAG_Y = 2.45;
const HEALTH_BAR_Y = 2.22;

export interface BossViewHooks {
  /** One visible round from `muzzle` towards `end` (effects, sound, impacts). */
  fireRound(muzzle: THREE.Vector3, end: THREE.Vector3, targetId: string | null): void;
  /** The boss died: `rig` (already detached) becomes a corpse. */
  onDeath(rig: CharacterRig): void;
}

/** Six barrels around a spinning hub, housing and ammo box; barrel along +Z, grip at the origin. */
function buildMinigun(): { root: THREE.Group; spinner: THREE.Group } {
  const root = new THREE.Group();
  const metal = gunmetal(0x2a2a2e);
  const dark = accentMat(0x111114);
  const brass = accentMat(0x8a6a2a);

  const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.42, 12), dark);
  housing.rotation.x = Math.PI / 2;
  housing.position.set(0, 0.02, 0.08);
  root.add(housing);

  const spinner = new THREE.Group();
  spinner.position.set(0, 0.02, 0.29);
  const barrel = new THREE.CylinderGeometry(0.018, 0.018, 0.78, 8);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const b = new THREE.Mesh(barrel, metal);
    b.rotation.x = Math.PI / 2;
    b.position.set(Math.cos(a) * 0.055, Math.sin(a) * 0.055, 0.39);
    spinner.add(b);
  }
  for (const z of [0.1, 0.55, 0.76]) {
    const clamp = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.035, 12), dark);
    clamp.rotation.x = Math.PI / 2;
    clamp.position.z = z;
    spinner.add(clamp);
  }
  root.add(spinner);

  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, 0.05), dark);
  handle.position.set(0, -0.1, -0.05);
  root.add(handle);
  const carry = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.3), dark);
  carry.position.set(0, 0.16, 0.1);
  root.add(carry);
  const ammo = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.24), metal);
  ammo.position.set(-0.17, -0.06, 0.02);
  root.add(ammo);
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.12), brass);
  belt.position.set(-0.08, -0.02, 0.06);
  root.add(belt);

  const tip = new THREE.Object3D();
  tip.name = TIP_NAME;
  tip.position.set(0, 0.02, 1.08);
  root.add(tip);
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return { root, spinner };
}

function makeNameSprite(): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 96;
  const ctx = c.getContext("2d")!;
  ctx.font = "900 56px Arial, Helvetica, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 10;
  ctx.strokeStyle = "rgba(0,0,0,0.75)";
  ctx.strokeText(BOSS_NAME, 256, 50);
  ctx.fillStyle = "#ff3b30";
  ctx.fillText(BOSS_NAME, 256, 50);
  const mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(2.4, 0.45, 1);
  spr.renderOrder = 10;
  return spr;
}

function makeHealthSprite(): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 20;
  const mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(1.7, 0.14, 1);
  spr.renderOrder = 10;
  return spr;
}

function drawHealth(spr: THREE.Sprite, health: number): void {
  const tex = (spr.material as THREE.SpriteMaterial).map as THREE.CanvasTexture;
  const c = tex.image as HTMLCanvasElement;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#e11d48";
  ctx.fillRect(3, 3, (c.width - 6) * Math.max(0, Math.min(1, health / BOSS_MAX_HEALTH)), c.height - 6);
  tex.needsUpdate = true;
}

const _grip = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _end = new THREE.Vector3();

export class BossView {
  private rig: CharacterRig | null = null;
  private rigFactory: RigFactory | null = null;
  private readonly minigun = buildMinigun();
  private readonly nameSprite = makeNameSprite();
  private readonly healthSprite = makeHealthSprite();
  private state: BossSnapshot | null = null;
  private shownHealth = -1;
  /** Smoothed transform. */
  private x = 0;
  private y = 0;
  private z = 0;
  private yaw = 0;
  private speed = 0;
  private spinRate = 0;
  private roundAcc = 0;
  /** Seconds since the last snapshot (hidden when stale: server without a boss / gone). */
  private sinceSnapshot = Infinity;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly shootables: ShootableRegistry,
    private readonly hooks: BossViewHooks,
  ) {
    this.nameSprite.position.set(0, NAME_TAG_Y, 0);
    this.healthSprite.position.set(0, HEALTH_BAR_Y, 0);
    this.minigun.root.scale.setScalar(BOSS_SCALE);
    this.minigun.root.visible = false;
    scene.add(this.minigun.root);
  }

  /** (Re)builds the rig with the final character factory (models loaded). */
  setRigFactory(factory: RigFactory): void {
    this.rigFactory = factory;
    this.replaceRig(true);
  }

  /** Latest authoritative state. */
  apply(s: BossSnapshot): void {
    const prev = this.state;
    this.state = s;
    this.sinceSnapshot = 0;
    const jumped = !prev || Math.hypot(s.p[0] - this.x, s.p[2] - this.z) > 12;
    if (jumped || (!prev.alive && s.alive)) {
      this.x = s.p[0];
      this.y = s.p[1];
      this.z = s.p[2];
      this.yaw = s.yaw;
    }
    if (prev?.alive && !s.alive) this.die();
  }

  get alive(): boolean {
    return !!this.state?.alive && this.sinceSnapshot < 3;
  }

  /** Smoothed position (minimap, debug), or null when not around. */
  position(): { x: number; y: number; z: number } | null {
    return this.alive ? { x: this.x, y: this.y, z: this.z } : null;
  }

  update(dt: number, groundY: (x: number, z: number) => number, cameraDistance: number): void {
    this.sinceSnapshot += dt;
    const s = this.state;
    const rig = this.rig;
    const visible = !!s && s.alive && this.sinceSnapshot < 3 && !!rig;
    if (rig) rig.group.visible = visible;
    this.minigun.root.visible = false;
    if (!visible || !s || !rig) return;

    const k = 1 - Math.exp(-10 * dt);
    const px = this.x;
    const pz = this.z;
    this.x += (s.p[0] - this.x) * k;
    this.z += (s.p[2] - this.z) * k;
    this.y = groundY(this.x, this.z);
    this.yaw += Math.atan2(Math.sin(s.yaw - this.yaw), Math.cos(s.yaw - this.yaw)) * k;
    const moved = dt > 0 ? Math.hypot(this.x - px, this.z - pz) / dt : 0;
    this.speed += (moved - this.speed) * Math.min(1, dt * 8);

    rig.group.position.set(this.x, this.y, this.z);
    rig.group.rotation.y = this.yaw;
    const engaged = s.targetId !== null;
    rig.update(dt, {
      speed: this.speed < 0.2 ? 0 : this.speed / BOSS_SCALE,
      ground: true,
      weapon: "m4",
      aiming: engaged,
      alive: true,
      aimPitch: engaged && s.aim ? this.aimPitch(s.aim) : 0,
      cameraDistance,
    });
    if (s.health !== this.shownHealth) {
      this.shownHealth = s.health;
      drawHealth(this.healthSprite, s.health);
    }
    rig.group.updateMatrixWorld(true);
    this.placeMinigun(rig);

    // Barrels: spin while spun up, slow down after.
    const targetRate = s.firing ? 40 : s.spinning ? 22 : 0;
    this.spinRate += (targetRate - this.spinRate) * Math.min(1, dt * (targetRate > this.spinRate ? 3 : 1.2));
    this.minigun.spinner.rotation.z += this.spinRate * dt;

    if (!s.firing || !s.aim) {
      this.roundAcc = 0;
      return;
    }
    this.roundAcc += BOSS_MINIGUN.roundsPerSecond * dt;
    while (this.roundAcc >= 1) {
      this.roundAcc -= 1;
      this.muzzle(_muzzle);
      _end.set(s.aim[0], s.aim[1], s.aim[2]).sub(_muzzle);
      const dist = _end.length();
      _end.normalize();
      _end.x += (Math.random() - 0.5) * SPREAD * 2;
      _end.y += (Math.random() - 0.5) * SPREAD * 2;
      _end.z += (Math.random() - 0.5) * SPREAD * 2;
      _end.normalize().multiplyScalar(dist).add(_muzzle);
      this.hooks.fireRound(_muzzle, _end, s.targetId);
    }
  }

  /** World position of the minigun's barrel tip (or the held gun's). */
  muzzle(out: THREE.Vector3): THREE.Vector3 {
    if (this.minigun.root.visible) return this.minigun.root.getObjectByName(TIP_NAME)!.getWorldPosition(out);
    if (this.rig?.muzzleWorldPosition(out)) return out;
    return out.set(this.x, this.y + 1.6 * BOSS_SCALE, this.z);
  }

  dispose(): void {
    this.dropRig();
    this.minigun.root.removeFromParent();
  }

  /* ---------- internals ---------- */

  private aimPitch(aim: readonly number[]): number {
    const eye = this.y + 1.5 * BOSS_SCALE;
    return Math.atan2(aim[1] - eye, Math.hypot(aim[0] - this.x, aim[2] - this.z));
  }

  /** The minigun replaces the M4 model in the boss's hands (procedural rigs keep their M4). */
  private placeMinigun(rig: CharacterRig): void {
    const holder = rig.group.getObjectByName("weapon:m4");
    const muzzle = holder?.getObjectByName(MUZZLE_NAME);
    if (!holder || !muzzle) return;
    for (const child of holder.children) child.visible = false;
    holder.getWorldPosition(_grip);
    muzzle.getWorldPosition(_muzzle);
    const gun = this.minigun.root;
    gun.position.copy(_grip);
    gun.lookAt(_muzzle);
    gun.visible = true;
  }

  private die(): void {
    const rig = this.rig;
    if (!rig) return;
    this.shootables.remove(rig.group);
    rig.group.remove(this.nameSprite, this.healthSprite);
    rig.group.visible = true;
    this.rig = null;
    this.hooks.onDeath(rig);
    this.replaceRig(false);
  }

  private replaceRig(disposeOld: boolean): void {
    if (disposeOld) this.dropRig();
    if (!this.rigFactory) return;
    const rig = this.rigFactory({
      character: "swat",
      colors: { skin: 0xc68e6a, shirt: 0x1d1d22, pants: 0x1d1d22, hair: 0x111111, shoe: 0x0b0b0b },
      castShadow: true,
    });
    rig.group.scale.setScalar(BOSS_SCALE);
    rig.group.visible = false;
    rig.group.add(this.nameSprite, this.healthSprite);
    this.scene.add(rig.group);
    this.shootables.add(rig.group, { kind: "boss", refId: BOSS_ID });
    this.rig = rig;
  }

  private dropRig(): void {
    if (!this.rig) return;
    this.shootables.remove(this.rig.group);
    this.rig.group.remove(this.nameSprite, this.healthSprite);
    this.rig.dispose();
    this.rig = null;
  }
}
