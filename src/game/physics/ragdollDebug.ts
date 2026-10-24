// F4 ragdoll debug overlay (works in production too): for every live ragdoll
// it draws the collider wireframes (coloured by muscle strength: green strong,
// red weak, grey limp), the joint anchors, the pelvis velocity, the
// mass-weighted centre of mass with its drop line to the ground, and the
// ground contact points; a small monospace DOM panel lists each ragdoll's
// muscle mode, mean strength, worst motor error, pelvis speed and sleep state.
// Everything is built lazily on first show and the per-frame update returns
// at once while hidden, so it costs nothing until F4 is pressed.

import * as THREE from "three";
import type { PhysicsWorld } from "./physicsWorld";
import type { Ragdoll } from "./ragdoll";

/** Segments in the wireframe circles (capsules, spheres). */
const CIRCLE_SEGMENTS = 12;
/** Seconds between panel text refreshes. */
const TEXT_EVERY = 0.25;
/** Pelvis velocity arrow length per m/s. */
const VELOCITY_SCALE = 0.3;
/** Farthest ground below the centre of mass that the drop line looks for (m). */
const GROUND_RAY = 30;
/** Initial vertex capacity of the line / point buffers (grown by doubling). */
const LINE_CAPACITY = 16384;
const POINT_CAPACITY = 1024;

// ---- Pure helpers (unit-tested) ----

/** A box's 12 edges as xyz segment pairs, centred on the origin. */
export function boxSegments(hx: number, hy: number, hz: number): Float32Array {
  const c = [-1, 1];
  const out: number[] = [];
  // Edges along X, then Y, then Z: the other two coordinates take every sign combination.
  for (const a of c) for (const b of c) out.push(-hx, a * hy, b * hz, hx, a * hy, b * hz);
  for (const a of c) for (const b of c) out.push(a * hx, -hy, b * hz, a * hx, hy, b * hz);
  for (const a of c) for (const b of c) out.push(a * hx, b * hy, -hz, a * hx, b * hy, hz);
  return new Float32Array(out);
}

/** Circle of radius `r` (as segments) in the plane spanned by axes `u` and `v` (0 = x, 1 = y, 2 = z), offset `oy` on Y. */
function circle(out: number[], r: number, u: number, v: number, n: number, oy = 0, from = 0, to = Math.PI * 2): void {
  for (let i = 0; i < n; i++) {
    const a0 = from + ((to - from) * i) / n;
    const a1 = from + ((to - from) * (i + 1)) / n;
    for (const a of [a0, a1]) {
      const p = [0, oy, 0];
      p[u] += Math.cos(a) * r;
      p[v] += Math.sin(a) * r;
      out.push(p[0], p[1], p[2]);
    }
  }
}

/** A capsule along Y (Rapier convention): two rings, four side lines and the two half-dome outlines. */
export function capsuleSegments(halfHeight: number, radius: number, n = CIRCLE_SEGMENTS): Float32Array {
  const out: number[] = [];
  circle(out, radius, 0, 2, n, halfHeight);
  circle(out, radius, 0, 2, n, -halfHeight);
  for (const [x, z] of [[radius, 0], [-radius, 0], [0, radius], [0, -radius]]) out.push(x, -halfHeight, z, x, halfHeight, z);
  // Dome arcs in the XY and ZY planes (top: 0..π, bottom: π..2π).
  for (const u of [0, 2]) {
    circle(out, radius, u, 1, n / 2, halfHeight, 0, Math.PI);
    circle(out, radius, u, 1, n / 2, -halfHeight, Math.PI, Math.PI * 2);
  }
  return new Float32Array(out);
}

/** A sphere as three great circles. */
export function sphereSegments(radius: number, n = CIRCLE_SEGMENTS): Float32Array {
  const out: number[] = [];
  circle(out, radius, 0, 2, n);
  circle(out, radius, 0, 1, n);
  circle(out, radius, 2, 1, n);
  return new Float32Array(out);
}

/** RGB 0..1 for a ragdoll's muscle state: red (weak) -> green (strong) while muscles act, grey when limp. */
export function strengthColor(strength: number, mode: "hold" | "death" | "limp"): [number, number, number] {
  if (mode === "limp") return [0.62, 0.64, 0.7];
  const s = Math.max(0, Math.min(1, strength));
  return [1 - s * 0.8, 0.25 + s * 0.75, 0.2];
}

export interface RagdollLineInfo {
  mode: "hold" | "death" | "limp";
  strength: number;
  /** Worst motor error (rad). */
  maxError: number;
  /** Pelvis speed (m/s). */
  speed: number;
  sleeping: boolean;
}

const MODE_LABEL: Record<RagdollLineInfo["mode"], string> = { hold: "sujeto", death: "muriendo", limp: "inerte" };

