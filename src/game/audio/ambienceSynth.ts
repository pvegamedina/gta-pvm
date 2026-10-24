// WebAudio synthesis of the ambient soundscape (no samples), following the
// engineSynth.ts pattern: continuous voices are built once and only their
// AudioParams are automated per frame; discrete sounds (footsteps, bird
// calls, car doors) are short one-shot node chains.
//
//   city hum:  looping noise -> low-pass ~170 Hz (+ faint band-passed traffic wash) -> day gain
//   wind:      looping noise -> band-pass swept by a slow LFO, gusting AM      -> wind gain
//   crickets:  two sines (~4.3 / 4.7 kHz) gated by a trill (square ~30 Hz)
//              and a chirp rhythm (square ~1.5 Hz)                             -> night gain
//   birds:     sine whistles with fast pitch sweeps + vibrato, scheduled at
//              random intervals (ambience.ts nextBirdDelay), randomly panned -> day gain
//   all -> bed gain -> ambience bus
//
// Pure decisions (cadence, surface timbres, mix weights) live in ambience.ts.

import { nextBirdDelay, type AmbienceMix, type FootstepProfile } from "./ambience";

const SMOOTH = 0.25;

/** Square-wave LFO that swings `param` between 0 and 1 (param base set to 0.5). */
function squareGate(ctx: AudioContext, param: AudioParam, hz: number): OscillatorNode {
  param.value = 0.5;
  const lfo = ctx.createOscillator();
  lfo.type = "square";
  lfo.frequency.value = hz;
  const depth = ctx.createGain();
  depth.gain.value = 0.5;
  lfo.connect(depth).connect(param);
  lfo.start();
  return lfo;
}

export class AmbienceBed {
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly out: GainNode;
  private readonly dayGain: GainNode;
  private readonly nightGain: GainNode;
  private readonly windGain: GainNode;
  private readonly birdBus: GainNode;
  private birdT = 2;
  private dayLevel = 0;

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
    private readonly noise: AudioBuffer,
  ) {
    const c = ctx;
    this.out = c.createGain();
    this.out.gain.value = 0;
    this.out.connect(destination);
    const loop = () => {
      const s = c.createBufferSource();
      s.buffer = noise;
      s.loop = true;
      s.start(0, Math.random() * noise.duration);
      this.sources.push(s);
      return s;
    };

    // ---- distant city hum (day) ----
    this.dayGain = c.createGain();
    this.dayGain.gain.value = 0;
    this.dayGain.connect(this.out);
    const humLp = c.createBiquadFilter();
    humLp.type = "lowpass";
    humLp.frequency.value = 170;
    humLp.Q.value = 0.5;
    const humG = c.createGain();
    humG.gain.value = 0.9;
    loop().connect(humLp).connect(humG).connect(this.dayGain);
    const washBp = c.createBiquadFilter();
    washBp.type = "bandpass";
    washBp.frequency.value = 520;
    washBp.Q.value = 0.4;
    const washG = c.createGain();
    washG.gain.value = 0.08;
    loop().connect(washBp).connect(washG).connect(this.dayGain);

    // ---- wind ----
    this.windGain = c.createGain();
    this.windGain.gain.value = 0;
    this.windGain.connect(this.out);
    const windBp = c.createBiquadFilter();
    windBp.type = "bandpass";
    windBp.frequency.value = 520;
    windBp.Q.value = 0.9;
    const sweep = c.createOscillator();
    sweep.frequency.value = 0.07;
    const sweepDepth = c.createGain();
    sweepDepth.gain.value = 260;
    sweep.connect(sweepDepth).connect(windBp.frequency);
    sweep.start();
    this.sources.push(sweep);
    const gust = c.createGain();
    gust.gain.value = 0.7;
    const gustLfo = c.createOscillator();
    gustLfo.frequency.value = 0.13;
    const gustDepth = c.createGain();
    gustDepth.gain.value = 0.3;
    gustLfo.connect(gustDepth).connect(gust.gain);
    gustLfo.start();
    this.sources.push(gustLfo);
    loop().connect(windBp).connect(gust).connect(this.windGain);

    // ---- crickets (night) ----
    this.nightGain = c.createGain();
    this.nightGain.gain.value = 0;
    this.nightGain.connect(this.out);
    for (const [hz, trill, chirp, pan] of [
      [4300, 31, 1.45, -0.5],
      [4720, 27, 1.9, 0.55],
    ] as const) {
      const osc = c.createOscillator();
      osc.frequency.value = hz;
      const g1 = c.createGain();
      const g2 = c.createGain();
      const lvl = c.createGain();
      lvl.gain.value = 0.035;
      const p = c.createStereoPanner();
      p.pan.value = pan;
      osc.connect(g1).connect(g2).connect(lvl).connect(p).connect(this.nightGain);
      osc.start();
      this.sources.push(osc, squareGate(c, g1.gain, trill), squareGate(c, g2.gain, chirp));
    }

    this.birdBus = c.createGain();
    this.birdBus.gain.value = 0.5;
    this.birdBus.connect(this.out);
  }

  /** Per-frame mix (ambience.ts ambienceMix); `level` 0 silences the bed (paused / sound off). */
  update(dt: number, mix: AmbienceMix, level: number): void {
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(level, t, 0.4);
    this.dayGain.gain.setTargetAtTime(0.28 * mix.day, t, SMOOTH);
    this.nightGain.gain.setTargetAtTime(mix.night, t, SMOOTH);
    this.windGain.gain.setTargetAtTime(0.32 * mix.wind * mix.wind, t, SMOOTH);
    this.dayLevel = mix.day;
    this.birdT -= dt;
    if (this.birdT <= 0) {
      this.birdT = nextBirdDelay(Math.random());
      if (level > 0.01 && this.dayLevel > 0.15) this.bird(this.dayLevel);
    }
  }

  /** One bird call: 2-5 quick whistles with pitch sweeps. */
  private bird(level: number): void {
    const c = this.ctx;
    const pan = c.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(this.birdBus);
    const notes = 2 + Math.floor(Math.random() * 4);
    const base = 2600 + Math.random() * 1600;
    let t = c.currentTime + 0.02;
    for (let i = 0; i < notes; i++) {
      const dur = 0.06 + Math.random() * 0.09;
      const o = c.createOscillator();
      o.type = "sine";
      const f0 = base * (0.85 + Math.random() * 0.3);
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * (Math.random() < 0.5 ? 1.45 : 0.7), t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05 * level, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
      o.connect(g).connect(pan);
      o.start(t);
      o.stop(t + dur + 0.02);
      t += dur + 0.03 + Math.random() * 0.07;
    }
  }

  dispose(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    this.out.disconnect();
  }
}

