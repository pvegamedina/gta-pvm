// Visual/audio weapon effects: muzzle flash, tracer, impact spark, recoil kick,
// and synthesized gunshot/reload/dry-click sounds through the shared audio graph.

import * as THREE from "three";
import type { WeaponId } from "@shared/protocol";
import { radialTex } from "../world/materials";
import type { AudioSystem } from "../audio/audio";

interface Timed {
  obj: THREE.Object3D;
  life: number;
  maxLife: number;
  kind: "flash" | "tracer" | "spark" | "light";
  base?: number;
}

export interface EffectsSystem {
  update(dt: number): void;
  muzzleFlash(pos: THREE.Vector3, weapon?: WeaponId): void;
  tracer(from: THREE.Vector3, to: THREE.Vector3, weapon?: WeaponId): void;
  impactSpark(pos: THREE.Vector3): void;
  gunshot(weapon: WeaponId, distance: number): void;
  dryClick(): void;
  reloadSound(weapon: WeaponId): void;
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

const TRACER_STYLE: Record<WeaponId, { radius: number; color: number }> = {
  fists: { radius: 0.016, color: 0xfff2b0 },
  pistol: { radius: 0.015, color: 0xfff0a8 },
  m4: { radius: 0.024, color: 0xddeeff },
};

export function createEffectsSystem(scene: THREE.Scene, audio: AudioSystem): EffectsSystem {
  const active: Timed[] = [];
  let flashMat: THREE.SpriteMaterial | null = null;
  let coreMat: THREE.SpriteMaterial | null = null;
  let sparkMat: THREE.SpriteMaterial | null = null;
  const up = new THREE.Vector3(0, 1, 0);

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

  function spawnTracer(from: THREE.Vector3, to: THREE.Vector3, weapon?: WeaponId): void {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    if (len < 0.001) return;
    const style = TRACER_STYLE[weapon ?? "pistol"];
    const geo = new THREE.CylinderGeometry(style.radius, style.radius, len, 5, 1, true);
    const mat = new THREE.MeshBasicMaterial({ color: style.color, transparent: true, opacity: 0.9, depthWrite: false, fog: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(from).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(up, dir.normalize());
    scene.add(mesh);
    active.push({ obj: mesh, life: 0.08, maxLife: 0.08, kind: "tracer" });
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
          active.splice(i, 1);
        }
      }
    },
    muzzleFlash: spawnFlash,
    tracer: spawnTracer,
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
  };
}
