// Pure pedestrian network from the map's undirected foot graph: footways,
// pedestrian streets, steps and the generated sidewalks along streets
// (edges with offset > 0 stand for BOTH sidewalks, at ±offset). Only the
// largest connected component is kept so walkers never get stranded on an
// island. peds.ts moves the pedestrians along these paths.

import type { FootEdge, MapGraph, MapRoad } from "../map/types";
import { offsetPolyline } from "../world/campus/ribbon";
import { edgePolyline, makeLanePath, sampleLane, type LanePath } from "../vehicles/roadNetwork";

export interface FootSource {
  roads: readonly MapRoad[];
  graph: MapGraph;
}

export class FootNetwork {
  /** Indices (into graph.footEdges) of the edges in the largest component. */
  readonly edges: number[];
  readonly footEdges: readonly FootEdge[];
  private readonly roads: readonly MapRoad[];
  private readonly adj = new Map<number, number[]>();
  private readonly inNet = new Set<number>();
  private readonly cache = new Map<string, LanePath>();

  constructor(src: FootSource) {
    this.roads = src.roads;
    this.footEdges = src.graph.footEdges;
    const all = new Map<number, number[]>();
    this.footEdges.forEach((e, i) => {
      for (const n of [e.from, e.to]) {
        let a = all.get(n);
        if (!a) all.set(n, (a = []));
        a.push(i);
      }
    });
    // Largest component by edge count (BFS over nodes).
    const seen = new Set<number>();
    let best: { nodes: Set<number>; edges: Set<number> } = { nodes: new Set(), edges: new Set() };
    for (const start of all.keys()) {
      if (seen.has(start)) continue;
      const nodes = new Set<number>([start]);
      const edges = new Set<number>();
      const queue = [start];
      seen.add(start);
      while (queue.length) {
        const n = queue.pop()!;
        for (const ei of all.get(n) ?? []) {
          edges.add(ei);
          const e = this.footEdges[ei];
          const m = e.from === n ? e.to : e.from;
          if (!seen.has(m)) {
            seen.add(m);
            nodes.add(m);
            queue.push(m);
          }
        }
      }
      if (edges.size > best.edges.size) best = { nodes, edges };
    }
    this.edges = [...best.edges].sort((a, b) => a - b);
    for (const n of best.nodes) {
      this.inNet.add(n);
      this.adj.set(n, all.get(n) ?? []);
    }
  }

  nodeInNetwork(n: number): boolean {
    return this.inNet.has(n);
  }

  /** Node reached at the end of walking edge `e` forwards (from -> to) or backwards. */
  endNode(e: number, forward: boolean): number {
    const edge = this.footEdges[e];
    return forward ? edge.to : edge.from;
  }

  startNode(e: number, forward: boolean): number {
    return this.endNode(e, !forward);
  }

  edgesAt(node: number): readonly number[] {
    return this.adj.get(node) ?? [];
  }

  /**
   * Walking line of edge `e`. `side` (±1) picks the sidewalk relative to the
   * edge's own from -> to direction (+1 = its right-hand side) so a walker
   * keeps the same physical sidewalk whichever way it walks.
   */
  edgePath(e: number, forward: boolean, side: 1 | -1): LanePath {
    const edge = this.footEdges[e];
    const s = edge.offset > 0 ? side : 1;
    const key = `${e}:${forward ? 1 : 0}:${s}`;
    let p = this.cache.get(key);
    if (!p) {
      let pts = edgePolyline(this.roads[edge.road], edge);
      if (edge.offset > 0) pts = offsetPolyline(pts, edge.offset * s);
      if (!forward) pts = [...pts].reverse();
      p = makeLanePath(pts);
      this.cache.set(key, p);
    }
    return p;
  }

  /** Next edge to walk from `node`, arriving along `from`: anything but going back, unless it is a dead end. */
  pickNext(node: number, from: number, rnd: () => number): number {
    const opts = this.edgesAt(node).filter((e) => e !== from);
    if (opts.length === 0) return from;
    return opts[Math.floor(rnd() * opts.length) % opts.length];
  }
}

// ---------------------------------------------------------------------------
// Walker: one pedestrian's position on the foot network. At the end of an
// edge it walks a short straight link to the start of the next edge's path
// (sidewalk lines don't meet exactly at the junction node).

export interface Walker {
  edge: number;
  forward: boolean;
  side: 1 | -1;
  path: LanePath;
  s: number;
  /** Short straight link to the next edge (null while on an edge). */
  link: LanePath | null;
  nextEdge: number;
  nextForward: boolean;
  nextSide: 1 | -1;
}

function planNext(w: Walker, net: FootNetwork, rnd: () => number): void {
  const node = net.endNode(w.edge, w.forward);
  const next = net.pickNext(node, w.edge, rnd);
  const e = net.footEdges[next];
  w.nextEdge = next;
  w.nextForward = e.from === node;
  // Same street: keep the sidewalk; otherwise pick one at random.
  const sameRoad = e.road === net.footEdges[w.edge].road;
  w.nextSide = sameRoad ? w.side : rnd() < 0.5 ? 1 : -1;
}

export function createWalker(net: FootNetwork, edge: number, forward: boolean, side: 1 | -1, s: number, rnd: () => number = Math.random): Walker {
  const w: Walker = { edge, forward, side, path: net.edgePath(edge, forward, side), s, link: null, nextEdge: edge, nextForward: forward, nextSide: side };
  planNext(w, net, rnd);
  return w;
}

/** Walks `dist` metres on, switching edges at nodes. */
export function stepWalker(w: Walker, net: FootNetwork, dist: number, rnd: () => number): void {
  w.s += dist;
  let guard = 0;
  while (guard++ < 16) {
    const cur = w.link ?? w.path;
    if (w.s < cur.length) return;
    const left = w.s - cur.length;
    if (!w.link) {
      const end = w.path.pts[w.path.pts.length - 1];
      const nextPath = net.edgePath(w.nextEdge, w.nextForward, w.nextSide);
      w.link = makeLanePath([end, nextPath.pts[0]]);
    } else {
      w.edge = w.nextEdge;
      w.forward = w.nextForward;
      w.side = w.nextSide;
      w.path = net.edgePath(w.edge, w.forward, w.side);
      w.link = null;
      planNext(w, net, rnd);
    }
    w.s = left;
  }
}

export function walkerPosition(w: Walker, out: { x: number; z: number; yaw: number }): { x: number; z: number; yaw: number } {
  return sampleLane(w.link ?? w.path, w.s, out);
}