/** One footstep (`profile` from ambience.ts) of loudness `gain` into `out`. */
export function playFootstep(ctx: AudioContext, out: AudioNode, noise: AudioBuffer, profile: FootstepProfile, gain: number): void {
  const t = ctx.currentTime;
  const v = 0.9 + Math.random() * 0.2;
  // Scuff: filtered noise burst.
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = profile.filter;
  f.frequency.value = profile.noiseHz * v;
  f.Q.value = profile.q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(profile.gain * gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0005, t + profile.decay);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * (noise.duration - 0.3), profile.decay + 0.03);
  // Heel thump.
  if (profile.thumpGain > 0) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(profile.thumpHz * v * 1.4, t);
    o.frequency.exponentialRampToValueAtTime(profile.thumpHz * v, t + 0.04);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(profile.thumpGain * gain, t + 0.004);
    og.gain.exponentialRampToValueAtTime(0.0005, t + 0.06);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + 0.08);
  }
  // Gravel grains: tiny high clicks spread over the step.
  for (let i = 0; i < profile.grains; i++) {
    const tg = t + 0.005 + Math.random() * profile.decay;
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const hp = ctx.createBiquadFilter();
    hp.type = "bandpass";
    hp.frequency.value = 3500 + Math.random() * 3000;
    hp.Q.value = 3;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(profile.gain * gain * (0.4 + Math.random() * 0.5), tg);
    sg.gain.exponentialRampToValueAtTime(0.0005, tg + 0.012);
    s.connect(hp).connect(sg).connect(out);
    s.start(tg, Math.random() * (noise.duration - 0.1), 0.02);
  }
}

/** Car door: opening = latch click + short hinge creak; closing = body thump + latch. */
export function playDoor(ctx: AudioContext, out: AudioNode, noise: AudioBuffer, open: boolean, gain = 1): void {
  const t = ctx.currentTime;
  const burst = (at: number, type: BiquadFilterType, hz: number, q: number, level: number, decay: number) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = hz;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(level * gain, at + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0005, at + decay);
    s.connect(f).connect(g).connect(out);
    s.start(at, Math.random() * (noise.duration - 0.4), decay + 0.03);
  };
  if (open) {
    burst(t, "highpass", 2800, 2, 0.18, 0.025);
    burst(t + 0.03, "bandpass", 1400, 5, 0.08, 0.05);
    // Hinge creak: a short wavering tone.
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(380, t + 0.06);
    o.frequency.linearRampToValueAtTime(300, t + 0.28);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900;
    bp.Q.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.025 * gain, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.3);
    o.connect(bp).connect(g).connect(out);
    o.start(t + 0.06);
    o.stop(t + 0.32);
    return;
  }
  // Slam: low body thump + muffled rattle + latch.
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(95, t);
  o.frequency.exponentialRampToValueAtTime(48, t + 0.16);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.45 * gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0008, t + 0.2);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.24);
  burst(t, "lowpass", 900, 0.7, 0.3, 0.12);
  burst(t + 0.015, "highpass", 3200, 2, 0.12, 0.02);
}
