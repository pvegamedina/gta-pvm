// Pure traffic network built from the map's directed road graph: lane paths
// (each edge's polyline shifted to the right-hand lane and trimmed short of
// junctions), junction connectors (cubic Bézier curves between lanes),
// random routing without U-turns, and traffic-light phases for the mapped
// signalled junctions. No THREE; traffic.ts drives the cars along it.

import type { GraphEdge, MapGraph, MapRoad, MapTrafficLight, Vec2 } from "../map/types";
import { cumulativeLengths, offsetPolyline, trimPolyline } from "../world/campus/ribbon";

export interface NetworkSource {
  roads: readonly MapRoad[];
  graph: MapGraph;
  trafficLights: readonly MapTrafficLight[];
}

/** A drivable polyline with its cumulative arc lengths. */
export interface LanePath {
  pts: Vec2[];
  cum: number[];
  length: number;
}

export type SignalColor = "G" | "Y" | "R";

// ---------------------------------------------------------------------------
// Signal timing: group 0 green, yellow, all-red, then group 1 the same.

export const SIGNAL_GREEN = 16;
export const SIGNAL_YELLOW = 3;
export const SIGNAL_ALL_RED = 2;
export const SIGNAL_CYCLE = 2 * (SIGNAL_GREEN + SIGNAL_YELLOW + SIGNAL_ALL_RED);

/** Light shown to approach `group` of a junction whose cycle is shifted by `offset` seconds. */
export function signalState(offset: number, group: 0 | 1, t: number): SignalColor {
  const half = SIGNAL_CYCLE / 2;
  let local = (t + offset) % SIGNAL_CYCLE;
  if (local < 0) local += SIGNAL_CYCLE;
  if (group === 1) local = (local + half) % SIGNAL_CYCLE;
  if (local < SIGNAL_GREEN) return "G";
  if (local < SIGNAL_GREEN + SIGNAL_YELLOW) return "Y";
  return "R";
}

export function makeLanePath(pts: Vec2[]): LanePath {
  const cum = cumulativeLengths(pts);
  return { pts, cum, length: cum[cum.length - 1] };
}

/** Position and heading (game yaw) at arc length `s` along a lane path. */
export function sampleLane(p: LanePath, s: number, out: { x: number; z: number; yaw: number }): { x: number; z: number; yaw: number } {
  const { pts, cum } = p;
  if (pts.length < 2) {
    out.x = pts[0][0];
    out.z = pts[0][1];
    return out;
  }
  const cs = Math.min(Math.max(s, 0), p.length);
  let i = 1;
  while (i < cum.length - 1 && cum[i] < cs) i++;
  const seg = cum[i] - cum[i - 1];
  const t = seg > 1e-9 ? (cs - cum[i - 1]) / seg : 0;
  const dx = pts[i][0] - pts[i - 1][0];
  const dz = pts[i][1] - pts[i - 1][1];
  out.x = pts[i - 1][0] + dx * t;
  out.z = pts[i - 1][1] + dz * t;
  if (seg > 1e-9) out.yaw = Math.atan2(dx, dz);
  return out;
}

/** Game yaw of the path direction at arc length `s` (looking slightly ahead). */
export function headingAt(p: LanePath, s: number): number {
  const a = { x: 0, z: 0, yaw: 0 };
  sampleLane(p, s, a);
  return a.yaw;
}

/** Wrapped angle difference b - a in (-PI, PI]. */
function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Turns sharper than this are only taken when nothing else is possible. */
const MAX_TURN = 2.6;

export class RoadNetwork {
  readonly edges: readonly GraphEdge[];
  readonly roads: readonly MapRoad[];
  private readonly out: number[][];
  private readonly polylines: Vec2[][];
  private readonly startTrim: number[];
  private readonly endTrim: number[];
  private readonly junctionOfNode = new Map<number, number>();
  /** Per junction: reference bearing used to split approaches into two phase groups. */
  private junctionRef: number[];
  private readonly laneCache = new Map<number, LanePath>();
  readonly junctions: readonly MapTrafficLight[];

