// Pure engine + automatic gearbox model for the vehicle audio: road speed ->
// wheel rpm -> engine rpm through the gear ratios and a final drive derived
// from each vehicle's top speed (top gear at ~82 % of the redline), clutch
// slip when launching, shift logic with hysteresis (throttle-dependent shift
// points, kickdown, minimum time between shifts), timed shifts with an
// ignition/torque cut and the rpm falling to the next gear, a bouncing rev
// limiter, reverse, idle and a turbo that spools with load and blows off on
// lift-off. Plus the mapping from (rpm, load, boost) to the synthesis
// parameters audio/engineSynth.ts feeds into WebAudio. No WebAudio/THREE
// here: everything is unit-tested.

export interface EngineProfile {
  /** Cylinders of a 4-stroke engine: firing frequency = rpm / 60 * cylinders / 2. */
  cylinders: number;
  idleRpm: number;
  /** Full-throttle upshift point (and the top of the tachometer). */
  redline: number;
  /** Fuel cut: the rpm bounces just below this. */
  limiterRpm: number;
  /** rpm the clutch lets the engine rev to when launching at full throttle. */
  launchRpm: number;
  /** Forward gear ratios, 1st first (strictly decreasing). */
  gears: readonly number[];
  reverse: number;
  /** Duration of a gear change (s): torque cut and rpm drop. */
  shiftTime: number;
  diesel: boolean;
  turbo: boolean;
  /** Exhaust pops/crackle on upshifts and on the overrun. */
  pops: boolean;
  // ---- synthesis character ----
  /** Overall loudness (relative). */
  volume: number;
  /** Waveshaper drive (0..1): roughness/grit of the exhaust note. */
  grit: number;
  /** Induction roar share (0..1). */
  intake: number;
  /** Relative amplitudes of the exhaust harmonics (1 = firing order, 0.5 = half order...). */
  harmonics: readonly { order: number; gain: number }[];
}

const PETROL_4: EngineProfile["harmonics"] = [
  { order: 0.5, gain: 0.25 },
  { order: 1, gain: 1 },
  { order: 2, gain: 0.45 },
  { order: 3, gain: 0.18 },
  { order: 4, gain: 0.08 },
];
/** Cross-plane V8: strong half-order "burble". */
const V8: EngineProfile["harmonics"] = [
  { order: 0.25, gain: 0.3 },
  { order: 0.5, gain: 0.55 },
  { order: 1, gain: 1 },
  { order: 1.5, gain: 0.25 },
  { order: 2, gain: 0.4 },
  { order: 3, gain: 0.12 },
];
const V6: EngineProfile["harmonics"] = [
  { order: 0.5, gain: 0.35 },
  { order: 1, gain: 1 },
  { order: 2, gain: 0.35 },
  { order: 3, gain: 0.15 },
];
/** Diesel: dominant low orders plus clatter (added as noise by the synth). */
const DIESEL: EngineProfile["harmonics"] = [
  { order: 0.5, gain: 0.5 },
  { order: 1, gain: 1 },
  { order: 2, gain: 0.6 },
  { order: 3, gain: 0.35 },
  { order: 4, gain: 0.2 },
];

const SEDAN: EngineProfile = {
  cylinders: 4,
  idleRpm: 800,
  redline: 6500,
  limiterRpm: 6800,
  launchRpm: 2600,
  gears: [3.3, 2.1, 1.5, 1.15, 0.92],
  reverse: 3.4,
  shiftTime: 0.28,
  diesel: false,
  turbo: false,
  pops: false,
  volume: 1,
  grit: 0.25,
  intake: 0.35,
  harmonics: PETROL_4,
};

/**
 * Per-vehicle engine profiles keyed by vehicle type (vehicles/types.ts
 * VehicleTypeKey). bus/police/ambulance are ready for the Phase 2 fleet.
 */
