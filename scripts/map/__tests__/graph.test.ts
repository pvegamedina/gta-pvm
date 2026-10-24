import { describe, expect, it } from "vitest";
import type { Vec2 } from "../../../src/game/map/types";
import { buildGraph, findTrafficLights, graphStats, makeRoadPiece, type RoadPiece } from "../roads";

/** Builds a road piece from tags and keyed points. */
function piece(id: string, tags: Record<string, string>, pts: [string, number, number][]): RoadPiece {
  const p = makeRoadPiece(
    id,
    tags,
    pts.map(([key, x, z]) => ({ key, x, z })),
  );
  if (!p) throw new Error("not a road");
  return p;
}

//            n
//            |  (tertiary, two-way)
//   w ------ c ------ e      (tertiary, two-way)
//            |
//            s ---> f        (residential one-way s→f)
//   footway: c - p - q (shares node c with the roads)
function crossNetwork(): RoadPiece[] {
  return [
    piece("w1", { highway: "tertiary" }, [
      ["w", -50, 0],
      ["c", 0, 0],
      ["e", 50, 0],
    ]),
    piece("w2", { highway: "tertiary" }, [
      ["n", 0, -50],
      ["c", 0, 0],
      ["s", 0, 50],
    ]),
    piece("w3", { highway: "residential", oneway: "yes" }, [
      ["s", 0, 50],
      ["f", 40, 50],
    ]),
    piece("w4", { highway: "footway" }, [
      ["c", 0, 0],
      ["p", -10, -10],
      ["q", -20, -30],
    ]),
    piece("w5", { highway: "motorway" }, [
      ["m1", -200, 200],
      ["m2", 200, 200],
    ]),
  ];
}

describe("buildGraph", () => {
  const pieces = crossNetwork();
  const g = buildGraph(pieces);
  const nodeAt = (x: number, z: number) => g.nodes.findIndex(([nx, nz]: Vec2) => nx === x && nz === z);

  it("creates nodes at shared OSM nodes and way ends only", () => {
    // w, c, e, n, s, f, q, m1, m2 — the footway's middle point p is not a node.
    expect(g.nodes).toHaveLength(9);
    expect(nodeAt(-10, -10)).toBe(-1);
    expect(nodeAt(0, 0)).toBeGreaterThanOrEqual(0);
  });

  it("splits roads at intersections and adds both directions for two-way roads", () => {
    const c = nodeAt(0, 0);
    const e = nodeAt(50, 0);
    const fwd = g.roadEdges.find((ed) => ed.from === c && ed.to === e)!;
    const back = g.roadEdges.find((ed) => ed.from === e && ed.to === c)!;
    expect(fwd).toMatchObject({ road: 0, i0: 1, i1: 2, length: 50 });
    expect(back).toMatchObject({ road: 0, i0: 2, i1: 1, length: 50 });
  });

  it("respects one-way streets in the car graph", () => {
    const s = nodeAt(0, 50);
    const f = nodeAt(40, 50);
    expect(g.roadEdges.some((ed) => ed.from === s && ed.to === f)).toBe(true);
    expect(g.roadEdges.some((ed) => ed.from === f && ed.to === s)).toBe(false);
  });

  it("keeps footways out of the car graph and motorways out of the foot graph", () => {
    expect(g.roadEdges.some((ed) => ed.road === 3)).toBe(false);
    expect(g.footEdges.some((ed) => ed.road === 4)).toBe(false);
  });

  it("links footways to road sidewalks through shared nodes", () => {
    const c = nodeAt(0, 0);
    const foot = g.footEdges.filter((ed) => ed.from === c || ed.to === c);
    // 4 sidewalk edges (2 tertiary roads × 2 halves) + 1 footway edge.
    expect(foot).toHaveLength(5);
    expect(foot.find((ed) => ed.road === 3)!.offset).toBe(0);
    expect(foot.find((ed) => ed.road === 0)!.offset).toBeGreaterThan(4);
  });

  it("reports connectivity statistics", () => {
    const stats = graphStats(g.nodes.length, g.roadEdges);
    // Everything but the isolated motorway is connected.
    expect(stats.components).toBe(2);
    expect(stats.largestEdgeShare).toBeCloseTo(9 / 10);
  });
});

describe("findTrafficLights", () => {
  it("marks main-road junctions with degree ≥ 3 and merges nearby nodes", () => {
    const pieces = [
      ...crossNetwork(),
      // A second junction 12 m east of c: residential side street hitting the tertiary.
      piece("w6", { highway: "tertiary" }, [
        ["e", 50, 0],
        ["e2", 62, 0],
        ["e3", 120, 0],
      ]),
      piece("w7", { highway: "residential" }, [
        ["e2", 62, 0],
        ["r", 62, 40],
      ]),
    ];
    const g = buildGraph(pieces);
    const lights = findTrafficLights(g, pieces, 25);
    // c (4-way) and e2 (T junction). e is a degree-2 continuation.
    expect(lights).toHaveLength(2);
    const xs = lights.map((l) => l.x).sort((a, b) => a - b);
    expect(xs).toEqual([0, 62]);
  });

  it("ignores roundabouts and service driveways", () => {
    const pieces = [
      piece("w1", { highway: "tertiary" }, [
        ["a", 0, 0],
        ["b", 50, 0],
        ["c", 100, 0],
      ]),
      piece("w2", { highway: "service" }, [
        ["b", 50, 0],
        ["d", 50, 30],
      ]),
      piece("w3", { highway: "tertiary", junction: "roundabout" }, [
        ["r1", 300, 0],
        ["r2", 320, 20],
        ["r3", 300, 40],
        ["r1", 300, 0],
      ]),
      piece("w4", { highway: "tertiary" }, [
        ["r2", 320, 20],
        ["x", 380, 20],
      ]),
    ];
    const g = buildGraph(pieces);
    expect(findTrafficLights(g, pieces, 25)).toEqual([]);
  });
});
