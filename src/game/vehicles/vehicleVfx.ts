// Vehicle visual effects (cosmetic, local only), all bounded pools with no
// per-frame scene churn:
//
// - skid marks: one ring buffer of SKID_CAPACITY dark quads (one draw call)
//   laid by the player's wheels while the tyres slip on hard ground; each
//   quad stores its birth time and fades in the shader (no per-frame
//   re-upload), only new quads are uploaded (update ranges);
// - exhaust smoke + dust: one ParticleSystem (one draw call) — puffs from
//   the tailpipe of the player's car and nearby traffic, more on throttle;
//   brown dust from the wheels when braking/sliding on grass or gravel;
// - headlight beams at night: one InstancedMesh of additive cones (one draw
//   call) on every lit vehicle near the camera; the player's car also has
//   the real SpotLight from world/environment.ts (carSpot).
//
// Decisions (slip, rates, dust, segment emission) are pure in vfxLogic.ts.

import * as THREE from "three";
import type { Vehicle } from "./meshes";
import { EmissionAccumulator, SKID_THRESHOLD, SkidEmitter, dustAmount, exhaustRate } from "./vfxLogic";
import { ParticleSystem } from "../vfx/particleSystem";
import type { ParticleLook } from "../vfx/particles";
import type { GroundSurface } from "../world/campus/groundMaterial";

/** Skid-mark quads kept on the ground (oldest recycled), their life and fade-out (s). */
export const SKID_CAPACITY = 600;
const SKID_LIFE = 22;
const SKID_FADE = 6;
const SKID_WIDTH = 0.24;
/** Above the surface height: road ribbons sit 6 cm over the terrain. */
const SKID_LIFT = 0.075;
/** Smoke + dust particles alive at once. */
export const PARTICLE_CAPACITY = 384;
/** Headlight cones (two per vehicle). */
const BEAM_CAPACITY = 48;
const BEAM_RANGE = 95;
const BEAM_LENGTH = 13;
const BEAM_RADIUS = 2.6;
/** Traffic farther than this (m) from the camera does not smoke. */
const EXHAUST_RANGE = 70;

const SMOKE: ParticleLook = { life: 1.6, size0: 0.25, size1: 1.6, alpha: 0.38, r: 0.58, g: 0.58, b: 0.6 };
const SMOKE_HEAVY: ParticleLook = { life: 2, size0: 0.35, size1: 2.2, alpha: 0.55, r: 0.4, g: 0.4, b: 0.42 };
const DUST: ParticleLook = { life: 1.4, size0: 0.4, size1: 2.4, alpha: 0.45, r: 0.62, g: 0.53, b: 0.4 };
const TYRE_SMOKE: ParticleLook = { life: 1.8, size0: 0.4, size1: 2.6, alpha: 0.38, r: 0.82, g: 0.82, b: 0.84 };

export interface PlayerCarFx {
  car: Vehicle;
  throttle: number;
  handbrake: boolean;
  /** 0..1 how hard the service brake bites. */
  hardBrake: number;
  /** Tyre slip computed by the caller (tyreSlip), shared with the screech voice. */
  slip: number;
}

export interface VfxFrame {
  dt: number;
  time: number;
  camera: THREE.PerspectiveCamera;
  viewportHeight: number;
  nightF: number;
  player: PlayerCarFx | null;
  /** Every local + remote vehicle (traffic exhaust, headlight beams). */
  vehicles: Iterable<Vehicle>;
  groundY(x: number, z: number): number;
  surfaceAt(x: number, z: number): GroundSurface;
}

/** Root-local head-lamp centres per vehicle (measured once from its lamp meshes). */
const lampCache = new WeakMap<Vehicle, THREE.Vector3[]>();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