export const ENGINE_PROFILES: Record<string, EngineProfile> = {
  sedan: SEDAN,
  taxi: { ...SEDAN, idleRpm: 780, grit: 0.2 },
  hatch: { ...SEDAN, idleRpm: 850, redline: 6800, limiterRpm: 7100, volume: 0.85, grit: 0.3, intake: 0.4 },
  sport: {
    cylinders: 8,
    idleRpm: 950,
    redline: 7800,
    limiterRpm: 8000,
    launchRpm: 3800,
    gears: [3.1, 2.2, 1.65, 1.3, 1.07, 0.9],
    reverse: 3.2,
    shiftTime: 0.12,
    diesel: false,
    turbo: true,
    pops: true,
    volume: 1.25,
    grit: 0.55,
    intake: 0.5,
    harmonics: V8,
  },
  suv: {
    ...SEDAN,
    cylinders: 6,
    idleRpm: 720,
    redline: 6000,
    limiterRpm: 6300,
    launchRpm: 2300,
    gears: [4.2, 2.6, 1.7, 1.3, 1.0, 0.8],
    reverse: 3.8,
    shiftTime: 0.35,
    volume: 1.05,
    grit: 0.3,
    intake: 0.3,
    harmonics: V6,
  },
  van: {
    cylinders: 4,
    idleRpm: 700,
    redline: 4200,
    limiterRpm: 4500,
    launchRpm: 1800,
    gears: [3.9, 2.2, 1.4, 1.0, 0.8],
    reverse: 3.7,
    shiftTime: 0.4,
    diesel: true,
    turbo: true,
    pops: false,
    volume: 1.1,
    grit: 0.45,
    intake: 0.25,
    harmonics: DIESEL,
  },
  bus: {
    cylinders: 6,
    idleRpm: 600,
    redline: 2600,
    limiterRpm: 2800,
    launchRpm: 1300,
    gears: [4.5, 2.8, 1.9, 1.4, 1.0, 0.75],
    reverse: 4.2,
    shiftTime: 0.5,
    diesel: true,
    turbo: true,
    pops: false,
    volume: 1.3,
    grit: 0.5,
    intake: 0.2,
    harmonics: DIESEL,
  },
  police: { ...SEDAN, cylinders: 8, idleRpm: 750, redline: 6200, limiterRpm: 6500, launchRpm: 2800, shiftTime: 0.22, volume: 1.15, grit: 0.4, harmonics: V8 },
  ambulance: {
    cylinders: 6,
    idleRpm: 680,
    redline: 4000,
    limiterRpm: 4300,
    launchRpm: 1700,
    gears: [4.0, 2.4, 1.5, 1.1, 0.85],
    reverse: 3.9,
    shiftTime: 0.4,
    diesel: true,
    turbo: true,
    pops: false,
    volume: 1.15,
    grit: 0.45,
    intake: 0.25,
    harmonics: DIESEL,
  },
};

/** Profile for a vehicle type, falling back to the sedan for unknown types. */
export function engineProfileFor(type: string): EngineProfile {
  return Object.hasOwn(ENGINE_PROFILES, type) ? ENGINE_PROFILES[type] : ENGINE_PROFILES.sedan;
}

/** Wheel revolutions per minute at road speed `speed` (m/s, either sign). */
export function wheelRpm(speed: number, wheelRadius: number): number {
  return (Math.abs(speed) / (2 * Math.PI * wheelRadius)) * 60;
}

export type EngineEvent = "upshift" | "downshift" | "blowoff";

export interface EngineInput {
  /** Forward road speed (m/s, negative = reversing). */
  speed: number;
  /** Accelerator 0..1 (the reverse pedal while backing up). */
  throttle: number;
}

// ---- Tunables ----
/** Top gear at top speed sits at this share of the redline (some headroom). */
const TOP_GEAR_RPM_SHARE = 0.82;
/** Upshift point = lerp(CRUISE, FULL, throttle) x redline. */
const UPSHIFT_CRUISE = 0.45;
const UPSHIFT_FULL = 0.96;
/** Downshift when the next-lower gear would turn below this share of the upshift point (hysteresis + kickdown). */
const DOWNSHIFT_SHARE = 0.78;
/** Minimum time between gear changes (s). */
const MIN_SHIFT_INTERVAL = 0.5;
/** Clutch fully engaged above this speed (m/s); below it the engine may rev above the wheels. */
const CLUTCH_ENGAGE_SPEED = 4;
/** Engine inertia: rpm time constant (s) towards its target. */
const RPM_TAU = 0.07;
/** Load (smoothed throttle) time constant (s). */
const LOAD_TAU = 0.08;
/** Rev limiter: rpm fall rate while the fuel is cut (rpm/s) and re-arm hysteresis. */
const LIMITER_DROP = 5000;
const LIMITER_HYST = 250;
/** Turbo: spool / decay time constants (s), boost threshold rpm range, blow-off trigger. */
const SPOOL_TAU = 0.6;
const DECAY_TAU = 0.15;
const BOOST_RPM_START = 1800;
const BOOST_RPM_FULL = 4200;
const BLOWOFF_BOOST = 0.5;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const approachExp = (v: number, target: number, tau: number, dt: number) => target + (v - target) * Math.exp(-dt / tau);

