// OSM highways → MapRoad polylines, the directed car graph, the pedestrian
// graph and traffic-light junctions.

import { polylineRangeLength } from "../../src/game/map/geometry";
import type {
  FootEdge,
  GraphEdge,
  MapGraph,
  MapRoad,
  MapTrafficLight,
  RoadClass,
  Vec2,
} from "../../src/game/map/types";
import { clipPolyline, type KeyedPoint } from "./clip";
import { type BuildContext, q } from "./context";
import { parseNumberTag, type Tags } from "./osm";
import { project } from "../../src/game/map/projection";

/** Carriageway width (m) per class. */
export const ROAD_WIDTHS: Record<RoadClass, number> = {
  motorway: 11,
  motorway_link: 6,
  trunk: 10,
  trunk_link: 6,
  primary: 10,
  primary_link: 6,
  secondary: 9,
  secondary_link: 6,
  tertiary: 8,
  tertiary_link: 6,
  residential: 6.5,
  unclassified: 6,
  living_street: 5,
  service: 4.5,
  pedestrian: 5,
  footway: 2.2,
  path: 1.8,
  cycleway: 2.5,
  steps: 2,
  track: 3,
};

/** Default total lanes for drivable classes. */
const DEFAULT_LANES: Partial<Record<RoadClass, number>> = {
  motorway: 2,
  motorway_link: 1,
  trunk: 2,
  trunk_link: 1,
  primary: 2,
  primary_link: 1,
  secondary: 2,
  secondary_link: 1,
  tertiary: 2,
  tertiary_link: 1,
  residential: 2,
  unclassified: 2,
  living_street: 1,
  service: 1,
};

const DRIVABLE = new Set<RoadClass>(Object.keys(DEFAULT_LANES) as RoadClass[]);
const FOOT_CLASSES = new Set<RoadClass>(["pedestrian", "footway", "path", "steps", "cycleway", "track"]);
/** Classes that get a generated sidewalk on both sides. */
const SIDEWALK_CLASSES = new Set<RoadClass>([
  "primary",
  "primary_link",
  "secondary",
  "secondary_link",
  "tertiary",
  "tertiary_link",
  "residential",
  "unclassified",
  "living_street",
]);
/** Main roads whose junctions get traffic lights. */
const MAIN_CLASSES = new Set<RoadClass>([
  "trunk",
  "primary",
  "primary_link",
  "secondary",
  "secondary_link",
  "tertiary",
  "tertiary_link",
]);
const IMPLIED_ONEWAY = new Set<RoadClass>(["motorway", "motorway_link"]);

/** Kerb-to-walking-line distance added to half the carriageway. */
const SIDEWALK_MARGIN = 1.5;
/** Service roads have no sidewalk: pedestrians walk along the edge. */
const SERVICE_EDGE_MARGIN = 0.8;

export interface RoadAttributes {
  class: RoadClass;
  width: number;
  lanes: number;
  oneway: boolean;
  /** OSM `oneway=-1`: the geometry must be reversed so travel follows point order. */
  reverse: boolean;
  surface: string;
  drivable: boolean;
  walkable: boolean;
  sidewalkOffset: number;
  roundabout: boolean;
}

/** Derives road properties from OSM tags; null for non-road ways. */
export function roadAttributes(tags: Tags): RoadAttributes | null {
  const cls = tags.highway as RoadClass | undefined;
  if (!cls || !(cls in ROAD_WIDTHS)) return null;
  const drivable = DRIVABLE.has(cls);

  const tagWidth = parseNumberTag(tags.width);
  const width = tagWidth !== undefined && tagWidth >= 0.5 && tagWidth <= 40 ? tagWidth : ROAD_WIDTHS[cls];

  const tagLanes = parseNumberTag(tags.lanes);
  const lanes = !drivable
    ? 0
    : tagLanes !== undefined && tagLanes >= 1 && tagLanes <= 10
      ? Math.round(tagLanes)
      : (DEFAULT_LANES[cls] ?? 1);

  const roundabout = tags.junction === "roundabout" || tags.junction === "circular";
  const ow = tags.oneway;
  let oneway = false;
  let reverse = false;
  if (drivable) {
    if (ow === "yes" || ow === "true" || ow === "1") oneway = true;
    else if (ow === "-1" || ow === "reverse") oneway = reverse = true;
    else if (ow !== "no" && (IMPLIED_ONEWAY.has(cls) || roundabout)) oneway = true;
  }

  const surface =
    tags.surface ??
    (drivable || cls === "cycleway" ? "asphalt" : cls === "path" || cls === "track" ? "compacted" : "paving_stones");

  let sidewalkOffset = 0;
  if (tags.sidewalk !== "no" && tags.sidewalk !== "none") {
    if (SIDEWALK_CLASSES.has(cls)) sidewalkOffset = width / 2 + SIDEWALK_MARGIN;
    else if (cls === "service") sidewalkOffset = width / 2 + SERVICE_EDGE_MARGIN;
  }
  sidewalkOffset = Math.round(sidewalkOffset * 100) / 100;

  return {
    class: cls,
    width,
    lanes,
    oneway,
    reverse,
    surface,
    drivable,
    walkable: FOOT_CLASSES.has(cls) || sidewalkOffset > 0,
    sidewalkOffset,
    roundabout,
  };
}

