// WebAudio synthesis of one vehicle engine voice, driven every frame by the
// pure model (audio/engine.ts -> engineSoundParams). Built once per voice and
// reused: only AudioParams are automated per frame (no node churn); short
// one-shot nodes are created only for discrete events (exhaust pops,
// turbo blow-off), like the gunshots.
//
//   exhaust: PeriodicWave (profile harmonics of the firing order) -> drive
//            gain -> waveshaper (grit) -> low-pass (opens with rpm/load) -> gain
//   intake:  sawtooth at 2x firing -> band-pass (induction roar)      -> gain
//   noise:   looping noise -> band-pass tracking rpm -> AM at the firing
//            rate (diesel clatter / combustion roughness)              -> gain
//   turbo:   sine whistle tracking boost                               -> gain
//   all -> voice gain (volume x distance) -> muffle low-pass -> stereo pan -> bus
//
// Plus TireVoice: a continuous tyre screech (band-passed noise + wavering
// squeal) whose level follows lateral slip / handbrake.

import type { EngineProfile, EngineSoundParams } from "./engine";

/** AudioParam smoothing (s) for per-frame targets: fast enough for shifts, slow enough to avoid zipper noise. */
const SMOOTH = 0.03;

function shaperCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const k = 1 + amount * 12;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}

/** PeriodicWave of the profile's harmonics, relative to the lowest order present (the oscillator's frequency). */
function exhaustWave(ctx: BaseAudioContext, p: EngineProfile): { wave: PeriodicWave; baseOrder: number } {
  const baseOrder = Math.min(...p.harmonics.map((h) => h.order));
  const maxN = Math.max(...p.harmonics.map((h) => Math.round(h.order / baseOrder)));
  const real = new Float32Array(maxN + 1);
  const imag = new Float32Array(maxN + 1);
  for (const h of p.harmonics) imag[Math.round(h.order / baseOrder)] += h.gain;
  return { wave: ctx.createPeriodicWave(real, imag), baseOrder };
}

export class EngineVoice {
  private readonly exhaustOsc: OscillatorNode;
  private readonly driveIn: GainNode;
  private readonly shaper: WaveShaperNode;
  private readonly exhaustLp: BiquadFilterNode;
  private readonly exhaustGain: GainNode;
  private readonly intakeOsc: OscillatorNode;
  private readonly intakeBp: BiquadFilterNode;
  private readonly intakeGain: GainNode;
  private readonly noiseSrc: AudioBufferSourceNode;
  private readonly noiseBp: BiquadFilterNode;
  private readonly noiseAm: GainNode;
  private readonly amOsc: OscillatorNode;
  private readonly amDepth: GainNode;
  private readonly noiseGain: GainNode;
  private readonly turboOsc: OscillatorNode;
  private readonly turboGain: GainNode;
  private readonly out: GainNode;
  private readonly muffle: BiquadFilterNode;
  private readonly pan: StereoPannerNode;
  private profile: EngineProfile | null = null;
  private baseOrder = 1;
  /** Last parameters applied (for telemetry/verification). */
  last: EngineSoundParams | null = null;

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
    private readonly noise: AudioBuffer,
  ) {
    const c = ctx;
    this.exhaustOsc = c.createOscillator();
    this.driveIn = c.createGain();
    this.shaper = c.createWaveShaper();
    this.shaper.oversample = "2x";
    this.exhaustLp = c.createBiquadFilter();
    this.exhaustLp.type = "lowpass";
    this.exhaustLp.Q.value = 0.9;
    this.exhaustGain = c.createGain();
    this.exhaustOsc.connect(this.driveIn).connect(this.shaper).connect(this.exhaustLp).connect(this.exhaustGain);

    this.intakeOsc = c.createOscillator();
    this.intakeOsc.type = "sawtooth";
    this.intakeBp = c.createBiquadFilter();
    this.intakeBp.type = "bandpass";
    this.intakeBp.Q.value = 1.4;
    this.intakeGain = c.createGain();
    this.intakeOsc.connect(this.intakeBp).connect(this.intakeGain);

    this.noiseSrc = c.createBufferSource();
    this.noiseSrc.buffer = noise;
    this.noiseSrc.loop = true;
    this.noiseBp = c.createBiquadFilter();
    this.noiseBp.type = "bandpass";
    this.noiseBp.Q.value = 0.8;
    this.noiseAm = c.createGain();
    this.noiseAm.gain.value = 0.6;
    this.amOsc = c.createOscillator();
    this.amDepth = c.createGain();
    this.amOsc.connect(this.amDepth).connect(this.noiseAm.gain);
    this.noiseGain = c.createGain();
    this.noiseSrc.connect(this.noiseBp).connect(this.noiseAm).connect(this.noiseGain);

    this.turboOsc = c.createOscillator();
    this.turboOsc.type = "sine";
    this.turboGain = c.createGain();
    this.turboOsc.connect(this.turboGain);

    this.out = c.createGain();
    this.out.gain.value = 0;
    this.muffle = c.createBiquadFilter();
    this.muffle.type = "lowpass";
    this.muffle.frequency.value = 18000;
    this.pan = c.createStereoPanner();
    for (const g of [this.exhaustGain, this.intakeGain, this.noiseGain, this.turboGain]) {
      g.gain.value = 0;
      g.connect(this.out);
    }
    this.out.connect(this.muffle).connect(this.pan).connect(destination);
    for (const s of [this.exhaustOsc, this.intakeOsc, this.amOsc, this.turboOsc]) s.start();
    this.noiseSrc.start(0, Math.random() * noise.duration);
  }

  /** Switches the engine character (new vehicle): rebuilds the waveforms only. */
  setProfile(p: EngineProfile): void {
    if (this.profile === p) return;
    this.profile = p;
    const { wave, baseOrder } = exhaustWave(this.ctx, p);
    this.exhaustOsc.setPeriodicWave(wave);
    this.baseOrder = baseOrder;
    this.shaper.curve = shaperCurve(p.grit);
    this.amDepth.gain.value = p.diesel ? 0.55 : 0.2;
  }

  /**
   * Applies this frame's parameters. `level` is the overall voice gain (0 =
   * silent: sound off, paused, too far), `pan` -1..1, `muffleHz` the distance
   * low-pass cutoff.
   */
  update(s: EngineSoundParams, level: number, pan = 0, muffleHz = 18000): void {
    const t = this.ctx.currentTime;
    this.last = s;
    const set = (param: AudioParam, v: number) => param.setTargetAtTime(v, t, SMOOTH);
    set(this.exhaustOsc.frequency, Math.max(1, s.firingHz * this.baseOrder));
    set(this.driveIn.gain, 0.6 + s.drive * 2.5);
    set(this.exhaustLp.frequency, s.exhaustCutoff);
    set(this.exhaustGain.gain, 0.16 * s.exhaustGain);
    set(this.intakeOsc.frequency, s.firingHz * 2);
    set(this.intakeBp.frequency, Math.min(6000, s.firingHz * 3 + 200));
    set(this.intakeGain.gain, 0.05 * s.intakeGain);
    set(this.noiseBp.frequency, s.noiseHz);
    set(this.amOsc.frequency, Math.max(1, s.firingHz));
    set(this.noiseGain.gain, 0.12 * s.noiseGain);
    set(this.turboOsc.frequency, s.turboHz);
    set(this.turboGain.gain, s.turboGain * 0.5);
    this.out.gain.setTargetAtTime(Math.max(0, level), t, 0.08);
    set(this.pan.pan, Math.max(-1, Math.min(1, pan)));
    set(this.muffle.frequency, muffleHz);
  }

  /** Exhaust pop/crackle (lift-off or upshift on sporty engines). */
  pop(strength = 1): void {
    const c = this.ctx;
    const t = c.currentTime + Math.random() * 0.04;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900 + Math.random() * 900;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25 * strength, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.07);
    src.connect(lp).connect(g).connect(this.out);
    src.start(t, Math.random() * (this.noise.duration - 0.2), 0.1);
  }

  /** Turbo blow-off valve: a short downward hiss. */
  blowoff(): void {
    const c = this.ctx;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(3200, t);
    bp.frequency.exponentialRampToValueAtTime(1100, t + 0.35);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.4);
    src.connect(bp).connect(g).connect(this.out);
    src.start(t, Math.random() * (this.noise.duration - 0.5), 0.45);
  }

  dispose(): void {
    for (const s of [this.exhaustOsc, this.intakeOsc, this.amOsc, this.turboOsc, this.noiseSrc]) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    this.pan.disconnect();
  }
}