export class EngineModel {
  /** Current gear: 1..n forward, -1 reverse. */
  gear = 1;
  rpm: number;
  /** Effective engine load 0..1 (0 during shifts and fuel cut). */
  load = 0;
  /** Turbo boost 0..1 (always 0 without a turbo). */
  boost = 0;
  /** True while the rev limiter cuts the fuel. */
  limiting = false;
  /** Time left in the current gear change (s). */
  shiftLeft = 0;
  readonly finalDrive: number;
  private sinceShift = Infinity;
  private blowoffArmed = false;
  private readonly events: EngineEvent[] = [];

  constructor(
    readonly profile: EngineProfile,
    topSpeed: number,
    readonly wheelRadius: number,
  ) {
    const top = profile.gears[profile.gears.length - 1];
    this.finalDrive = (TOP_GEAR_RPM_SHARE * profile.redline) / (wheelRpm(topSpeed, wheelRadius) * top);
    this.rpm = profile.idleRpm;
  }

  /** Engine rpm locked to the wheels in `gear` (1..n, or -1 for reverse) at `speed`. */
  gearedRpm(speed: number, gear: number): number {
    const ratio = gear < 0 ? this.profile.reverse : this.profile.gears[Math.min(gear, this.profile.gears.length) - 1];
    return wheelRpm(speed, this.wheelRadius) * ratio * this.finalDrive;
  }

  private upshiftRpm(throttle: number): number {
    return (UPSHIFT_CRUISE + (UPSHIFT_FULL - UPSHIFT_CRUISE) * throttle) * this.profile.redline;
  }

  private shift(to: number, event: EngineEvent | null): void {
    this.gear = to;
    this.sinceShift = 0;
    if (event) {
      this.shiftLeft = this.profile.shiftTime;
      this.load = 0; // ignition cut: instantaneous
      this.events.push(event);
    }
  }

  /** Advances the model; returns this step's events (reused array, valid until the next call). */
  update(dt: number, input: EngineInput): readonly EngineEvent[] {
    this.events.length = 0;
    const p = this.profile;
    const throttle = clamp01(input.throttle);
    const speed = input.speed;
    this.sinceShift += dt;
    this.shiftLeft = Math.max(0, this.shiftLeft - dt);

    // ---- gear selection ----
    if (speed < -0.5 && this.gear !== -1) this.shift(-1, null);
    else if (this.gear === -1 && speed > -0.2) this.shift(1, null);
    else if (this.gear > 0 && this.shiftLeft === 0 && this.sinceShift >= MIN_SHIFT_INTERVAL) {
      const up = this.upshiftRpm(throttle);
      if (this.gear < p.gears.length && this.gearedRpm(speed, this.gear) > up) this.shift(this.gear + 1, "upshift");
      else if (this.gear > 1 && this.gearedRpm(speed, this.gear - 1) < DOWNSHIFT_SHARE * up) {
        // Hard braking / big kickdown: drop straight to the right gear in one change.
        let g = this.gear - 1;
        while (g > 1 && this.gearedRpm(speed, g - 1) < DOWNSHIFT_SHARE * up) g--;
        this.shift(g, "downshift");
      }
    }

    // ---- rpm ----
    const shifting = this.shiftLeft > 0;
    const geared = this.gearedRpm(speed, this.gear);
    const clutch = this.gear <= 1 ? clamp01(1 - Math.abs(speed) / CLUTCH_ENGAGE_SPEED) : 0;
    const slip = p.idleRpm + (shifting ? 0 : throttle) * (p.launchRpm - p.idleRpm) * clutch;
    const target = Math.max(p.idleRpm, geared, slip);
    if (this.limiting) {
      this.rpm -= LIMITER_DROP * dt;
      if (this.rpm <= p.limiterRpm - LIMITER_HYST) this.limiting = false;
    } else {
      this.rpm = Math.min(p.limiterRpm, approachExp(this.rpm, target, shifting ? p.shiftTime * 0.35 : RPM_TAU, dt));
      if (this.rpm >= p.limiterRpm - 1 && target >= p.limiterRpm) this.limiting = true;
    }
    this.rpm = Math.max(p.idleRpm, this.rpm);

    // ---- load + turbo ----
    const drive = shifting || this.limiting ? 0 : throttle;
    this.load = drive < this.load && (shifting || this.limiting) ? 0 : approachExp(this.load, drive, LOAD_TAU, dt);
    if (p.turbo) {
      const want = this.load * clamp01((this.rpm - BOOST_RPM_START) / (BOOST_RPM_FULL - BOOST_RPM_START));
      this.boost = approachExp(this.boost, want, want > this.boost ? SPOOL_TAU : DECAY_TAU, dt);
      if (this.boost > BLOWOFF_BOOST && throttle > 0.5) this.blowoffArmed = true;
      if (this.blowoffArmed && throttle < 0.2) {
        this.blowoffArmed = false;
        this.events.push("blowoff");
      }
    }
    return this.events;
  }
}

