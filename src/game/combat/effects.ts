// Visual/audio weapon effects. Everything is cosmetic (hits stay hitscan and
// server-authoritative, see game.ts) and pooled so firing never allocates
// scene objects or adds/removes lights (which would recompile shaders):
//
// - muzzle flash: layered sprites with random rotation/scale lasting 1-2
//   frames, plus a pooled PointLight flash that lights the surroundings;
// - tracers: very fast (TRACER_SPEED), thin, short hot streaks with a
//   gradient tail; the M4 only shows every Nth round (combat/recoil.ts) but
//   every round still lands and spawns its impact on arrival;
// - brass casings ejected to the shooter's right, spinning and bouncing;
// - impacts: dust + debris chips + a bullet-hole decal on static surfaces,
//   metal sparks on cars, a dark-red puff on characters/corpses;
// - gunshot / click / reload / hit-tick sounds through audio/audio.ts.

import * as THREE from "three";
import type { WeaponId } from "@shared/protocol";
import { radialTex } from "../world/materials";
import { groundY } from "../world/colliders";
import type { AudioSystem } from "../audio/audio";
import { bulletStreak, createBulletStreak } from "./bullets";
import { shouldTrace } from "./recoil";
import { DecalRing, decalFade } from "./impacts";

/** What the round hit, deciding the impact effect. */
export type ImpactKind = "none" | "surface" | "vehicle" | "flesh";

export interface ShotEffect {
  weapon: WeaponId;
  /** Barrel tip (tracer/flash origin). */
  muzzle: THREE.Vector3;
  /** Impact point (hitscan result). */
  end: THREE.Vector3;
  /** Shooter's right on the ground plane (unit XZ), for casing ejection. */
  right: { x: number; z: number };
  impact: ImpactKind;
  /** Surface normal at `end` (bullet-hole decal), when known. */
  normal: THREE.Vector3 | null;
  /** Shooter id: tracer cadence is counted per shooter. */
  shooter: string;
  /** Our own shot (uses the dedicated flash light). */
  local: boolean;
}

export interface EffectsSystem {
  update(dt: number): void;
  /** Flash + light + tracer + casing for one round; its impact plays when it lands. */
  shot(fx: ShotEffect): void;
  /** Impact effect right now (no flight), e.g. a melee hit. */
  impact(pos: THREE.Vector3, kind: ImpactKind, normal: THREE.Vector3 | null): void;
  gunshot(weapon: WeaponId, distance: number): void;
  mechClick(weapon: WeaponId): void;
  hitTick(): void;
  dryClick(): void;
  reloadSound(weapon: WeaponId): void;
  /** Removes bullet holes, casings and particles (game reset). */
  clear(): void;
  /** Removes every effect from the scene and frees pooled GPU resources. */
  dispose(): void;
}

// ---- Tracer tunables ----
/** Visual tracer speed (m/s): real rounds are 350-900 m/s, so a tracer is
 * visible for only a few frames — exactly how game tracers read. */
export const TRACER_SPEED = 780;
/** Bright core length (m) and the softer glow around it. */
export const TRACER_CORE_LENGTH = 0.9;
const TRACER_GLOW_LENGTH = 1.4;
const TRACER_CORE_WIDTH = 0.02;
const TRACER_GLOW_WIDTH = 0.065;
/** Upper bound of simultaneously flying rounds; the oldest is recycled beyond it. */
const MAX_ROUNDS = 96;
const TRACER_STYLE: Record<WeaponId, { core: number; glow: number }> = {
  fists: { core: 0xffe9a8, glow: 0xff8a2a },
  pistol: { core: 0xffe9a8, glow: 0xff8a2a },
  m4: { core: 0xffdf90, glow: 0xff7a1a },
};

// ---- Muzzle flash tunables ----
const FLASH_POOL = 8;
/** Flash sprite life (s): ~2 frames at 60 fps. */
const FLASH_LIFE = 0.034;
/** Pooled flash lights: slot 0 is ours, the rest rotate between remote shooters. */
const FLASH_LIGHTS = 3;
const FLASH_LIGHT_LIFE = 0.06;
const FLASH_LIGHT_RANGE = 9;
const FLASH_LIGHT_INTENSITY: Record<WeaponId, number> = { fists: 0, pistol: 12, m4: 9 };
const FLASH_SIZE: Record<WeaponId, number> = { fists: 0, pistol: 0.42, m4: 0.55 };

