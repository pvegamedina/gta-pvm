// Visual/audio weapon effects: muzzle flash, visible bullet streaks that fly
// from the muzzle to the impact point (spark on arrival), and synthesized
// gunshot/reload/dry-click sounds through the shared audio graph. Bullets are
// purely cosmetic — hits stay hitscan and server-authoritative (game.ts).

import * as THREE from "three";
import type { WeaponId } from "@shared/protocol";
import { radialTex } from "../world/materials";
import type { AudioSystem } from "../audio/audio";
import { bulletStreak, createBulletStreak } from "./bullets";

interface Timed {
  obj: THREE.Object3D;
  life: number;
  maxLife: number;
  kind: "flash" | "spark" | "light";
  base?: number;
}

export interface EffectsSystem {
  update(dt: number): void;
  muzzleFlash(pos: THREE.Vector3, weapon?: WeaponId): void;
  /** Visible bullet from `from` to `to`; `hit` sparks at `to` when it arrives. */
  bullet(from: THREE.Vector3, to: THREE.Vector3, weapon: WeaponId, hit: boolean): void;
  impactSpark(pos: THREE.Vector3): void;
  gunshot(weapon: WeaponId, distance: number): void;
  dryClick(): void;
  reloadSound(weapon: WeaponId): void;
  /** Removes every effect from the scene and frees pooled GPU resources. */
  dispose(): void;
}

// ---- Bullet tunables ----
/** Visual bullet speed (m/s). Real speeds (~400-900 m/s) cross the screen in a
 * frame or two at 60 fps; this keeps each round readable in flight. */
export const BULLET_SPEED = 220;
/** Length of the bright core streak (m); the soft trail is TRAIL_FACTOR times longer. */
export const BULLET_STREAK_LENGTH = 2.2;
const BULLET_TRAIL_FACTOR = 2;
/** Cross-section of the core / trail boxes (m). */
const BULLET_CORE_WIDTH = 0.05;
const BULLET_TRAIL_WIDTH = 0.15;
/** Upper bound of simultaneously drawn bullets; the oldest is recycled beyond it. */
const MAX_BULLETS = 96;
const BULLET_STYLE: Record<WeaponId, { core: number; trail: number }> = {
  fists: { core: 0xfff0b0, trail: 0xff9a3c },
  pistol: { core: 0xfff0b0, trail: 0xff9a3c },
  m4: { core: 0xffe2a0, trail: 0xff8a2a },
};

interface Bullet {
  group: THREE.Group;
  core: THREE.Mesh;
  trail: THREE.Mesh;
  origin: THREE.Vector3;
  end: THREE.Vector3;
  elapsed: number;
  hit: boolean;
}

const flashTex = (): THREE.CanvasTexture =>
  radialTex([
    [0, "rgba(255,245,210,1)"],
    [0.4, "rgba(255,200,100,0.8)"],
    [1, "rgba(255,150,50,0)"],
  ]);
const coreTex = (): THREE.CanvasTexture =>
  radialTex([
    [0, "rgba(255,255,255,1)"],
    [0.3, "rgba(255,245,200,0.95)"],
    [1, "rgba(255,200,120,0)"],
  ]);
const sparkTex = (): THREE.CanvasTexture =>
  radialTex([
    [0, "rgba(255,230,180,1)"],
    [0.5, "rgba(255,160,80,0.7)"],
    [1, "rgba(255,120,40,0)"],
  ]);