/** WebAudio-facing parameters of an engine voice (see audio/engineSynth.ts). */
export interface EngineSoundParams {
  /** Combustion pulses per second (Hz). */
  firingHz: number;
  exhaustGain: number;
  /** Low-pass cutoff on the exhaust (Hz): opens up with rpm and load. */
  exhaustCutoff: number;
  /** Waveshaper drive 0..1. */
  drive: number;
  intakeGain: number;
  /** Combustion/mechanical noise (louder and clattery for diesels). */
  noiseGain: number;
  noiseHz: number;
  turboHz: number;
  turboGain: number;
}

/** Maps an engine state to synthesis parameters (pure, so the verification can log it). */
export function engineSoundParams(p: EngineProfile, rpm: number, load: number, boost: number): EngineSoundParams {
  const firingHz = (rpm / 60) * (p.cylinders / 2);
  const rpmN = Math.min(1.2, rpm / p.redline);
  const l = clamp01(load);
  return {
    firingHz,
    exhaustGain: p.volume * (0.3 + 0.7 * l) * (0.55 + 0.45 * rpmN),
    exhaustCutoff: Math.min(9000, firingHz * (2.5 + 4 * l) + 250),
    drive: p.grit * (0.25 + 0.75 * l),
    intakeGain: p.volume * p.intake * (0.05 + 0.95 * l) * rpmN,
    noiseGain: p.volume * (p.diesel ? 0.3 : 0.12) * (0.3 + 0.7 * l) * (0.5 + 0.5 * rpmN),
    noiseHz: Math.min(8000, firingHz * (p.diesel ? 6 : 4) + 300),
    turboHz: 2200 + 5200 * clamp01(boost),
    turboGain: p.turbo ? 0.07 * p.volume * clamp01(boost) * clamp01(boost) : 0,
  };
}

/** The `cap` nearest entries within `maxDistance` (m), nearest first: which remote cars get an engine voice. */
export function nearestVoices<T extends { distance: number }>(cars: readonly T[], cap: number, maxDistance: number): T[] {
  return cars
    .filter((c) => c.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, cap);
}

/** Acceleration (m/s²) that reads as full throttle, and the throttle held while cruising. */
const FULL_THROTTLE_ACCEL = 4;
const CRUISE_THROTTLE = 0.25;

/**
 * Throttle guess for a remote car from consecutive speeds (only speed is
 * networked): accelerating -> proportional, steady and moving -> light
 * cruise throttle, slowing down or parked -> 0.
 */
export function estimateThrottle(prevSpeed: number, speed: number, dt: number): number {
  const v = Math.abs(speed);
  if (v < 0.3 || dt <= 0) return 0;
  const accel = (v - Math.abs(prevSpeed)) / dt;
  if (accel < -0.5) return 0;
  return Math.max(CRUISE_THROTTLE, clamp01(accel / FULL_THROTTLE_ACCEL));
}