  constructor(src: NetworkSource) {
    this.roads = src.roads;
    this.edges = src.graph.roadEdges;
    this.junctions = src.trafficLights;
    const nodeCount = src.graph.nodes.length;
    this.out = Array.from({ length: nodeCount }, () => []);
    this.polylines = this.edges.map((e) => edgePolyline(src.roads[e.road], e));
    this.edges.forEach((e, i) => this.out[e.from].push(i));

    // Junction radius per node: distinct undirected spans ("arms") and the widest road there.
    const arms = new Map<number, Set<string>>();
    const widest = new Map<number, number>();
    for (const e of this.edges) {
      const key = `${e.road}:${Math.min(e.i0, e.i1)}:${Math.max(e.i0, e.i1)}`;
      const w = src.roads[e.road].width;
      for (const n of [e.from, e.to]) {
        let s = arms.get(n);
        if (!s) arms.set(n, (s = new Set()));
        s.add(key);
        widest.set(n, Math.max(widest.get(n) ?? 0, w));
      }
    }
    const radius = (n: number) => ((arms.get(n)?.size ?? 0) >= 3 ? (widest.get(n) ?? 6) / 2 + 1 : 1.5);
    // Lane paths stop short of junctions (connectors take over inside them).
    this.startTrim = this.edges.map((e, i) => Math.min(radius(e.from), this.lengthOf(i) * 0.4));
    this.endTrim = this.edges.map((e, i) => Math.min(radius(e.to), this.lengthOf(i) * 0.4));

    src.trafficLights.forEach((j, ji) => {
      for (const n of j.nodes) this.junctionOfNode.set(n, ji);
    });
    // Reference bearing per junction: the first approach found (others are grouped against it).
    this.junctionRef = src.trafficLights.map(() => NaN);
    for (let i = 0; i < this.edges.length; i++) {
      const j = this.stopJunction(i);
      if (j >= 0 && Number.isNaN(this.junctionRef[j])) this.junctionRef[j] = this.endBearing(i);
    }
    this.junctionRef = this.junctionRef.map((b) => (Number.isNaN(b) ? 0 : b));
  }

  private lengthOf(e: number): number {
    return cumulativeLengths(this.polylines[e]).at(-1) ?? 0;
  }

  /** Number of lanes in the edge's travel direction. */
  lanesOf(e: number): number {
    const r = this.roads[this.edges[e].road];
    return r.oneway ? Math.max(1, r.lanes) : Math.max(1, Math.floor(r.lanes / 2));
  }

  /** Lateral offset (m, + = right of travel) of lane `lane` (0 = leftmost / nearest the centreline). */
  laneOffset(e: number, lane: number): number {
    const r = this.roads[this.edges[e].road];
    const n = this.lanesOf(e);
    const k = Math.min(Math.max(lane, 0), n - 1);
    if (r.oneway) {
      const lw = r.width / n;
      return -r.width / 2 + lw * (k + 0.5);
    }
    const lw = r.width / 2 / n;
    return lw * (k + 0.5);
  }

  /** The edge's lane, offset to the right and trimmed short of the junctions at both ends (cached). */
  lanePath(e: number, lane: number): LanePath {
    const k = Math.min(Math.max(lane, 0), this.lanesOf(e) - 1);
    const key = e * 8 + k;
    let p = this.laneCache.get(key);
    if (!p) {
      const shifted = offsetPolyline(this.polylines[e], this.laneOffset(e, k));
      p = makeLanePath(trimPolyline(shifted, this.startTrim[e], this.endTrim[e]));
      this.laneCache.set(key, p);
    }
    return p;
  }

  /** Untrimmed centreline of the edge in travel direction. */
  centreline(e: number): readonly Vec2[] {
    return this.polylines[e];
  }

  outgoing(node: number): readonly number[] {
    return this.out[node] ?? [];
  }

  /** Bearing (game yaw) of the edge's last / first segment. */
  endBearing(e: number): number {
    const p = this.polylines[e];
    const a = p[p.length - 2];
    const b = p[p.length - 1];
    return Math.atan2(b[0] - a[0], b[1] - a[1]);
  }

  startBearing(e: number): number {
    const p = this.polylines[e];
    return Math.atan2(p[1][0] - p[0][0], p[1][1] - p[0][1]);
  }