function headLamps(v: Vehicle): THREE.Vector3[] {
  let l = lampCache.get(v);
  if (l) return l;
  const left = new THREE.Vector3();
  const right = new THREE.Vector3();
  let nl = 0;
  let nr = 0;
  const add = (p: THREE.Vector3) => {
    if (p.x >= 0) {
      left.add(p);
      nl++;
    } else {
      right.add(p);
      nr++;
    }
  };
  v.root.updateMatrixWorld(true);
  for (const lamp of v.visual.head) {
    const g = lamp.mesh.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    // Box corners in the vehicle's root frame.
    v.root.worldToLocal(lamp.mesh.localToWorld(_a.copy(g.boundingBox!.min)));
    v.root.worldToLocal(lamp.mesh.localToWorld(_b.copy(g.boundingBox!.max)));
    if (Math.abs(_b.x - _a.x) > 0.6) {
      // One mesh holding both headlights: a beam near each end.
      add(new THREE.Vector3().lerpVectors(_a, _b, 0.18));
      add(new THREE.Vector3().lerpVectors(_a, _b, 0.82));
    } else add(new THREE.Vector3().addVectors(_a, _b).multiplyScalar(0.5));
  }
  l = [];
  if (nl) l.push(left.divideScalar(nl));
  if (nr) l.push(right.divideScalar(nr));
  if (l.length === 0) {
    // No lamp meshes: estimate from the dimensions.
    const y = Math.min(1.1, Math.max(0.6, v.spec.H * 0.4));
    const z = v.spec.zc + v.spec.L / 2 - 0.1;
    l.push(new THREE.Vector3(v.spec.W * 0.34, y, z), new THREE.Vector3(-v.spec.W * 0.34, y, z));
  }
  lampCache.set(v, l);
  return l;
}

/** Cone pointing +z with its apex at the origin, bright at the lamp fading to black at the far end. */
function beamGeometry(): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(1, 1, 18, 6, true);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, 0.5);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, pos.getZ(i)));
    const k = Math.pow(1 - t, 1.8) * 0.22;
    col[i * 3] = k;
    col[i * 3 + 1] = k * 0.93;
    col[i * 3 + 2] = k * 0.75;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

