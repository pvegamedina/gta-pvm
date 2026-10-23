// WebAudio engine drone, horn and crash thump. Exposes the shared AudioContext
// + master gain so combat/effects.ts can synthesize gunshots through the same graph.

export interface AudioSystem {
  ctx: AudioContext | null;
  master: GainNode | null;
  soundOn: boolean;
  init(): void;
  horn(): void;
  thump(strength: number): void;
  updateEngine(on: boolean, speed: number, throttle: number): void;
}

export function createAudioSystem(): AudioSystem {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let engOsc: OscillatorNode | null = null;
  let engGain: GainNode | null = null;
  let engFilter: BiquadFilterNode | null = null;

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
    updateEngine(on: boolean, speed: number, throttle: number) {
      if (!ctx || !engGain || !engOsc || !engFilter) return;
      engGain.gain.setTargetAtTime(on ? 0.05 + throttle * 0.04 : 0, ctx.currentTime, 0.08);
      engOsc.frequency.setTargetAtTime(48 + speed * 3.4, ctx.currentTime, 0.08);
      engFilter.frequency.setTargetAtTime(300 + speed * 18 + throttle * 200, ctx.currentTime, 0.1);
    },
  };
  return sys;
}