/** One panel line (player-facing debug text, neutral Spanish). */
export function formatRagdollLine(index: number, r: RagdollLineInfo): string {
  const err = ((r.maxError * 180) / Math.PI).toFixed(1);
  return `#${index} ${MODE_LABEL[r.mode].padEnd(8)} fuerza ${r.strength.toFixed(2)} · error máx ${err}° · pelvis ${r.speed.toFixed(1)} m/s${r.sleeping ? " · dormido" : ""}`;
}

// ---- Overlay ----

/** Growable xyz + rgb vertex buffer drawn as LineSegments or Points. */
class DynamicBuffer {
  readonly geometry = new THREE.BufferGeometry();
  private pos: Float32Array;
  private col: Float32Array;
  count = 0;

  constructor(private capacity: number) {
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.attach();
  }

  private attach(): void {
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
  }

  private grow(): void {
    this.capacity *= 2;
    const pos = new Float32Array(this.capacity * 3);
    const col = new Float32Array(this.capacity * 3);
    pos.set(this.pos);
    col.set(this.col);
    this.pos = pos;
    this.col = col;
    this.geometry.dispose();
    this.attach();
  }

  push(x: number, y: number, z: number, c: readonly number[]): void {
    if (this.count >= this.capacity) this.grow();
    const i = this.count * 3;
    this.pos[i] = x;
    this.pos[i + 1] = y;
    this.pos[i + 2] = z;
    this.col[i] = c[0];
    this.col[i + 1] = c[1];
    this.col[i + 2] = c[2];
    this.count++;
  }

  commit(): void {
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.setDrawRange(0, this.count);
  }
}

const JOINT_COLOR = [1, 1, 1];
const VELOCITY_COLOR = [1, 0.85, 0.2];
const COM_COLOR = [1, 0.3, 1];
const CONTACT_COLOR = [1, 0.55, 0.1];

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _com = new THREE.Vector3();

interface Built {
  group: THREE.Group;
  lines: DynamicBuffer;
  points: DynamicBuffer;
  materials: THREE.Material[];
  panel: HTMLDivElement;
}