export class VehicleVfx {
  readonly group = new THREE.Group();
  private readonly particles = new ParticleSystem(PARTICLE_CAPACITY, 1.1, 0.55);
  // Skid marks.
  private readonly skidGeo = new THREE.BufferGeometry();
  private readonly skidPos: THREE.BufferAttribute;
  private readonly skidBirth: THREE.BufferAttribute;
  private readonly skidUniforms = { uTime: { value: 0 }, uLife: { value: SKID_LIFE }, uFade: { value: SKID_FADE } };
  private skidNext = 0;
  private readonly wheels = [new SkidEmitter(0.35), new SkidEmitter(0.35), new SkidEmitter(0.35), new SkidEmitter(0.35)];
  private skidCar: Vehicle | null = null;
  // Emission.
  private readonly exhaust = new EmissionAccumulator();
  private readonly dust = new EmissionAccumulator();
  private readonly tyreSmoke = new EmissionAccumulator();
  private readonly traffic = new WeakMap<Vehicle, { acc: EmissionAccumulator; prev: number }>();
  // Beams.
  private readonly beams: THREE.InstancedMesh;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.07);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3(BEAM_RADIUS, BEAM_RADIUS * 0.55, BEAM_LENGTH);

  constructor(scene: THREE.Scene) {
    this.group.name = "vfx";
    // ---- skid marks ----
    const n = SKID_CAPACITY;
    this.skidPos = new THREE.BufferAttribute(new Float32Array(n * 4 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.skidBirth = new THREE.BufferAttribute(new Float32Array(n * 4).fill(-1e6), 1).setUsage(THREE.DynamicDrawUsage);
    const idx = new Uint16Array(n * 6);
    for (let i = 0; i < n; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    this.skidGeo.setAttribute("position", this.skidPos);
    this.skidGeo.setAttribute("birth", this.skidBirth);
    this.skidGeo.setIndex(new THREE.BufferAttribute(idx, 1));
    const skidMat = new THREE.MeshBasicMaterial({ color: 0x0c0c0c, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8, side: THREE.DoubleSide });
    // Flat decals: one pass (three draws transparent double-sided materials twice by default).
    skidMat.forceSinglePass = true;
    skidMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.skidUniforms);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float birth;\nuniform float uTime;\nuniform float uLife;\nuniform float uFade;\nvarying float vSkid;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSkid = clamp((uLife - (uTime - birth)) / uFade, 0.0, 1.0) * 0.6;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vSkid;")
        .replace("#include <alphatest_fragment>", "#include <alphatest_fragment>\ndiffuseColor.a *= vSkid;");
    };
    const skids = new THREE.Mesh(this.skidGeo, skidMat);
    skids.frustumCulled = false;
    skids.renderOrder = 1;
    skids.name = "vfx:skids";
    // ---- beams ----
    const beamMat = new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
    // Additive: draw order of the faces does not matter, so a single pass.
    beamMat.forceSinglePass = true;
    this.beams = new THREE.InstancedMesh(beamGeometry(), beamMat, BEAM_CAPACITY);
    this.beams.count = 0;
    this.beams.frustumCulled = false;
    this.beams.renderOrder = 3;
    this.beams.name = "vfx:beams";
    this.group.add(skids, this.particles.points, this.beams);
    scene.add(this.group);
  }

  update(f: VfxFrame): void {
    this.skidUniforms.uTime.value = f.time;
    if (f.player) this.playerCar(f, f.player);
    else this.skidCar = null;
    this.trafficExhaust(f);
    this.particles.update(f.dt, f.camera, f.viewportHeight);
    this.updateBeams(f);
  }

  private playerCar(f: VfxFrame, pc: PlayerCarFx): void {
    const v = pc.car;
    if (this.skidCar !== v) {
      for (const w of this.wheels) w.reset();
      this.skidCar = v;
    }
    const sp = v.spec;
    const fx = Math.sin(v.yaw);
    const fz = Math.cos(v.yaw);
    // Right vector in the game's convention (x = left side of the car is +).
    const lx = Math.cos(v.yaw);
    const lz = -Math.sin(v.yaw);
    const speed = Math.abs(v.speed);
    const surface = f.surfaceAt(v.x, v.z);
    const hard = surface === "asphalt" || surface === "pavement";
    // ---- skid marks (rear wheels; all four under a locked-up service brake) ----
    const k = sp.model.stretch ?? 1;
    const rearZ = sp.model.geometry.rearAxleZ * sp.model.scale * k;
    const frontZ = sp.model.geometry.frontAxleZ * sp.model.scale * k;
    const track = sp.W / 2 - 0.22;
    const skidding = hard && pc.slip > SKID_THRESHOLD;
    for (let i = 0; i < 4; i++) {
      const front = i >= 2;
      const side = i % 2 === 0 ? 1 : -1;
      const az = front ? frontZ : rearZ;
      const wx = v.x + fx * az + lx * side * track;
      const wz = v.z + fz * az + lz * side * track;
      const seg = this.wheels[i].update(wx, wz, skidding && (!front || pc.hardBrake > 0));
      if (seg) this.addSkid(seg.ax, seg.az, seg.bx, seg.bz, f);
    }
    // Tyre smoke when the rear tyres really scrub on tarmac.
    if (skidding && speed > 6) {
      const n = this.tyreSmoke.take(14 * pc.slip, f.dt, 4);
      for (let j = 0; j < n; j++) {
        const side = j % 2 === 0 ? 1 : -1;
        const wx = v.x + fx * rearZ + lx * side * track;
        const wz = v.z + fz * rearZ + lz * side * track;
        this.particles.spawn(wx, f.groundY(wx, wz) + 0.25, wz, (Math.random() - 0.5) * 0.8, 0.4, (Math.random() - 0.5) * 0.8, TYRE_SMOKE);
      }
    }
    // ---- exhaust ----
    const rate = exhaustRate(pc.throttle, v.speed, sp.max);
    this.puffs(v, this.exhaust.take(rate, f.dt, 6), pc.throttle > 0.5 && speed < sp.max * 0.4);
    // ---- dust on loose ground ----
    const d = dustAmount(surface, v.speed, v.braking, pc.slip);
    if (d > 0) {
      const n = this.dust.take(30 * d, f.dt, 6);
      for (let j = 0; j < n; j++) {
        const side = Math.random() < 0.5 ? 1 : -1;
        const az = Math.random() < 0.5 ? rearZ : frontZ;
        const wx = v.x + fx * az + lx * side * (track + 0.1);
        const wz = v.z + fz * az + lz * side * (track + 0.1);
        this.particles.spawn(wx, f.groundY(wx, wz) + 0.2, wz, v.vx * 0.25 + (Math.random() - 0.5) * 1.5, 0.6 + Math.random() * 0.6, v.vz * 0.25 + (Math.random() - 0.5) * 1.5, DUST);
      }
    }
  }

  /** Tailpipe puffs for vehicle `v` (right rear corner, drifting back and up). */
  private puffs(v: Vehicle, n: number, heavy: boolean): void {
    if (n <= 0) return;
    const sp = v.spec;
    const fx = Math.sin(v.yaw);
    const fz = Math.cos(v.yaw);
    const rz = sp.zc - sp.L / 2 - 0.05;
    const rx = -sp.W * 0.28;
    const px = v.x + fx * rz + Math.cos(v.yaw) * rx;
    const pz = v.z + fz * rz - Math.sin(v.yaw) * rx;
    const py = v.y + 0.32;
    for (let i = 0; i < n; i++) {
      this.particles.spawn(px, py, pz, v.vx * 0.3 - fx * 1.2 + (Math.random() - 0.5) * 0.4, 0.25 + Math.random() * 0.2, v.vz * 0.3 - fz * 1.2 + (Math.random() - 0.5) * 0.4, heavy ? SMOKE_HEAVY : SMOKE);
    }
  }

  private trafficExhaust(f: VfxFrame): void {
    const cx = f.camera.position.x;
    const cz = f.camera.position.z;
    for (const v of f.vehicles) {
      if (v.mode !== "ai" || !v.root.visible) continue;
      if (Math.abs(v.x - cx) > EXHAUST_RANGE || Math.abs(v.z - cz) > EXHAUST_RANGE) continue;
      let st = this.traffic.get(v);
      if (!st) this.traffic.set(v, (st = { acc: new EmissionAccumulator(), prev: v.speed }));
      // Throttle estimate from the speed change (pulling away from a light smokes).
      const accel = f.dt > 0 ? (v.speed - st.prev) / f.dt : 0;
      st.prev = v.speed;
      const throttle = Math.min(1, Math.max(0, accel / 3));
      this.puffs(v, st.acc.take(exhaustRate(throttle, v.speed, v.spec.max) * 0.6, f.dt, 3), false);
    }
  }

  private addSkid(ax: number, az: number, bx: number, bz: number, f: VfxFrame): void {
    const i = this.skidNext;
    this.skidNext = (this.skidNext + 1) % SKID_CAPACITY;
    const dx = bx - ax;
    const dz = bz - az;
    const l = Math.hypot(dx, dz) || 1;
    const px = (-dz / l) * (SKID_WIDTH / 2);
    const pz = (dx / l) * (SKID_WIDTH / 2);
    const ya = f.groundY(ax, az) + SKID_LIFT;
    const yb = f.groundY(bx, bz) + SKID_LIFT;
    const a = this.skidPos.array as Float32Array;
    const o = i * 12;
    a[o] = ax + px;
    a[o + 1] = ya;
    a[o + 2] = az + pz;
    a[o + 3] = ax - px;
    a[o + 4] = ya;
    a[o + 5] = az - pz;
    a[o + 6] = bx + px;
    a[o + 7] = yb;
    a[o + 8] = bz + pz;
    a[o + 9] = bx - px;
    a[o + 10] = yb;
    a[o + 11] = bz - pz;
    (this.skidBirth.array as Float32Array).fill(f.time, i * 4, i * 4 + 4);
    this.skidPos.addUpdateRange(i * 12, 12);
    this.skidBirth.addUpdateRange(i * 4, 4);
    this.skidPos.needsUpdate = true;
    this.skidBirth.needsUpdate = true;
  }

  private updateBeams(f: VfxFrame): void {
    let n = 0;
    if (f.nightF > 0.2) {
      const cx = f.camera.position.x;
      const cz = f.camera.position.z;
      for (const v of f.vehicles) {
        if (n + 2 > BEAM_CAPACITY) break;
        if (!v.visual.lit.head || !v.root.visible) continue;
        if (Math.abs(v.x - cx) > BEAM_RANGE || Math.abs(v.z - cz) > BEAM_RANGE) continue;
        this.q.setFromAxisAngle(this.up, v.yaw).multiply(this.qPitch);
        for (const lamp of headLamps(v)) {
          this.p.copy(lamp).applyAxisAngle(this.up, v.yaw);
          this.p.x += v.x;
          this.p.y += v.y;
          this.p.z += v.z;
          this.m4.compose(this.p, this.q, this.s);
          this.beams.setMatrixAt(n++, this.m4);
        }
      }
    }
    if (n !== this.beams.count || n > 0) {
      this.beams.count = n;
      this.beams.instanceMatrix.needsUpdate = n > 0;
    }
    this.beams.visible = n > 0;
  }

  /** Removes every skid mark and particle (game reset). */
  clear(): void {
    (this.skidBirth.array as Float32Array).fill(-1e6);
    this.skidBirth.clearUpdateRanges();
    this.skidBirth.needsUpdate = true;
    this.particles.clear();
    for (const w of this.wheels) w.reset();
  }

  dispose(): void {
    this.group.removeFromParent();
    this.skidGeo.dispose();
    this.particles.dispose();
    this.beams.geometry.dispose();
    (this.beams.material as THREE.Material).dispose();
  }
}
