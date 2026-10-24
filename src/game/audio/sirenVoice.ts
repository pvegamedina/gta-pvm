// Synthesized two-tone siren voice: a sawtooth + square pair (a fifth apart,
// for a horn-like buzz) through a low-pass "speaker" filter, a gain and a
// stereo panner. Built once and kept running at zero gain when unused; the
// pitch follows sirenFrequency() with a short glide between the two tones.

import { sirenFrequency, sirenGain } from "./siren";

/** Peak level of a siren at the listener (relative to the master bus). */
const SIREN_LEVEL = 0.11;

export class SirenVoice {
  /** Source currently using this voice (null = free). */
  id: string | null = null;
  private start = 0;
  private readonly osc: OscillatorNode;
  private readonly osc2: OscillatorNode;
  private readonly lp: BiquadFilterNode;
  private readonly gain: GainNode;
  private readonly pan: StereoPannerNode;

  constructor(private readonly ctx: AudioContext, out: AudioNode) {
    this.osc = ctx.createOscillator();
    this.osc.type = "sawtooth";
    this.osc2 = ctx.createOscillator();
    this.osc2.type = "square";
    const mix2 = ctx.createGain();
    mix2.gain.value = 0.35;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = "lowpass";
    this.lp.frequency.value = 3000;
    this.lp.Q.value = 0.9;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.pan = ctx.createStereoPanner();
    this.osc.connect(this.lp);
    this.osc2.connect(mix2);
    mix2.connect(this.lp);
    this.lp.connect(this.gain);
    this.gain.connect(this.pan);
    this.pan.connect(out);
    this.osc.start();
    this.osc2.start();
  }

  /** Claims the voice for a new source: its hi-lo cycle starts now. */
  assign(id: string): void {
    this.id = id;
    this.start = this.ctx.currentTime;
  }

  /** Per-frame update; `on` false fades it out (paused / sound off / freed). */
  update(on: boolean, distance: number, pan: number): void {
    const now = this.ctx.currentTime;
    const f = sirenFrequency(now - this.start);
    this.osc.frequency.setTargetAtTime(f, now, 0.012);
    this.osc2.frequency.setTargetAtTime(f * 1.5, now, 0.012);
    const g = on ? sirenGain(distance) : 0;
    this.gain.gain.setTargetAtTime(SIREN_LEVEL * g, now, 0.05);
    // Far sirens lose their top end.
    this.lp.frequency.setTargetAtTime(900 + 2600 * g, now, 0.1);
    this.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), now, 0.05);
  }

  dispose(): void {
    try {
      this.osc.stop();
      this.osc2.stop();
    } catch {
      // Already stopped (context closed).
    }
    this.gain.disconnect();
  }
}