export class RagdollDebugOverlay {
  private visible = false;
  private built: Built | null = null;
  /** Local-space wireframe per collider handle (shapes never change after creation). */
  private readonly shapes = new Map<number, Float32Array>();
  private readonly anchors: THREE.Vector3[] = [];
  private textT = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly ragdolls: () => readonly Ragdoll[],
    private readonly physics: () => PhysicsWorld | null,
  ) {}

  isVisible(): boolean {
    return this.visible;
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    if (v) {
      const b = this.build();
      this.scene.add(b.group);
      b.panel.style.display = "block";
      this.textT = 0;
    } else if (this.built) {
      this.built.group.removeFromParent();
      this.built.panel.style.display = "none";
    }
  }

  /** Per frame, after the ragdolls were synced. No-op while hidden. */
  update(dt: number): void {
    if (!this.visible || !this.built) return;
    const { lines, points, panel } = this.built;
    const pw = this.physics();
    const list = this.ragdolls();
    lines.count = 0;
    points.count = 0;
    const live = new Set<number>();
    for (const rd of list) {
      const color = strengthColor(rd.strength, rd.muscleMode);
      // Collider wireframes.
      for (const c of rd.colliders()) {
        live.add(c.handle);
        let seg = this.shapes.get(c.handle);
        if (!seg) {
          seg = this.shapeOf(c);
          this.shapes.set(c.handle, seg);
        }
        const t = c.translation();
        const r = c.rotation();
        _q.set(r.x, r.y, r.z, r.w);
        for (let i = 0; i < seg.length; i += 3) {
          _v.set(seg[i], seg[i + 1], seg[i + 2]).applyQuaternion(_q);
          lines.push(_v.x + t.x, _v.y + t.y, _v.z + t.z, color);
        }
        if (pw) this.contacts(pw, c, points);
      }
      // Joint anchors.
      const n = rd.jointAnchors(this.anchors);
      for (let i = 0; i < n; i++) points.push(this.anchors[i].x, this.anchors[i].y, this.anchors[i].z, JOINT_COLOR);
      // Pelvis velocity.
      const pelvis = rd.bodies[0];
      if (pelvis) {
        const p = pelvis.translation();
        const v = pelvis.linvel();
        lines.push(p.x, p.y, p.z, VELOCITY_COLOR);
        lines.push(p.x + v.x * VELOCITY_SCALE, p.y + v.y * VELOCITY_SCALE, p.z + v.z * VELOCITY_SCALE, VELOCITY_COLOR);
      }
      // Centre of mass and its projection on the ground below.
      rd.centerOfMass(_com);
      points.push(_com.x, _com.y, _com.z, COM_COLOR);
      const drop = pw?.castStaticRay(_com, { x: 0, y: -1, z: 0 }, GROUND_RAY) ?? null;
      if (drop !== null) {
        const gy = _com.y - drop;
        lines.push(_com.x, _com.y, _com.z, COM_COLOR);
        lines.push(_com.x, gy, _com.z, COM_COLOR);
        const s = 0.12;
        lines.push(_com.x - s, gy + 0.01, _com.z, COM_COLOR);
        lines.push(_com.x + s, gy + 0.01, _com.z, COM_COLOR);
        lines.push(_com.x, gy + 0.01, _com.z - s, COM_COLOR);
        lines.push(_com.x, gy + 0.01, _com.z + s, COM_COLOR);
      }
    }
    // Forget wireframes of removed colliders (handles get reused by Rapier).
    if (this.shapes.size > live.size) for (const h of this.shapes.keys()) if (!live.has(h)) this.shapes.delete(h);
    lines.commit();
    points.commit();

    this.textT -= dt;
    if (this.textT <= 0) {
      this.textT = TEXT_EVERY;
      const rows = list.map((rd, i) => {
        const v = rd.bodies[0]?.linvel();
        return formatRagdollLine(i + 1, {
          mode: rd.muscleMode,
          strength: rd.strength,
          maxError: rd.maxMotorError(),
          speed: v ? Math.hypot(v.x, v.y, v.z) : 0,
          sleeping: rd.isSleeping(),
        });
      });
      panel.textContent = `Ragdolls (F4) · ${list.length} activos\n` + (rows.length ? rows.join("\n") : "—");
    }
  }

  private shapeOf(c: ReturnType<Ragdoll["colliders"]>[number]): Float32Array {
    // Rapier ShapeType: Ball = 0, Cuboid = 1, Capsule = 2.
    switch (c.shapeType() as number) {
      case 0:
        return sphereSegments(c.radius());
      case 1: {
        const h = c.halfExtents();
        return h ? boxSegments(h.x, h.y, h.z) : new Float32Array(0);
      }
      case 2:
        return capsuleSegments(c.halfHeight(), c.radius());
      default:
        return new Float32Array(0);
    }
  }

  /** Contact points between collider `c` and the static world (terrain, buildings). */
  private contacts(pw: PhysicsWorld, c: ReturnType<Ragdoll["colliders"]>[number], out: DynamicBuffer): void {
    pw.world.contactPairsWith(c, (other) => {
      const parent = other.parent();
      if (parent && !parent.isFixed()) return;
      pw.world.contactPair(c, other, (manifold) => {
        for (let i = 0; i < manifold.numSolverContacts(); i++) {
          const p = manifold.solverContactPoint(i);
          if (p) out.push(p.x, p.y, p.z, CONTACT_COLOR);
        }
      });
    });
  }

  private build(): Built {
    if (this.built) return this.built;
    const group = new THREE.Group();
    group.name = "ragdollDebug";
    const lines = new DynamicBuffer(LINE_CAPACITY);
    const points = new DynamicBuffer(POINT_CAPACITY);
    const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.9 });
    const pointMat = new THREE.PointsMaterial({ vertexColors: true, size: 6, sizeAttenuation: false, depthTest: false, transparent: true });
    const lineObj = new THREE.LineSegments(lines.geometry, lineMat);
    const pointObj = new THREE.Points(points.geometry, pointMat);
    for (const o of [lineObj, pointObj]) {
      o.frustumCulled = false;
      o.renderOrder = 999;
      group.add(o);
    }
    const panel = document.createElement("div");
    panel.id = "ragdollDebugPanel";
    panel.setAttribute("aria-hidden", "true");
    Object.assign(panel.style, {
      position: "fixed",
      top: "200px",
      left: "14px",
      zIndex: "15",
      padding: "8px 10px",
      borderRadius: "8px",
      background: "rgba(0, 0, 0, 0.6)",
      border: "1px solid rgba(255, 255, 255, 0.15)",
      color: "#e8ecf2",
      font: "12px/1.45 ui-monospace, Consolas, monospace",
      whiteSpace: "pre",
      pointerEvents: "none",
      display: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(panel);
    this.built = { group, lines, points, materials: [lineMat, pointMat], panel };
    return this.built;
  }

  dispose(): void {
    const b = this.built;
    if (!b) return;
    b.group.removeFromParent();
    b.lines.geometry.dispose();
    b.points.geometry.dispose();
    for (const m of b.materials) m.dispose();
    b.panel.remove();
    this.built = null;
    this.shapes.clear();
    this.visible = false;
  }
}