// ---- Casings / debris / particles / decals ----
const MAX_CASINGS = 64;
const CASING_LIFE = 4;
const CASING_SHRINK = 0.6;
/** Casing dimensions (m): radius, length (scaled per weapon below). */
const CASING_SIZE: Record<WeaponId, number> = { fists: 0, pistol: 0.8, m4: 1.05 };
/** Ejection port distance behind the muzzle (m). */
const EJECT_BACK: Record<WeaponId, number> = { fists: 0, pistol: 0.1, m4: 0.38 };
const MAX_CHIPS = 64;
const CHIP_LIFE = 0.8;
const MAX_PARTICLES = 48;
export const MAX_DECALS = 100;
const DECAL_LIFE = 45;
const DECAL_FADE = 3;
const DECAL_SIZE = 0.14;
const GRAVITY = 9.8;

interface Round {
  group: THREE.Group;
  core: THREE.Mesh;
  glow: THREE.Mesh;
  origin: THREE.Vector3;
  end: THREE.Vector3;
  normal: THREE.Vector3;
  hasNormal: boolean;
  elapsed: number;
  impact: ImpactKind;
  visible: boolean;
  /** Spawned this frame: shown once at the muzzle before it starts moving, so
   * even at low frame rates (or a wall 5 m away) the round is seen leaving the gun. */
  fresh: boolean;
}

interface Flash {
  sprites: THREE.Sprite[];
  life: number;
  /** Skips the first update so the flash is rendered at least once at any frame rate. */
  fresh: boolean;
}

interface Casing {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  scale: number;
  life: number;
  resting: boolean;
}

interface Chip {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  life: number;
  size: number;
}

interface Particle {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  grow: number;
  gravity: number;
  alpha: number;
}

const flashTex = () =>
  radialTex([
    [0, "rgba(255,250,225,1)"],
    [0.35, "rgba(255,205,110,0.85)"],
    [1, "rgba(255,140,40,0)"],
  ]);
const coreTex = () =>
  radialTex([
    [0, "rgba(255,255,255,1)"],
    [0.3, "rgba(255,248,210,0.95)"],
    [1, "rgba(255,200,120,0)"],
  ]);
const sparkTex = () =>
  radialTex([
    [0, "rgba(255,240,200,1)"],
    [0.4, "rgba(255,170,80,0.75)"],
    [1, "rgba(255,120,40,0)"],
  ]);
const smokeTex = () =>
  radialTex([
    [0, "rgba(255,255,255,0.9)"],
    [0.5, "rgba(255,255,255,0.45)"],
    [1, "rgba(255,255,255,0)"],
  ]);
const holeTex = () =>
  radialTex([
    [0, "rgba(10,10,10,1)"],
    [0.3, "rgba(20,18,16,0.95)"],
    [0.5, "rgba(45,40,35,0.6)"],
    [1, "rgba(60,55,50,0)"],
  ]);

/** Unit box spanning z in [-1, 0] (head at the origin) with a bright-head,
 * black-tail vertex gradient: with additive blending the tail fades out. */
function tracerGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, -0.5);
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = Math.pow(1 + pos.getZ(i), 1.6); // 1 at the head, 0 at the tail
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = k;
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
}