/** Continuous tyre screech whose level follows slip (0..1). */
export class TireVoice {
  private readonly src: AudioBufferSourceNode;
  private readonly bp: BiquadFilterNode;
  private readonly squeal: OscillatorNode;
  private readonly lfo: OscillatorNode;
  private readonly squealGain: GainNode;
  private readonly noiseGain: GainNode;
  private readonly out: GainNode;

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
    noise: AudioBuffer,
  ) {
    const c = ctx;
    this.src = c.createBufferSource();
    this.src.buffer = noise;
    this.src.loop = true;
    this.bp = c.createBiquadFilter();
    this.bp.type = "bandpass";
    this.bp.frequency.value = 1700;
    this.bp.Q.value = 5;
    this.noiseGain = c.createGain();
    this.noiseGain.gain.value = 0.5;
    this.squeal = c.createOscillator();
    this.squeal.type = "triangle";
    this.squeal.frequency.value = 1050;
    this.lfo = c.createOscillator();
    this.lfo.frequency.value = 7;
    const lfoDepth = c.createGain();
    lfoDepth.gain.value = 45;
    this.lfo.connect(lfoDepth).connect(this.squeal.frequency);
    this.squealGain = c.createGain();
    this.squealGain.gain.value = 0.18;
    this.out = c.createGain();
    this.out.gain.value = 0;
    this.src.connect(this.bp).connect(this.noiseGain).connect(this.out);
    this.squeal.connect(this.squealGain).connect(this.out);
    this.out.connect(destination);
    this.src.start(0, Math.random() * noise.duration);
    this.squeal.start();
    this.lfo.start();
  }

  /** `slip` 0..1 (lateral slip / handbrake skid), `speed` m/s shifts the pitch a little. */
  update(slip: number, speed: number, level: number): void {
    const t = this.ctx.currentTime;
    const s = Math.max(0, Math.min(1, slip));
    this.out.gain.setTargetAtTime(0.16 * s * s * level, t, 0.06);
    this.squeal.frequency.setTargetAtTime(950 + Math.min(30, speed) * 9, t, 0.1);
    this.bp.frequency.setTargetAtTime(1400 + Math.min(30, speed) * 25, t, 0.1);
  }

  dispose(): void {
    for (const s of [this.src, this.squeal, this.lfo]) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    this.out.disconnect();
  }
}
