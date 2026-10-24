// Minimal reader for Overpass JSON (`out body; >; out skel qt;`) plus
// multipolygon ring assembly.

export type Tags = Record<string, string>;

export interface OsmNode {
  id: number;
  lat: number;
  lon: number;
  tags?: Tags;
}

export interface OsmWay {
  id: number;
  nodes: number[];
  tags?: Tags;
}

export interface OsmMember {
  type: "node" | "way" | "relation";
  ref: number;
  role: string;
}

export interface OsmRelation {
  id: number;
  members: OsmMember[];
  tags?: Tags;
}

export interface OsmData {
  nodes: Map<number, OsmNode>;
  /** Sorted by id for deterministic processing. */
  ways: OsmWay[];
  wayById: Map<number, OsmWay>;
  relations: OsmRelation[];
}

/** Parses the Overpass JSON document; elements are de-duplicated and sorted by id. */
export function parseOverpass(json: unknown): OsmData {
  const elements = (json as { elements?: unknown }).elements;
  if (!Array.isArray(elements)) throw new Error("Overpass JSON: missing elements array");
  const nodes = new Map<number, OsmNode>();
  const wayById = new Map<number, OsmWay>();
  const relById = new Map<number, OsmRelation>();
  for (const e of elements as Array<Record<string, unknown>>) {
    if (e.type === "node") {
      const prev = nodes.get(e.id as number);
      // `out skel` repeats nodes without tags; keep the tagged copy.
      nodes.set(e.id as number, {
        id: e.id as number,
        lat: e.lat as number,
        lon: e.lon as number,
        tags: (e.tags as Tags | undefined) ?? prev?.tags,
      });
    } else if (e.type === "way") {
      const prev = wayById.get(e.id as number);
      wayById.set(e.id as number, {
        id: e.id as number,
        nodes: e.nodes as number[],
        tags: (e.tags as Tags | undefined) ?? prev?.tags,
      });
    } else if (e.type === "relation") {
      const prev = relById.get(e.id as number);
      relById.set(e.id as number, {
        id: e.id as number,
        members: e.members as OsmMember[],
        tags: (e.tags as Tags | undefined) ?? prev?.tags,
      });
    }
  }
  const ways = [...wayById.values()].sort((a, b) => a.id - b.id);
  const relations = [...relById.values()].sort((a, b) => a.id - b.id);
  return { nodes, ways, wayById, relations };
}

/** True when the way's first and last node are the same. */
export function isClosed(way: { nodes: number[] }): boolean {
  return way.nodes.length >= 4 && way.nodes[0] === way.nodes[way.nodes.length - 1];
}

/**
 * Joins member ways (node-id chains) that share endpoints into closed rings.
 * Returned rings do not repeat their first node at the end. Chains that never
 * close are dropped.
 */
export function assembleRings(chains: number[][]): number[][] {
  const rings: number[][] = [];
  const open: number[][] = [];
  for (const c of chains) {
    if (c.length >= 4 && c[0] === c[c.length - 1]) rings.push(c.slice(0, -1));
    else if (c.length >= 2) open.push([...c]);
  }
  while (open.length > 0) {
    let current = open.shift()!;
    let progress = true;
    while (current[0] !== current[current.length - 1] && progress) {
      progress = false;
      const tail = current[current.length - 1];
      for (let i = 0; i < open.length; i++) {
        const c = open[i];
        if (c[0] === tail) current = current.concat(c.slice(1));
        else if (c[c.length - 1] === tail) current = current.concat([...c].reverse().slice(1));
        else continue;
        open.splice(i, 1);
        progress = true;
        break;
      }
    }
    if (current.length >= 4 && current[0] === current[current.length - 1]) rings.push(current.slice(0, -1));
  }
  return rings;
}

/** Outer rings (node ids) of a multipolygon relation. */
export function relationOuterRings(rel: OsmRelation, osm: OsmData): number[][] {
  const chains: number[][] = [];
  for (const m of rel.members) {
    if (m.type !== "way" || (m.role !== "outer" && m.role !== "")) continue;
    const w = osm.wayById.get(m.ref);
    if (w) chains.push(w.nodes);
  }
  return assembleRings(chains);
}

/** Numeric tag parser: accepts "12", "12.5", "12 m", "12,5"; returns undefined otherwise. */
export function parseNumberTag(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*(m)?\s*$/.exec(value);
  if (!m) return undefined;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}
