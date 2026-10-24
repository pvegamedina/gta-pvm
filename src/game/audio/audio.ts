// WebAudio vehicle engines, horn, crash thump and synthesized weapon sounds.
// Engines: a pure engine/gearbox model per car (audio/engine.ts: rpm from
// wheel speed and gear ratios, automatic shifts with a torque cut, limiter,
// turbo) drives a synthesized voice (audio/engineSynth.ts) for our own car
// plus up to REMOTE_ENGINE_VOICES nearest remote players' cars (attenuated,
// muffled and panned by distance), with exhaust pops, blow-off and a tyre
// screech voice for our car. Voices are built once in init() and reused.
// Police sirens (two-tone, audio/siren.ts) get a couple of voices of their
// own, attenuated and panned by distance like the engines.
// Gunshots are layered (sharp high-passed crack + pitch-dropping low thump +
// band-passed body + short low-passed tail with a slap-back echo) through a
// compressor bus for punch; pistol and rifle use different recipes. Remote
// shots are attenuated (gain + muffling low-pass) with distance. The shared
// AudioContext + master gain stay exposed for other synthesized effects.

import type { WeaponId } from "@shared/protocol";
import { EngineModel, engineProfileFor, engineSoundParams, estimateThrottle, nearestVoices, type EngineSoundParams } from "./engine";
import { EngineVoice, TireVoice } from "./engineSynth";
import { SIREN_VOICES, nearestSirens, type SirenSource } from "./siren";
import { SirenVoice } from "./sirenVoice";

/** What the audio needs to know about a car to synthesize its engine. */
export interface VehicleSound {
  /** Vehicle type key (selects the engine profile). */
  type: string;
  /** Top speed (m/s) and wheel radius (m) of the vehicle spec (gearing). */
  topSpeed: number;
  wheelRadius: number;
  /** Forward speed (m/s, negative reversing). */
  speed: number;
}

export interface LocalVehicleSound extends VehicleSound {
  /** Accelerator (or reverse pedal while backing up) 0..1. */
  throttle: number;
  /** Tyre slip 0..1 (lateral skid / handbrake). */
  slip: number;
}

export interface RemoteVehicleSound extends VehicleSound {
  id: string;
  /** Distance to the listener (m) and stereo pan (-1 left .. 1 right). */
  distance: number;
  pan: number;
}

/** Local engine state for the HUD / verification. */
export interface EngineTelemetry {
  type: string;
  gear: number;
  rpm: number;
  load: number;
  boost: number;
  limiting: boolean;
  shifting: boolean;
  params: EngineSoundParams;
}

/** Remote engines: max simultaneous voices and audible range (m). */
export const REMOTE_ENGINE_VOICES = 4;
export const REMOTE_ENGINE_MAX_DISTANCE = 120;
/** Overrun crackle rate (pops/s) for engines with `pops` at high rpm off-throttle. */
const OVERRUN_POPS_PER_S = 7;

export interface AudioSystem {
  ctx: AudioContext | null;
  master: GainNode | null;
  soundOn: boolean;
  init(): void;
  horn(): void;
  thump(strength: number): void;
  /**
   * Per-frame vehicle audio. `active` false (paused, menu) fades every engine
   * out; `local` is our own car (null on foot), `remotes` the other players'
   * cars (the nearest REMOTE_ENGINE_VOICES within range get a voice).
   */
  updateVehicles(dt: number, active: boolean, local: LocalVehicleSound | null, remotes: readonly RemoteVehicleSound[]): void;
  /** Per-frame sirens (ours at distance 0): the nearest SIREN_VOICES play; `active` false fades them out. */
  updateSirens(active: boolean, sirens: readonly SirenSource[]): void;
  /** Our engine's state (null when not driving), for the HUD and debugging. */
  engineTelemetry(): EngineTelemetry | null;
  /** Stops every voice and closes the AudioContext. */
  dispose(): void;
  /** Gunshot heard from `distance` metres (0 = our own gun). */
  gunshot(weapon: WeaponId, distance: number): void;
  /** Subtle mechanical action click right after our own shot. */
  mechClick(weapon: WeaponId): void;
  /** Hit-marker tick when one of our shots hits a character. */
  hitTick(): void;
  dryClick(): void;
  reload(): void;
}

/** Remote gunshots fade out completely at this distance (m). */
export const GUNSHOT_MAX_DISTANCE = 220;