  private isUTurn(e: number, c: number): boolean {
    const a = this.edges[e];
    const b = this.edges[c];
    return b.to === a.from && b.road === a.road;
  }

  /**
   * Next edge after `e`, chosen at random among the exits of its end node:
   * no U-turns (unless it is the only way on), going straight weighted more
   * than turning. -1 when the road just ends (one-way dead end).
   */
  pickNext(e: number, rnd: () => number): number {
    const outs = this.outgoing(this.edges[e].to);
    if (outs.length === 0) return -1;
    const inB = this.endBearing(e);
    const cands: number[] = [];
    const weights: number[] = [];
    for (const c of outs) {
      if (this.isUTurn(e, c)) continue;
      const turn = Math.abs(angleDiff(inB, this.startBearing(c)));
      if (turn > MAX_TURN) continue;
      cands.push(c);
      weights.push(0.6 + 2.4 * Math.max(0, Math.cos(turn)) ** 2);
    }
    if (cands.length === 0) {
      // Dead end: turn around (prefer the same road back).
      const back = outs.find((c) => this.isUTurn(e, c));
      return back ?? outs[Math.floor(rnd() * outs.length)];
    }
    let total = 0;
    for (const w of weights) total += w;
    let r = rnd() * total;
    for (let i = 0; i < cands.length; i++) {
      r -= weights[i];
      if (r <= 0) return cands[i];
    }
    return cands[cands.length - 1];
  }

  /** Smooth path from the end of lane (a, laneA) to the start of lane (b, laneB). */
  connector(a: number, laneA: number, b: number, laneB: number): LanePath {
    const pa = this.lanePath(a, laneA);
    const pb = this.lanePath(b, laneB);
    const p0 = pa.pts[pa.pts.length - 1];
    const p3 = pb.pts[0];
    const dist = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
    if (dist < 0.05) return makeLanePath([p0, p3]);
    const ya = this.endBearing(a);
    const yb = this.startBearing(b);
    const k = dist * 0.45;
    const p1: Vec2 = [p0[0] + Math.sin(ya) * k, p0[1] + Math.cos(ya) * k];
    const p2: Vec2 = [p3[0] - Math.sin(yb) * k, p3[1] - Math.cos(yb) * k];
    const n = 8;
    const pts: Vec2[] = [p0];
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const u = 1 - t;
      const w0 = u * u * u;
      const w1 = 3 * u * u * t;
      const w2 = 3 * u * t * t;
      const w3 = t * t * t;
      pts.push([w0 * p0[0] + w1 * p1[0] + w2 * p2[0] + w3 * p3[0], w0 * p0[1] + w1 * p1[1] + w2 * p2[1] + w3 * p3[1]]);
    }
    pts.push(p3);
    return makeLanePath(pts);
  }

  junctionOf(node: number): number {
    return this.junctionOfNode.get(node) ?? -1;
  }

  /** Signalled junction the edge enters from outside (cars stop before it), or -1. */
  stopJunction(e: number): number {
    const edge = this.edges[e];
    const j = this.junctionOf(edge.to);
    if (j < 0) return -1;
    return this.junctionOf(edge.from) === j ? -1 : j;
  }

  /** Signal phase group (0/1) of an approach: roughly perpendicular approaches alternate. */
  approachGroup(e: number): 0 | 1 {
    const j = this.stopJunction(e);
    if (j < 0) return 0;
    let d = Math.abs(angleDiff(this.junctionRef[j], this.endBearing(e))) % Math.PI;
    if (d > Math.PI / 2) d = Math.PI - d;
    return d < Math.PI / 4 ? 0 : 1;
  }

  /** Deterministic cycle offset (s) of a junction so neighbouring lights don't switch in sync. */
  junctionOffset(j: number): number {
    const h = Math.sin((j + 1) * 12.9898) * 43758.5453;
    return (h - Math.floor(h)) * SIGNAL_CYCLE;
  }
}

