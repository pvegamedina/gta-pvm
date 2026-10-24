// WebAudio engine drone, horn, crash thump and synthesized weapon sounds.
// Gunshots are layered (sharp high-passed crack + pitch-dropping low thump +
// band-passed body + short low-passed tail with a slap-back echo) through a
// compressor bus for punch; pistol and rifle use different recipes. Remote
// shots are attenuated (gain + muffling low-pass) with distance. The shared
// AudioContext + master gain stay exposed for other synthesized effects.

import type { WeaponId } from "@shared/protocol";

export interface AudioSystem {
  ctx: AudioContext | null;
  master: GainNode | null;
  soundOn: boolean;
  init(): void;
  horn(): void;
  thump(strength: number): void;
  updateEngine(on: boolean, speed: number, throttle: number): void;
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
  let engOsc: OscillatorNode | null = null;
  let engGain: GainNode | null = null;
  let engFilter: BiquadFilterNode | null = null;
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
        engOsc = ctx.createOscillator();
        engOsc.type = "sawtooth";
        engFilter = ctx.createBiquadFilter();
        engFilter.type = "lowpass";
        engFilter.frequency.value = 420;
        engGain = ctx.createGain();
        engGain.gain.value = 0;
        engOsc.connect(engFilter);
        engFilter.connect(engGain);
        engGain.connect(master);
        engOsc.start();
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
    updateEngine(on: boolean, speed: number, throttle: number) {
      if (!ctx || !engGain || !engOsc || !engFilter) return;
      engGain.gain.setTargetAtTime(on ? 0.05 + throttle * 0.04 : 0, ctx.currentTime, 0.08);
      engOsc.frequency.setTargetAtTime(48 + speed * 3.4, ctx.currentTime, 0.08);
      engFilter.frequency.setTargetAtTime(300 + speed * 18 + throttle * 200, ctx.currentTime, 0.1);
    },
  };
  return sys;
}