export function createEffectsSystem(scene: THREE.Scene, audio: AudioSystem): EffectsSystem {
  let clock = 0;
  const tmp = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const tmpM = new THREE.Matrix4();
  const tmpS = new THREE.Vector3();
  const zAxis = new THREE.Vector3(0, 0, 1);

  // ---------------- Muzzle flashes ----------------
  const texFlash = flashTex();
  const texCore = coreTex();
  const texSpark = sparkTex();
  const texSmoke = smokeTex();
  const texHole = holeTex();
  const flashes: Flash[] = [];
  for (let i = 0; i < FLASH_POOL; i++) {
    const mk = (map: THREE.Texture) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
      s.visible = false;
      scene.add(s);
      return s;
    };
    // glow, core, two forward "cone" puffs along the barrel
    flashes.push({ sprites: [mk(texFlash), mk(texCore), mk(texFlash), mk(texCore)], life: 0, fresh: false });
  }
  let flashNext = 0;
  const lights: { light: THREE.PointLight; life: number; base: number; fresh: boolean }[] = [];
  for (let i = 0; i < FLASH_LIGHTS; i++) {
    // Created once, kept in the scene: toggling intensity never recompiles shaders.
    const light = new THREE.PointLight(0xffc36a, 0, FLASH_LIGHT_RANGE, 2);
    light.castShadow = false;
    scene.add(light);
    lights.push({ light, life: 0, base: 0, fresh: false });
  }
  let remoteLight = 1;

  function spawnFlash(pos: THREE.Vector3, dir: THREE.Vector3, weapon: WeaponId, local: boolean): void {
    const f = flashes[flashNext];
    flashNext = (flashNext + 1) % FLASH_POOL;
    const size = FLASH_SIZE[weapon] * (0.8 + Math.random() * 0.45);
    const rot = Math.random() * Math.PI * 2;
    const layout: [number, number, number][] = [
      // [scale, forward offset, opacity]
      [size, 0.02, 0.95],
      [size * 0.55, 0.0, 1],
      [size * 0.6, size * 0.45, 0.8],
      [size * 0.35, size * 0.8, 0.7],
    ];
    f.sprites.forEach((s, i) => {
      const [sc, fwd, op] = layout[i];
      s.position.copy(pos).addScaledVector(dir, fwd);
      s.scale.set(sc, sc, 1);
      const m = s.material as THREE.SpriteMaterial;
      m.rotation = rot * (i % 2 ? -1.3 : 1) + i;
      m.opacity = op;
      s.visible = true;
    });
    f.life = FLASH_LIFE * (Math.random() < 0.5 ? 1 : 1.6);
    f.fresh = true;
    const slot = local ? 0 : remoteLight;
    if (!local) remoteLight = 1 + (remoteLight % (FLASH_LIGHTS - 1));
    const L = lights[slot];
    L.light.position.copy(pos).addScaledVector(dir, 0.25);
    L.base = FLASH_LIGHT_INTENSITY[weapon] * (0.85 + Math.random() * 0.3);
    L.life = FLASH_LIGHT_LIFE;
    L.fresh = true;
    L.light.intensity = L.base;
  }

  function updateFlashes(dt: number): void {
    for (const f of flashes) {
      if (f.life <= 0) continue;
      if (f.fresh) {
        f.fresh = false;
        continue;
      }
      f.life -= dt;
      if (f.life <= 0) for (const s of f.sprites) s.visible = false;
    }
    for (const L of lights) {
      if (L.life <= 0) continue;
      if (L.fresh) {
        L.fresh = false;
        continue;
      }
      L.life -= dt;
      const t = Math.max(0, L.life / FLASH_LIGHT_LIFE);
      L.light.intensity = L.base * t * t;
    }
  }

  // ---------------- Tracers / rounds in flight ----------------
  const tracerGeo = tracerGeometry();
  const tracerMat = (color: number, opacity: number) =>
    new THREE.MeshBasicMaterial({ color, vertexColors: true, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
  const coreMats = {} as Record<WeaponId, THREE.MeshBasicMaterial>;
  const glowMats = {} as Record<WeaponId, THREE.MeshBasicMaterial>;
  for (const w of Object.keys(TRACER_STYLE) as WeaponId[]) {
    coreMats[w] = tracerMat(TRACER_STYLE[w].core, 1);
    glowMats[w] = tracerMat(TRACER_STYLE[w].glow, 0.4);
  }
  const flying: Round[] = [];
  const freeRounds: Round[] = [];
  const streak = createBulletStreak();
  const shotCount = new Map<string, number>();

  function acquireRound(): Round {
    const pooled = freeRounds.pop();
    if (pooled) return pooled;
    if (flying.length >= MAX_ROUNDS) return flying.shift()!;
    const core = new THREE.Mesh(tracerGeo, coreMats.pistol);
    const glow = new THREE.Mesh(tracerGeo, glowMats.pistol);
    const group = new THREE.Group();
    group.add(glow, core);
    return { group, core, glow, origin: new THREE.Vector3(), end: new THREE.Vector3(), normal: new THREE.Vector3(), hasNormal: false, elapsed: 0, impact: "none", visible: true, fresh: false };
  }

  function releaseRound(i: number): void {
    const r = flying[i];
    flying.splice(i, 1);
    r.group.removeFromParent();
    freeRounds.push(r);
  }

  function spawnRound(fx: ShotEffect): void {
    const r = acquireRound();
    r.origin.copy(fx.muzzle);
    r.end.copy(fx.end);
    r.hasNormal = !!fx.normal;
    if (fx.normal) r.normal.copy(fx.normal);
    r.impact = fx.impact;
    const n = shotCount.get(fx.shooter) ?? 0;
    shotCount.set(fx.shooter, n + 1);
    r.visible = shouldTrace(n, fx.weapon);
    r.core.material = coreMats[fx.weapon];
    r.glow.material = glowMats[fx.weapon];
    tmp.subVectors(fx.end, fx.muzzle);
    if (tmp.lengthSq() < 1e-8) {
      landRound(r);
      freeRounds.push(r);
      return;
    }
    r.group.quaternion.setFromUnitVectors(zAxis, tmp.normalize());
    // Drawn this very frame ~one core length out of the barrel, then advanced
    // at TRACER_SPEED — so even a 3-frame flight shows the round leaving the gun.
    r.elapsed = TRACER_CORE_LENGTH / TRACER_SPEED;
    r.fresh = true;
    r.group.visible = false; // a pooled round may still carry its last placement
    placeRound(r);
    scene.add(r.group);
    flying.push(r);
  }

  /** Positions a round's streak for its current `elapsed`; returns true once it has landed. */
  function placeRound(r: Round): boolean {
    bulletStreak(r.origin, r.end, TRACER_SPEED, r.elapsed, TRACER_GLOW_LENGTH, streak);
    if (streak.arrived) return true;
    const len = Math.hypot(streak.head.x - streak.tail.x, streak.head.y - streak.tail.y, streak.head.z - streak.tail.z);
    r.group.visible = r.visible && len > 1e-3;
    r.group.position.set(streak.head.x, streak.head.y, streak.head.z);
    r.glow.scale.set(TRACER_GLOW_WIDTH, TRACER_GLOW_WIDTH, len);
    r.core.scale.set(TRACER_CORE_WIDTH, TRACER_CORE_WIDTH, Math.min(len, TRACER_CORE_LENGTH));
    return false;
  }

  function landRound(r: Round): void {
    spawnImpact(r.end, r.impact, r.hasNormal ? r.normal : null);
  }

  function updateRounds(dt: number): void {
    for (let i = flying.length - 1; i >= 0; i--) {
      const r = flying[i];
      if (r.fresh) {
        r.fresh = false;
        continue;
      }
      r.elapsed += dt;
      if (placeRound(r)) {
        // Impact effects happen when the round lands, not when it is fired.
        landRound(r);
        releaseRound(i);
      }
    }
  }

  // ---------------- Casings ----------------
  const brass = new THREE.MeshLambertMaterial({ color: 0xd9a441, emissive: 0x2a1a00 });
  const casingGeo = new THREE.CylinderGeometry(0.0055, 0.0055, 0.022, 6).rotateX(Math.PI / 2);
  const casingMesh = new THREE.InstancedMesh(casingGeo, brass, MAX_CASINGS);
  casingMesh.frustumCulled = false;
  casingMesh.castShadow = false;
  scene.add(casingMesh);
  const casings: Casing[] = [];
  let casingNext = 0;
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < MAX_CASINGS; i++) {
    casingMesh.setMatrixAt(i, hidden);
    casings.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(), scale: 1, life: 0, resting: false });
  }

  function ejectCasing(muzzle: THREE.Vector3, dir: THREE.Vector3, right: { x: number; z: number }, weapon: WeaponId): void {
    if (CASING_SIZE[weapon] <= 0) return;
    const c = casings[casingNext];
    casingNext = (casingNext + 1) % MAX_CASINGS;
    c.pos.copy(muzzle).addScaledVector(dir, -EJECT_BACK[weapon]);
    const side = 1.6 + Math.random() * 1.1;
    c.vel.set(right.x * side - dir.x * 0.4, 1.6 + Math.random() * 1.0, right.z * side - dir.z * 0.4);
    c.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    c.spin.set((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 40);
    c.scale = CASING_SIZE[weapon];
    c.life = CASING_LIFE;
    c.resting = false;
  }

  function updateCasings(dt: number): void {
    let dirty = false;
    for (let i = 0; i < MAX_CASINGS; i++) {
      const c = casings[i];
      if (c.life <= 0) continue;
      dirty = true;
      c.life -= dt;
      if (c.life <= 0) {
        casingMesh.setMatrixAt(i, hidden);
        continue;
      }
      if (!c.resting) {
        c.vel.y -= GRAVITY * dt;
        c.pos.addScaledVector(c.vel, dt);
        c.rot.x += c.spin.x * dt;
        c.rot.y += c.spin.y * dt;
        c.rot.z += c.spin.z * dt;
        const floor = groundY(c.pos.x, c.pos.z) + 0.006;
        if (c.pos.y < floor) {
          c.pos.y = floor;
          if (Math.abs(c.vel.y) < 0.6) {
            c.resting = true;
            // Lie flat (the casing's axis is its local Z; keep only the heading).
            c.rot.x = 0;
            c.rot.z = 0;
          } else {
            c.vel.y = -c.vel.y * 0.38;
            c.vel.x *= 0.55;
            c.vel.z *= 0.55;
            c.spin.multiplyScalar(0.5);
          }
        }
      }
      const s = c.scale * Math.min(1, c.life / CASING_SHRINK);
      tmpQ.setFromEuler(c.rot);
      tmpM.compose(c.pos, tmpQ, tmpS.set(s, s, s));
      casingMesh.setMatrixAt(i, tmpM);
    }
    if (dirty) casingMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------------- Debris chips ----------------
  const chipMat = new THREE.MeshLambertMaterial({ color: 0x6a645c });
  const chipMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), chipMat, MAX_CHIPS);
  chipMesh.frustumCulled = false;
  scene.add(chipMesh);
  const chips: Chip[] = [];
  let chipNext = 0;
  for (let i = 0; i < MAX_CHIPS; i++) {
    chipMesh.setMatrixAt(i, hidden);
    chips.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), life: 0, size: 0.02 });
  }

  function spawnChips(pos: THREE.Vector3, normal: THREE.Vector3, n: number, speed: number): void {
    for (let k = 0; k < n; k++) {
      const c = chips[chipNext];
      chipNext = (chipNext + 1) % MAX_CHIPS;
      c.pos.copy(pos).addScaledVector(normal, 0.02);
      c.vel
        .copy(normal)
        .multiplyScalar(speed * (0.5 + Math.random()))
        .add(tmp.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(speed));
      c.rot.set(Math.random() * 6, Math.random() * 6, 0);
      c.life = CHIP_LIFE * (0.6 + Math.random() * 0.5);
      c.size = 0.012 + Math.random() * 0.02;
    }
  }

  function updateChips(dt: number): void {
    let dirty = false;
    for (let i = 0; i < MAX_CHIPS; i++) {
      const c = chips[i];
      if (c.life <= 0) continue;
      dirty = true;
      c.life -= dt;
      if (c.life <= 0) {
        chipMesh.setMatrixAt(i, hidden);
        continue;
      }
      c.vel.y -= GRAVITY * dt;
      c.pos.addScaledVector(c.vel, dt);
      const floor = groundY(c.pos.x, c.pos.z);
      if (c.pos.y < floor) {
        c.pos.y = floor;
        c.vel.multiplyScalar(0.3);
        c.vel.y = Math.abs(c.vel.y);
      }
      c.rot.x += dt * 12;
      c.rot.y += dt * 9;
      tmpQ.setFromEuler(c.rot);
      tmpM.compose(c.pos, tmpQ, tmpS.setScalar(c.size));
      chipMesh.setMatrixAt(i, tmpM);
    }
    if (dirty) chipMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------------- Particles (dust, blood, sparks) ----------------
  const particles: Particle[] = [];
  let particleNext = 0;
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texSmoke, transparent: true, depthWrite: false }));
    sprite.visible = false;
    scene.add(sprite);
    particles.push({ sprite, vel: new THREE.Vector3(), life: 0, maxLife: 1, grow: 0, gravity: 0, alpha: 1 });
  }

  function emit(pos: THREE.Vector3, vel: THREE.Vector3, size: number, life: number, map: THREE.Texture, color: number, alpha: number, additive: boolean, grow: number, gravity: number): void {
    const p = particles[particleNext];
    particleNext = (particleNext + 1) % MAX_PARTICLES;
    const m = p.sprite.material as THREE.SpriteMaterial;
    m.map = map;
    m.color.setHex(color);
    m.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    m.rotation = Math.random() * Math.PI * 2;
    m.opacity = alpha;
    p.sprite.position.copy(pos);
    p.sprite.scale.set(size, size, 1);
    p.sprite.visible = true;
    p.vel.copy(vel);
    p.life = p.maxLife = life;
    p.grow = grow;
    p.gravity = gravity;
    p.alpha = alpha;
  }

  function updateParticles(dt: number): void {
    for (const p of particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.sprite.visible = false;
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(Math.exp(-dt * 3));
      p.sprite.position.addScaledVector(p.vel, dt);
      const s = p.sprite.scale.x + p.grow * dt;
      p.sprite.scale.set(s, s, 1);
      (p.sprite.material as THREE.SpriteMaterial).opacity = p.alpha * (p.life / p.maxLife);
    }
  }

  // ---------------- Bullet-hole decals ----------------
  const decalMat = new THREE.MeshBasicMaterial({ map: texHole, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const decalMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), decalMat, MAX_DECALS);
  decalMesh.frustumCulled = false;
  scene.add(decalMesh);
  const decalRing = new DecalRing(MAX_DECALS);
  const decalPos: THREE.Vector3[] = [];
  const decalRot: THREE.Quaternion[] = [];
  const decalSize: number[] = [];
  for (let i = 0; i < MAX_DECALS; i++) {
    decalMesh.setMatrixAt(i, hidden);
    decalPos.push(new THREE.Vector3());
    decalRot.push(new THREE.Quaternion());
    decalSize.push(0);
  }

  function addDecal(pos: THREE.Vector3, normal: THREE.Vector3): void {
    const slot = decalRing.push(clock);
    decalPos[slot].copy(pos).addScaledVector(normal, 0.01);
    decalRot[slot].setFromUnitVectors(zAxis, normal).multiply(tmpQ.setFromAxisAngle(zAxis, Math.random() * Math.PI * 2));
    decalSize[slot] = DECAL_SIZE * (0.75 + Math.random() * 0.5);
    tmpM.compose(decalPos[slot], decalRot[slot], tmpS.set(decalSize[slot], decalSize[slot], 1));
    decalMesh.setMatrixAt(slot, tmpM);
    decalMesh.instanceMatrix.needsUpdate = true;
  }

  function updateDecals(): void {
    let dirty = false;
    for (let i = 0; i < decalRing.count; i++) {
      const age = clock - decalRing.bornAt(i);
      if (age < DECAL_LIFE - DECAL_FADE || decalSize[i] === 0) continue;
      // Old holes shrink away over their last DECAL_FADE seconds.
      const f = decalFade(age, DECAL_LIFE, DECAL_FADE);
      const s = decalSize[i] * f;
      if (f <= 0) decalSize[i] = 0;
      tmpM.compose(decalPos[i], decalRot[i], tmpS.set(s, s, 1));
      decalMesh.setMatrixAt(i, f > 0 ? tmpM : hidden);
      dirty = true;
    }
    if (dirty) decalMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------------- Impacts ----------------
  const up = new THREE.Vector3(0, 1, 0);
  function spawnImpact(pos: THREE.Vector3, kind: ImpactKind, normal: THREE.Vector3 | null): void {
    if (kind === "none") return;
    const n = normal ?? up;
    if (kind === "flesh") {
      // Dark-red puff + a few droplets.
      for (let k = 0; k < 5; k++) {
        tmp.set(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).multiplyScalar(1.6);
        emit(pos, tmp, 0.16 + Math.random() * 0.12, 0.35 + Math.random() * 0.2, texSmoke, k < 3 ? 0x5a0606 : 0x8a0c0c, 0.85, false, 0.5, 2.5);
      }
      return;
    }
    // Spark flash at the hit point.
    emit(pos, tmp.set(0, 0, 0), 0.32 + Math.random() * 0.12, 0.09, texSpark, 0xffffff, 1, true, 0, 0);
    if (kind === "vehicle") {
      for (let k = 0; k < 3; k++) {
        tmp.copy(n).multiplyScalar(2).add(tmpS.set(Math.random() - 0.5, Math.random(), Math.random() - 0.5).multiplyScalar(3));
        emit(pos, tmp, 0.08, 0.18, texSpark, 0xffd27a, 1, true, -0.2, 6);
      }
      return;
    }
    // Static surface: dust cloud, debris and a bullet hole.
    for (let k = 0; k < 4; k++) {
      tmp.copy(n).multiplyScalar(0.9 + Math.random() * 0.8).add(tmpS.set(Math.random() - 0.5, Math.random() * 0.5, Math.random() - 0.5).multiplyScalar(0.8));
      emit(pos, tmp, 0.18 + Math.random() * 0.15, 0.55 + Math.random() * 0.35, texSmoke, 0xb3a58f, 0.55, false, 0.9, -0.15);
    }
    spawnChips(pos, n, 4, 2.4);
    if (normal) addDecal(pos, normal);
  }

  return {
    update(dt) {
      clock += dt;
      updateFlashes(dt);
      updateRounds(dt);
      updateCasings(dt);
      updateChips(dt);
      updateParticles(dt);
      updateDecals();
    },
    shot(fx) {
      if (fx.weapon === "fists") return;
      const dir = tmp.subVectors(fx.end, fx.muzzle);
      if (dir.lengthSq() < 1e-8) dir.set(fx.right.z, 0, -fx.right.x);
      dir.normalize();
      const d = dir.clone();
      spawnFlash(fx.muzzle, d, fx.weapon, fx.local);
      ejectCasing(fx.muzzle, d, fx.right, fx.weapon);
      spawnRound(fx);
    },
    impact: spawnImpact,
    gunshot: (weapon, distance) => audio.gunshot(weapon, distance),
    mechClick: (weapon) => audio.mechClick(weapon),
    hitTick: () => audio.hitTick(),
    dryClick: () => audio.dryClick(),
    reloadSound: () => audio.reload(),
    clear() {
      decalRing.clear();
      for (let i = 0; i < MAX_DECALS; i++) {
        decalMesh.setMatrixAt(i, hidden);
        decalSize[i] = 0;
      }
      decalMesh.instanceMatrix.needsUpdate = true;
      for (const c of casings) c.life = Math.min(c.life, 1e-6);
      for (const c of chips) c.life = Math.min(c.life, 1e-6);
      for (const p of particles) p.life = Math.min(p.life, 1e-6);
    },
    dispose() {
      while (flying.length) releaseRound(flying.length - 1);
      freeRounds.length = 0;
      for (const f of flashes) for (const s of f.sprites) {
        s.removeFromParent();
        (s.material as THREE.Material).dispose();
      }
      for (const L of lights) L.light.removeFromParent();
      for (const p of particles) {
        p.sprite.removeFromParent();
        (p.sprite.material as THREE.Material).dispose();
      }
      for (const m of [casingMesh, chipMesh, decalMesh]) {
        m.removeFromParent();
        m.geometry.dispose();
        m.dispose();
      }
      tracerGeo.dispose();
      for (const m of [...Object.values(coreMats), ...Object.values(glowMats), brass, chipMat, decalMat]) m.dispose();
      for (const t of [texFlash, texCore, texSpark, texSmoke, texHole]) t.dispose();
    },
  };
}