/** Points of `road` from i0 to i1 (walked backwards when i1 < i0). */
export function edgePolyline(road: MapRoad, e: { i0: number; i1: number }): Vec2[] {
  const pts: Vec2[] = [];
  const step = e.i1 >= e.i0 ? 1 : -1;
  for (let i = e.i0; ; i += step) {
    pts.push(road.points[i]);
    if (i === e.i1) break;
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Driver: one car's position on the network. It alternates between an edge's
// lane path and the connector that links it to the next (pre-chosen) edge, so
// it always knows a little of what is ahead (turns, the next stop line).

export interface Driver {
  edge: number;
  lane: number;
  /** Edge after the current one (-1 = the road ends here). */
  nextEdge: number;
  nextLane: number;
  /** True while on the junction connector between `edge` and `nextEdge`. */
  onLink: boolean;
  path: LanePath;
  s: number;
}

function chooseLane(net: RoadNetwork, e: number, lane: number, rnd: () => number): number {
  const n = net.lanesOf(e);
  let k = Math.min(lane, n - 1);
  // Occasionally drift to another lane on multi-lane roads.
  if (n > 1 && rnd() < 0.2) k = Math.floor(rnd() * n) % n;
  return k;
}

export function createDriver(net: RoadNetwork, edge: number, lane: number, s: number, rnd: () => number): Driver {
  const k = Math.min(Math.max(lane, 0), net.lanesOf(edge) - 1);
  const nextEdge = net.pickNext(edge, rnd);
  return {
    edge,
    lane: k,
    nextEdge,
    nextLane: nextEdge >= 0 ? chooseLane(net, nextEdge, k, rnd) : 0,
    onLink: false,
    path: net.lanePath(edge, k),
    s,
  };
}

/** Moves the driver `dist` metres on; false when it ran off the end of a dead-end road. */
export function advanceDriver(d: Driver, net: RoadNetwork, dist: number, rnd: () => number): boolean {
  d.s += dist;
  let guard = 0;
  while (d.s >= d.path.length && guard++ < 16) {
    const left = d.s - d.path.length;
    if (!d.onLink) {
      if (d.nextEdge < 0) {
        d.s = d.path.length;
        return false;
      }
      d.path = net.connector(d.edge, d.lane, d.nextEdge, d.nextLane);
      d.onLink = true;
    } else {
      d.edge = d.nextEdge;
      d.lane = d.nextLane;
      d.path = net.lanePath(d.edge, d.lane);
      d.onLink = false;
      d.nextEdge = net.pickNext(d.edge, rnd);
      d.nextLane = d.nextEdge >= 0 ? chooseLane(net, d.nextEdge, d.lane, rnd) : 0;
    }
    d.s = left;
  }
  return true;
}

export function driverPosition(d: Driver, out: { x: number; z: number; yaw: number }): { x: number; z: number; yaw: number } {
  return sampleLane(d.path, d.s, out);
}

/** Metres to the stop line of the signalled junction this lane enters (Infinity when none / on the connector). */
export function distanceToStop(d: Driver, net: RoadNetwork): number {
  if (d.onLink || net.stopJunction(d.edge) < 0) return Infinity;
  return d.path.length - d.s;
}

/** The path `ahead` metres on (entering the connector / next lane when needed) and the arc length on it. */
function pathAhead(d: Driver, net: RoadNetwork, ahead: number): { path: LanePath; s: number } {
  let s = d.s + ahead;
  if (s <= d.path.length) return { path: d.path, s };
  if (d.nextEdge < 0) return { path: d.path, s: d.path.length };
  s -= d.path.length;
  if (!d.onLink) {
    const link = net.connector(d.edge, d.lane, d.nextEdge, d.nextLane);
    if (s <= link.length) return { path: link, s };
    s -= link.length;
  }
  const next = net.lanePath(d.nextEdge, d.nextLane);
  return { path: next, s: Math.min(s, next.length) };
}

/** Absolute heading change (rad) between here and `ahead` metres on: how sharp the coming bend is. */
export function turnAhead(d: Driver, net: RoadNetwork, ahead: number): number {
  const here = headingAt(d.path, d.s);
  let worst = 0;
  for (const f of [0.5, 1]) {
    const p = pathAhead(d, net, ahead * f);
    worst = Math.max(worst, Math.abs(angleDiff(here, headingAt(p.path, Math.max(0, p.s - 0.01)))));
  }
  return worst;
}
