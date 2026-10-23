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
}

export interface EffectsSystem {
  update(dt: number): void;
  muzzleFlash(pos: THREE.Vector3): void;
  tracer(from: THREE.Vector3, to: THREE.Vector3): void;
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
const sparkTex = (): THREE.CanvasTexture =>
  radialTex([
    [0, "rgba(255,230,180,1)"],
    [0.5, "rgba(255,160,80,0.7)"],
    [1, "rgba(255,120,40,0)"],
  ]);

export function createEffectsSystem(scene: THREE.Scene, audio: AudioSystem): EffectsSystem {
  const active: Timed[] = [];
  let flashMat: THREE.SpriteMaterial | null = null;
  let sparkMat: THREE.SpriteMaterial | null = null;

  function spawnFlash(pos: THREE.Vector3): void {
    flashMat = flashMat || new THREE.SpriteMaterial({ map: flashTex(), transparent: true, depthWrite: false, fog: false });
    const spr = new THREE.Sprite(flashMat.clone());
    spr.scale.set(0.6, 0.6, 1);
    spr.position.copy(pos);
    scene.add(spr);
    const light = new THREE.PointLight(0xffcc66, 6, 6, 2);
    light.position.copy(pos);
    scene.add(light);
    active.push({ obj: spr, life: 0.05, maxLife: 0.05, kind: "flash" });
    active.push({ obj: light, life: 0.06, maxLife: 0.06, kind: "light" });
  }

  function spawnTracer(from: THREE.Vector3, to: THREE.Vector3): void {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const mat = new THREE.LineBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    scene.add(line);
    active.push({ obj: line, life: 0.08, maxLife: 0.08, kind: "tracer" });
  }

  function spawnSpark(pos: THREE.Vector3): void {
    sparkMat = sparkMat || new THREE.SpriteMaterial({ map: sparkTex(), transparent: true, depthWrite: false, fog: false });
    const spr = new THREE.Sprite(sparkMat.clone());
    spr.scale.set(0.35, 0.35, 1);
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
        if (a.kind === "light") (a.obj as THREE.PointLight).intensity = 6 * t;
        else if ("material" in a.obj) {
          const mat = (a.obj as THREE.Sprite | THREE.Line).material as THREE.Material & { opacity: number };
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