export function createEffectsSystem(scene: THREE.Scene, audio: AudioSystem): EffectsSystem {
  const active: Timed[] = [];
  let flashMat: THREE.SpriteMaterial | null = null;
  let coreMat: THREE.SpriteMaterial | null = null;
  let sparkMat: THREE.SpriteMaterial | null = null;

  function spawnFlash(pos: THREE.Vector3, weapon?: WeaponId): void {
    flashMat = flashMat || new THREE.SpriteMaterial({ map: flashTex(), transparent: true, depthWrite: false, fog: false });
    coreMat =
      coreMat || new THREE.SpriteMaterial({ map: coreTex(), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
    const big = weapon === "m4" ? 1.3 : 1;
    const rot = Math.random() * Math.PI * 2;

    // Layered flash: a soft outer glow plus a brighter, faster-fading core,
    // each rotated randomly so consecutive shots don't look identical.
    const glow = new THREE.Sprite(flashMat.clone());
    (glow.material as THREE.SpriteMaterial).rotation = rot;
    glow.scale.set(0.55 * big, 0.55 * big, 1);
    glow.position.copy(pos);
    scene.add(glow);

    const core = new THREE.Sprite(coreMat.clone());
    (core.material as THREE.SpriteMaterial).rotation = -rot * 1.4;
    core.scale.set(0.26 * big, 0.26 * big, 1);
    core.position.copy(pos);
    scene.add(core);

    const baseIntensity = weapon === "m4" ? 7 : 6;
    const light = new THREE.PointLight(0xffcc66, baseIntensity, 6, 2);
    light.position.copy(pos);
    scene.add(light);

    active.push({ obj: glow, life: 0.05, maxLife: 0.05, kind: "flash" });
    active.push({ obj: core, life: 0.032, maxLife: 0.032, kind: "flash" });
    active.push({ obj: light, life: 0.06, maxLife: 0.06, kind: "light", base: baseIntensity });
  }

  // ---- Bullets: pooled streak meshes sharing one geometry + per-weapon materials ----
  // Unit box spanning z in [-1, 0]: the head sits at the group origin and the
  // streak extends backwards, so scaling z by the length stretches the tail.
  const bulletGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, -0.5);
  const bulletMat = (color: number, opacity: number) =>
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
  const coreMats = {} as Record<WeaponId, THREE.MeshBasicMaterial>;
  const trailMats = {} as Record<WeaponId, THREE.MeshBasicMaterial>;
  for (const w of Object.keys(BULLET_STYLE) as WeaponId[]) {
    coreMats[w] = bulletMat(BULLET_STYLE[w].core, 1);
    trailMats[w] = bulletMat(BULLET_STYLE[w].trail, 0.35);
  }
  const flying: Bullet[] = [];
  const freeBullets: Bullet[] = [];
  const streak = createBulletStreak();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const tmpDir = new THREE.Vector3();

  function acquireBullet(): Bullet {
    const pooled = freeBullets.pop();
    if (pooled) return pooled;
    if (flying.length >= MAX_BULLETS) {
      const oldest = flying.shift()!;
      return oldest;
    }
    const core = new THREE.Mesh(bulletGeo, coreMats.pistol);
    const trail = new THREE.Mesh(bulletGeo, trailMats.pistol);
    const group = new THREE.Group();
    group.add(trail, core);
    return { group, core, trail, origin: new THREE.Vector3(), end: new THREE.Vector3(), elapsed: 0, hit: false };
  }

  function releaseBullet(i: number): void {
    const b = flying[i];
    flying.splice(i, 1);
    b.group.removeFromParent();
    freeBullets.push(b);
  }

  function spawnBullet(from: THREE.Vector3, to: THREE.Vector3, weapon: WeaponId, hit: boolean): void {
    const b = acquireBullet();
    b.origin.copy(from);
    b.end.copy(to);
    b.elapsed = 0;
    b.hit = hit;
    b.core.material = coreMats[weapon];
    b.trail.material = trailMats[weapon];
    tmpDir.subVectors(to, from);
    if (tmpDir.lengthSq() < 1e-8) {
      if (hit) spawnSpark(to);
      freeBullets.push(b);
      return;
    }
    b.group.quaternion.setFromUnitVectors(zAxis, tmpDir.normalize());
    b.group.visible = false; // placed on the first update
    scene.add(b.group);
    flying.push(b);
  }

  function updateBullets(dt: number): void {
    for (let i = flying.length - 1; i >= 0; i--) {
      const b = flying[i];
      b.elapsed += dt;
      bulletStreak(b.origin, b.end, BULLET_SPEED, b.elapsed, BULLET_STREAK_LENGTH * BULLET_TRAIL_FACTOR, streak);
      if (streak.arrived) {
        // Impact effects happen when the round lands, not when it is fired.
        if (b.hit) spawnSpark(b.end);
        releaseBullet(i);
        continue;
      }
      const len = Math.hypot(streak.head.x - streak.tail.x, streak.head.y - streak.tail.y, streak.head.z - streak.tail.z);
      b.group.visible = len > 1e-3;
      b.group.position.set(streak.head.x, streak.head.y, streak.head.z);
      b.trail.scale.set(BULLET_TRAIL_WIDTH, BULLET_TRAIL_WIDTH, len);
      b.core.scale.set(BULLET_CORE_WIDTH, BULLET_CORE_WIDTH, Math.min(len, BULLET_STREAK_LENGTH));
    }
  }

  function spawnSpark(pos: THREE.Vector3): void {
    sparkMat = sparkMat || new THREE.SpriteMaterial({ map: sparkTex(), transparent: true, depthWrite: false, fog: false });
    const spr = new THREE.Sprite(sparkMat.clone());
    (spr.material as THREE.SpriteMaterial).rotation = Math.random() * Math.PI * 2;
    const s = 0.3 + Math.random() * 0.12;
    spr.scale.set(s, s, 1);
    spr.position.copy(pos);
    scene.add(spr);
    active.push({ obj: spr, life: 0.18, maxLife: 0.18, kind: "spark" });
  }

  function noiseBurst(freqStart: number, freqEnd: number, duration: number, gainVal: number, type: "lowpass" | "highpass" | "bandpass"): void {
    const ctx = audio.ctx;
    const master = audio.master;
    if (!ctx || !master || !audio.soundOn) return;
    const bufSize = Math.floor(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freqStart, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), ctx.currentTime + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainVal, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start();
    src.stop(ctx.currentTime + duration + 0.02);
  }

  return {
    update(dt) {
      updateBullets(dt);
      for (let i = active.length - 1; i >= 0; i--) {
        const a = active[i];
        a.life -= dt;
        const t = Math.max(0, a.life / a.maxLife);
        if (a.kind === "light") (a.obj as THREE.PointLight).intensity = (a.base ?? 6) * t;
        else if ("material" in a.obj) {
          const mat = (a.obj as THREE.Sprite | THREE.Line | THREE.Mesh).material as THREE.Material & { opacity: number };
          mat.opacity = t;
        }
        if (a.life <= 0) {
          scene.remove(a.obj);
          // Flash/spark sprites own a cloned material (shared texture): free it.
          if (a.kind !== "light") ((a.obj as THREE.Sprite).material as THREE.Material).dispose();
          active.splice(i, 1);
        }
      }
    },
    muzzleFlash: spawnFlash,
    bullet: spawnBullet,
    impactSpark: spawnSpark,
    gunshot(weapon, distance) {
      const atten = Math.max(0, 1 - distance / 220);
      if (atten <= 0) return;
      if (weapon === "pistol") noiseBurst(2600, 500, 0.1, 0.5 * atten, "bandpass");
      else if (weapon === "m4") noiseBurst(3200, 300, 0.07, 0.6 * atten, "bandpass");
      else noiseBurst(1200, 400, 0.05, 0.2 * atten, "lowpass");
    },
    dryClick() {
      noiseBurst(1800, 1200, 0.03, 0.15, "highpass");
    },
    reloadSound() {
      noiseBurst(900, 600, 0.09, 0.12, "lowpass");
    },
    dispose() {
      for (const a of active) {
        scene.remove(a.obj);
        if (a.kind !== "light") ((a.obj as THREE.Sprite).material as THREE.Material).dispose();
      }
      active.length = 0;
      while (flying.length) releaseBullet(flying.length - 1);
      freeBullets.length = 0;
      bulletGeo.dispose();
      for (const m of [...Object.values(coreMats), ...Object.values(trailMats)]) m.dispose();
      for (const m of [flashMat, coreMat, sparkMat]) {
        m?.map?.dispose();
        m?.dispose();
      }
    },
  };
}