/** A road plus the graph keys (OSM node ids) of its points. */
export interface RoadPiece {
  road: MapRoad;
  keys: string[];
  drivable: boolean;
  walkable: boolean;
  roundabout: boolean;
}

/** Builds a road piece from tags and keyed (projected) points; null for non-roads. */
export function makeRoadPiece(id: string, tags: Tags, points: KeyedPoint[]): RoadPiece | null {
  const a = roadAttributes(tags);
  if (!a || points.length < 2) return null;
  const pts = a.reverse ? [...points].reverse() : points;
  const layer = parseNumberTag(tags.layer);
  const road: MapRoad = {
    id,
    class: a.class,
    ...(tags.name ? { name: tags.name } : {}),
    ...(tags.ref ? { ref: tags.ref } : {}),
    width: a.width,
    lanes: a.lanes,
    oneway: a.oneway,
    surface: a.surface,
    ...(tags.bridge && tags.bridge !== "no" ? { bridge: true } : {}),
    ...(tags.tunnel && tags.tunnel !== "no" ? { tunnel: true } : {}),
    ...(layer !== undefined && layer !== 0 ? { layer: Math.round(layer) } : {}),
    ...(tags.footway ? { footway: tags.footway } : {}),
    sidewalkOffset: a.sidewalkOffset,
    points: pts.map((p): Vec2 => [q(p.x), q(p.z)]),
  };
  return { road, keys: pts.map((p) => p.key), drivable: a.drivable, walkable: a.walkable, roundabout: a.roundabout };
}

/** All highway ways clipped to the bounds, in OSM id order. */
export function extractRoads(ctx: BuildContext): RoadPiece[] {
  const pieces: RoadPiece[] = [];
  for (const way of ctx.osm.ways) {
    const tags = way.tags;
    if (!tags?.highway || !roadAttributes(tags)) continue;
    const keyed: KeyedPoint[] = [];
    for (const id of way.nodes) {
      const n = ctx.osm.nodes.get(id);
      if (!n) continue;
      const [x, z] = project(ctx.projection, n.lat, n.lon);
      keyed.push({ x, z, key: String(id) });
    }
    clipPolyline(keyed, ctx.bounds).forEach((run, k) => {
      const piece = makeRoadPiece(k === 0 ? `w${way.id}` : `w${way.id}#${k}`, tags, run);
      if (piece) pieces.push(piece);
    });
  }
  return pieces;
}

/**
 * Graph nodes are way ends and OSM nodes shared by two or more road
 * occurrences. Every road is split at its nodes; drivable pieces produce
 * directed car edges (both ways unless one-way), walkable pieces produce
 * undirected foot edges (offset = sidewalk distance, 0 for footways).
 */