interface ShotRecipe {
  crackGain: number;
  crackHz: number;
  crackDecay: number;
  thumpGain: number;
  thumpFrom: number;
  thumpTo: number;
  thumpDecay: number;
  bodyGain: number;
  bodyHz: number;
  bodyDecay: number;
  tailGain: number;
  tailHz: number;
  tailDecay: number;
}

/** Per-weapon gunshot layers (gains are relative, decays in seconds). */
const SHOT_RECIPES: Record<WeaponId, ShotRecipe> = {
  fists: { crackGain: 0, crackHz: 1500, crackDecay: 0.02, thumpGain: 0.25, thumpFrom: 120, thumpTo: 60, thumpDecay: 0.06, bodyGain: 0.12, bodyHz: 600, bodyDecay: 0.04, tailGain: 0, tailHz: 400, tailDecay: 0.05 },
  pistol: { crackGain: 0.75, crackHz: 2400, crackDecay: 0.03, thumpGain: 0.75, thumpFrom: 170, thumpTo: 48, thumpDecay: 0.13, bodyGain: 0.45, bodyHz: 1100, bodyDecay: 0.075, tailGain: 0.22, tailHz: 700, tailDecay: 0.32 },
  m4: { crackGain: 0.85, crackHz: 3200, crackDecay: 0.022, thumpGain: 0.55, thumpFrom: 150, thumpTo: 55, thumpDecay: 0.085, bodyGain: 0.4, bodyHz: 1500, bodyDecay: 0.055, tailGain: 0.16, tailHz: 900, tailDecay: 0.24 },
};

export function createAudioSystem(): AudioSystem {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  /** Engine bus (gentle compression so several engines don't clip). */
  let engineBus: GainNode | null = null;
  let localVoice: EngineVoice | null = null;
  let tireVoice: TireVoice | null = null;
  const remoteVoices: { voice: EngineVoice; id: string | null; model: EngineModel | null; prevSpeed: number }[] = [];
  /** Our engine model, rebuilt when we get into a different kind of car. */
  let localModel: EngineModel | null = null;
  let localKey = "";
  const sirenVoices: SirenVoice[] = [];
  /** Gunshot bus: compressor (punch without clipping on full-auto) -> master. */
  let gunBus: GainNode | null = null;
  /** Slap-back echo send for gunshot tails. */
  let echoIn: GainNode | null = null;
  /** One second of white noise reused (at random offsets) by every noise layer. */
  let noise: AudioBuffer | null = null;

  /** Noise burst through a filter with an exponential decay, into `out`. */
  function noiseLayer(out: AudioNode, t: number, type: BiquadFilterType, hz: number, q: number, gain: number, decay: number): void {
    if (!ctx || !noise || gain <= 0) return;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = hz;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    const offset = Math.random() * Math.max(0, noise.duration - decay - 0.05);
    src.start(t, offset, decay + 0.03);
  }

  /** Sine thump whose pitch drops from `from` to `to` Hz (the "punch" of the shot). */
  function thumpLayer(out: AudioNode, t: number, from: number, to: number, gain: number, decay: number): void {
    if (!ctx || gain <= 0) return;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  /** Turns model events into one-shot sounds (pops, blow-off). */
  function playEvents(voice: EngineVoice, m: EngineModel, events: readonly string[], dt: number, level: number): void {
    if (level <= 0.05) return;
    const p = m.profile;
    for (const e of events) {
      if (e === "upshift" && p.pops) voice.pop(level);
      else if (e === "blowoff") voice.blowoff();
    }
    // Overrun crackle: off-throttle at high rpm on sporty engines.
    if (p.pops && m.load < 0.05 && m.rpm > 0.55 * p.redline && Math.random() < OVERRUN_POPS_PER_S * dt) voice.pop(0.6 * level);
  }

  const sys: AudioSystem = {
    ctx: null,
    master: null,
    soundOn: true,
    init() {
      if (ctx) return;
      try {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.5;
        master.connect(ctx.destination);
        // Gunshot bus (compressor) + slap-back echo send.
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.knee.value = 6;
        comp.ratio.value = 6;
        comp.attack.value = 0.002;
        comp.release.value = 0.12;
        comp.connect(master);
        gunBus = ctx.createGain();
        gunBus.connect(comp);
        echoIn = ctx.createGain();
        echoIn.gain.value = 0.28;
        const delay = ctx.createDelay(0.5);
        delay.delayTime.value = 0.11;
        const echoLp = ctx.createBiquadFilter();
        echoLp.type = "lowpass";
        echoLp.frequency.value = 1200;
        echoIn.connect(delay);
        delay.connect(echoLp);
        echoLp.connect(comp);
        noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const data = noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        // Engines: own bus + compressor, one voice for us, a pool for remote cars.
        const engComp = ctx.createDynamicsCompressor();
        engComp.threshold.value = -18;
        engComp.ratio.value = 4;
        engComp.connect(master);
        engineBus = ctx.createGain();
        engineBus.gain.value = 0.9;
        engineBus.connect(engComp);
        localVoice = new EngineVoice(ctx, engineBus, noise);
        tireVoice = new TireVoice(ctx, engineBus, noise);
        for (let i = 0; i < REMOTE_ENGINE_VOICES; i++) remoteVoices.push({ voice: new EngineVoice(ctx, engineBus, noise), id: null, model: null, prevSpeed: 0 });
        for (let i = 0; i < SIREN_VOICES; i++) sirenVoices.push(new SirenVoice(ctx, master));
        sys.ctx = ctx;
        sys.master = master;
      } catch {
        ctx = null;
      }
    },
    horn() {
      if (!ctx || !master || !sys.soundOn) return;
      [400, 500].forEach((f) => {
        const o = ctx!.createOscillator();
        const g = ctx!.createGain();
        o.type = "square";
        o.frequency.value = f;
        g.gain.value = 0.08;
        g.gain.setTargetAtTime(0, ctx!.currentTime + 0.35, 0.05);
        o.connect(g);
        g.connect(master!);
        o.start();
        o.stop(ctx!.currentTime + 0.6);
      });
    },
    thump(strength: number) {
      if (!ctx || !master || !sys.soundOn) return;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "triangle";
      o.frequency.value = 70;
      g.gain.value = Math.min(0.5, strength / 40);
      g.gain.setTargetAtTime(0, ctx.currentTime + 0.05, 0.08);
      o.connect(g);
      g.connect(master);
      o.start();
      o.stop(ctx.currentTime + 0.4);
    },
    gunshot(weapon: WeaponId, distance: number) {
      if (!ctx || !gunBus || !echoIn || !sys.soundOn) return;
      const atten = Math.max(0, 1 - distance / GUNSHOT_MAX_DISTANCE);
      if (atten <= 0) return;
      const r = SHOT_RECIPES[weapon];
      const t = ctx.currentTime;
      // Per-shot output: gain falls off with distance, a low-pass muffles far shots.
      const out = ctx.createGain();
      out.gain.value = atten * atten * (0.92 + Math.random() * 0.16);
      const muffle = ctx.createBiquadFilter();
      muffle.type = "lowpass";
      muffle.frequency.value = 18000 * Math.pow(atten, 2.2) + 700;
      out.connect(muffle);
      muffle.connect(gunBus);
      // Slight random detune so automatic fire doesn't sound like a loop.
      const v = 0.94 + Math.random() * 0.12;
      noiseLayer(out, t, "highpass", r.crackHz * v, 0.7, r.crackGain, r.crackDecay);
      thumpLayer(out, t, r.thumpFrom * v, r.thumpTo, r.thumpGain, r.thumpDecay);
      noiseLayer(out, t, "bandpass", r.bodyHz * v, 1.1, r.bodyGain, r.bodyDecay);
      if (r.tailGain > 0) {
        const tail = ctx.createGain();
        tail.connect(out);
        tail.connect(echoIn);
        noiseLayer(tail, t + 0.01, "lowpass", r.tailHz, 0.5, r.tailGain, r.tailDecay);
      }
    },
    mechClick(weapon: WeaponId) {
      if (!ctx || !gunBus || !sys.soundOn) return;
      const t = ctx.currentTime + (weapon === "m4" ? 0.035 : 0.05);
      noiseLayer(gunBus, t, "bandpass", weapon === "m4" ? 4200 : 3400, 4, 0.06, 0.02);
      noiseLayer(gunBus, t + 0.025, "bandpass", 2600, 5, 0.04, 0.018);
    },
    hitTick() {
      if (!ctx || !master || !sys.soundOn) return;
      const t = ctx.currentTime + 0.02;
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.setValueAtTime(1900, t);
      o.frequency.exponentialRampToValueAtTime(1300, t + 0.04);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.05, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.05);
      o.connect(g);
      g.connect(master);
      o.start(t);
      o.stop(t + 0.07);
    },
    dryClick() {
      if (!ctx || !gunBus || !sys.soundOn) return;
      noiseLayer(gunBus, ctx.currentTime, "highpass", 2200, 3, 0.18, 0.025);
    },
    reload() {
      if (!ctx || !gunBus || !sys.soundOn) return;
      const t = ctx.currentTime;
      noiseLayer(gunBus, t, "bandpass", 900, 2, 0.14, 0.07);
      noiseLayer(gunBus, t + 0.12, "bandpass", 2400, 4, 0.1, 0.03);
    },
    updateVehicles(dt, active, local, remotes) {
      if (!ctx || !localVoice || !tireVoice) return;
      const on = active && sys.soundOn;
      // ---- our car ----
      if (local) {
        const key = `${local.type}:${local.topSpeed}:${local.wheelRadius}`;
        if (!localModel || key !== localKey) {
          localModel = new EngineModel(engineProfileFor(local.type), local.topSpeed, local.wheelRadius);
          localKey = key;
          localVoice.setProfile(localModel.profile);
        }
        const m = localModel;
        const events = m.update(dt, { speed: local.speed, throttle: local.throttle });
        if (on) playEvents(localVoice, m, events, dt, 1);
        localVoice.update(engineSoundParams(m.profile, m.rpm, m.load, m.boost), on ? 1 : 0);
        tireVoice.update(local.slip, Math.abs(local.speed), on ? 1 : 0);
      } else {
        localModel = null;
        localKey = "";
        if (localVoice.last) localVoice.update(localVoice.last, 0);
        tireVoice.update(0, 0, 0);
      }
      // ---- remote cars: the nearest few get a (reused) voice ----
      const chosen = nearestVoices(remotes, REMOTE_ENGINE_VOICES, REMOTE_ENGINE_MAX_DISTANCE);
      for (const slot of remoteVoices) if (slot.id !== null && !chosen.some((c) => c.id === slot.id)) slot.id = null;
      for (const car of chosen) {
        let slot = remoteVoices.find((v) => v.id === car.id);
        if (!slot) {
          slot = remoteVoices.find((v) => v.id === null)!;
          slot.id = car.id;
          slot.model = new EngineModel(engineProfileFor(car.type), car.topSpeed, car.wheelRadius);
          slot.voice.setProfile(slot.model.profile);
          slot.prevSpeed = car.speed;
        }
        const m = slot.model!;
        const throttle = estimateThrottle(slot.prevSpeed, car.speed, dt);
        slot.prevSpeed = car.speed;
        const events = m.update(dt, { speed: car.speed, throttle });
        const atten = Math.max(0, 1 - car.distance / REMOTE_ENGINE_MAX_DISTANCE);
        if (on) playEvents(slot.voice, m, events, dt, atten);
        slot.voice.update(engineSoundParams(m.profile, m.rpm, m.load, m.boost), on ? 0.85 * atten * atten : 0, car.pan, 600 + 17000 * Math.pow(atten, 2.2));
      }
      for (const slot of remoteVoices) if (slot.id === null && slot.voice.last) slot.voice.update(slot.voice.last, 0);
    },
    updateSirens(active, sirens) {
      if (!ctx) return;
      const on = active && sys.soundOn;
      const chosen = nearestSirens(sirens, SIREN_VOICES);
      for (const v of sirenVoices) if (v.id !== null && !chosen.some((c) => c.id === v.id)) v.id = null;
      for (const s of chosen) {
        let v = sirenVoices.find((x) => x.id === s.id);
        if (!v) {
          v = sirenVoices.find((x) => x.id === null)!;
          v.assign(s.id);
        }
        v.update(on, s.distance, s.pan);
      }
      for (const v of sirenVoices) if (v.id === null) v.update(false, 0, 0);
    },
    engineTelemetry() {
      const m = localModel;
      if (!m) return null;
      return {
        type: localKey.split(":")[0],
        gear: m.gear,
        rpm: m.rpm,
        load: m.load,
        boost: m.boost,
        limiting: m.limiting,
        shifting: m.shiftLeft > 0,
        params: engineSoundParams(m.profile, m.rpm, m.load, m.boost),
      };
    },
    dispose() {
      localVoice?.dispose();
      tireVoice?.dispose();
      for (const slot of remoteVoices) slot.voice.dispose();
      remoteVoices.length = 0;
      for (const v of sirenVoices) v.dispose();
      sirenVoices.length = 0;
      localVoice = null;
      tireVoice = null;
      localModel = null;
      if (ctx) void ctx.close().catch(() => {});
      ctx = null;
      sys.ctx = null;
      sys.master = null;
    },
  };
  return sys;
}