export function buildGraph(pieces: RoadPiece[]): MapGraph {
  const occurrences = new Map<string, number>();
  for (const p of pieces) for (const k of p.keys) occurrences.set(k, (occurrences.get(k) ?? 0) + 1);

  const nodeIndex = new Map<string, number>();
  const nodes: Vec2[] = [];
  const isNode = (p: RoadPiece, i: number) =>
    i === 0 || i === p.keys.length - 1 || (occurrences.get(p.keys[i]) ?? 0) >= 2;
  const nodeOf = (p: RoadPiece, i: number) => {
    const key = p.keys[i];
    let n = nodeIndex.get(key);
    if (n === undefined) {
      n = nodes.length;
      nodeIndex.set(key, n);
      nodes.push(p.road.points[i]);
    }
    return n;
  };

  const roadEdges: GraphEdge[] = [];
  const footEdges: FootEdge[] = [];
  pieces.forEach((p, r) => {
    const footOffset = FOOT_CLASSES.has(p.road.class) ? 0 : p.road.sidewalkOffset;
    let start = 0;
    let startNode = nodeOf(p, 0);
    for (let i = 1; i < p.keys.length; i++) {
      if (!isNode(p, i)) continue;
      const endNode = nodeOf(p, i);
      const length = q(polylineRangeLength(p.road.points, start, i));
      if (p.drivable) {
        roadEdges.push({ from: startNode, to: endNode, road: r, i0: start, i1: i, length });
        if (!p.road.oneway) roadEdges.push({ from: endNode, to: startNode, road: r, i0: i, i1: start, length });
      }
      if (p.walkable) {
        footEdges.push({ from: startNode, to: endNode, road: r, i0: start, i1: i, length, offset: footOffset });
      }
      start = i;
      startNode = endNode;
    }
  });
  return { nodes, roadEdges, footEdges };
}

export interface GraphStats {
  edges: number;
  components: number;
  largestEdges: number;
  largestEdgeShare: number;
}

/** Weakly-connected components of the nodes touched by `edges`. */
export function graphStats(nodeCount: number, edges: readonly { from: number; to: number }[]): GraphStats {
  const parent = Array.from({ length: nodeCount }, (_, i) => i);
  const find = (a: number): number => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  const used = new Set<number>();
  for (const e of edges) {
    used.add(e.from);
    used.add(e.to);
    const a = find(e.from);
    const b = find(e.to);
    if (a !== b) parent[a] = b;
  }
  const roots = new Set([...used].map(find));
  const edgeCount = new Map<number, number>();
  for (const e of edges) {
    const root = find(e.from);
    edgeCount.set(root, (edgeCount.get(root) ?? 0) + 1);
  }
  const largestEdges = Math.max(0, ...edgeCount.values());
  return {
    edges: edges.length,
    components: roots.size,
    largestEdges,
    largestEdgeShare: edges.length ? largestEdges / edges.length : 0,
  };
}

/**
 * Junctions that deserve traffic lights: at least 3 distinct non-service
 * drivable neighbours, at least 2 of them along main roads, not on a
 * roundabout and not touching motorways. Nodes closer than `mergeRadius`
 * metres (dual carriageways) are merged into one junction.
 */
export function findTrafficLights(graph: MapGraph, pieces: RoadPiece[], mergeRadius = 25): MapTrafficLight[] {
  const all = new Map<number, Set<number>>();
  const main = new Map<number, Set<number>>();
  const banned = new Set<number>();
  const link = (m: Map<number, Set<number>>, a: number, b: number) => {
    let s = m.get(a);
    if (!s) m.set(a, (s = new Set()));
    s.add(b);
  };
  for (const e of graph.roadEdges) {
    if (e.from === e.to) continue;
    const p = pieces[e.road];
    const cls = p.road.class;
    if (p.roundabout || cls === "motorway" || cls === "motorway_link") {
      banned.add(e.from);
      banned.add(e.to);
      continue;
    }
    if (cls === "service") continue;
    for (const [a, b] of [
      [e.from, e.to],
      [e.to, e.from],
    ]) {
      link(all, a, b);
      if (MAIN_CLASSES.has(cls)) link(main, a, b);
    }
  }
  const candidates = [...all.keys()]
    .filter((n) => !banned.has(n) && all.get(n)!.size >= 3 && (main.get(n)?.size ?? 0) >= 2)
    .sort((a, b) => a - b);

  // Single-linkage clustering of nearby candidates.
  const parent = candidates.map((_, i) => i);
  const find = (a: number): number => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const [ax, az] = graph.nodes[candidates[i]];
      const [bx, bz] = graph.nodes[candidates[j]];
      if (Math.hypot(ax - bx, az - bz) <= mergeRadius) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, number[]>();
  candidates.forEach((n, i) => {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(n);
    else groups.set(r, [n]);
  });
  return [...groups.values()]
    .map((nodes) => {
      const x = nodes.reduce((s, n) => s + graph.nodes[n][0], 0) / nodes.length;
      const z = nodes.reduce((s, n) => s + graph.nodes[n][1], 0) / nodes.length;
      return { x: q(x), z: q(z), nodes: [...nodes].sort((a, b) => a - b) };
    })
    .sort((a, b) => a.nodes[0] - b.nodes[0]);
}
