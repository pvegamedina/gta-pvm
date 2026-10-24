import { describe, it, expect } from "vitest";
import { FootNetwork, createWalker, stepWalker, walkerPosition } from "../footNetwork";
import type { FootEdge, MapRoad, Vec2 } from "../../map/types";

function road(points: Vec2[], extra: Partial<MapRoad> = {}): MapRoad {
  return { id: "w", class: "footway", width: 2, lanes: 0, oneway: false, surface: "paving_stones", sidewalkOffset: 0, points, ...extra };
}

/**
 * Nodes: 0 (0,0) - 1 (40,0) - 2 (40,40) form an L of footways; node 1 also
 * has a street (road 2) with sidewalks at ±5 m going north to node 3.
 * Nodes 4-5 are an isolated footway far away (a second component).
 */
function source() {
  const nodes: Vec2[] = [
    [0, 0],
    [40, 0],
    [40, 40],
    [40, -40],
    [500, 500],
    [520, 500],
  ];
  const roads = [
    road([nodes[0], nodes[1]]),
    road([nodes[1], nodes[2]]),
    road([nodes[1], nodes[3]], { class: "residential", width: 7, lanes: 2, sidewalkOffset: 5 }),
    road([nodes[4], nodes[5]]),
  ];
  const fe = (from: number, to: number, r: number, offset = 0): FootEdge => ({ from, to, road: r, i0: 0, i1: 1, length: 40, offset });
  const footEdges = [fe(0, 1, 0), fe(1, 2, 1), fe(1, 3, 2, 5), fe(4, 5, 3)];
  return { roads, graph: { nodes, roadEdges: [], footEdges } };
}

const net = new FootNetwork(source());

describe("FootNetwork", () => {
  it("keeps only the largest connected component", () => {
    expect(net.edges.sort()).toEqual([0, 1, 2]);
    expect(net.nodeInNetwork(4)).toBe(false);
    expect(net.nodeInNetwork(1)).toBe(true);
  });

  it("walks a footway along its centreline in either direction", () => {
    const fwd = net.edgePath(0, true, 1);
    expect(fwd.pts[0]).toEqual([0, 0]);
    expect(fwd.pts[fwd.pts.length - 1]).toEqual([40, 0]);
    const back = net.edgePath(0, false, 1);
    expect(back.pts[0]).toEqual([40, 0]);
  });

  it("walks a street's sidewalk at the offset, on the same physical side in both directions", () => {
    // Road 2 runs north (-z): side +1 is its right-hand side, east (+x).
    const fwd = net.edgePath(2, true, 1);
    for (const [x] of fwd.pts) expect(x).toBeCloseTo(45, 9);
    const back = net.edgePath(2, false, 1);
    for (const [x] of back.pts) expect(x).toBeCloseTo(45, 9);
    expect(back.pts[0][1]).toBeCloseTo(-40, 9);
    const other = net.edgePath(2, true, -1);
    for (const [x] of other.pts) expect(x).toBeCloseTo(35, 9);
  });

  it("does not walk straight back along the same edge when another way exists", () => {
    for (let i = 0; i < 50; i++) {
      const next = net.pickNext(1, 0, Math.random);
      expect(next).not.toBe(0);
      expect([1, 2]).toContain(next);
    }
  });

  it("turns back at a dead end", () => {
    expect(net.pickNext(2, 1, Math.random)).toBe(1);
  });

  it("reports the node at the far end of a walked edge", () => {
    expect(net.endNode(2, true)).toBe(3);
    expect(net.endNode(2, false)).toBe(1);
  });
});

describe("walkers", () => {
  it("walk continuously along edges and turn onto the next one at nodes", () => {
    const w = createWalker(net, 0, true, 1, 0);
    let prev = walkerPosition(w, { x: 0, z: 0, yaw: 0 });
    const visited = new Set<number>([w.edge]);
    for (let i = 0; i < 300; i++) {
      stepWalker(w, net, 0.4, () => 0.3);
      const p = walkerPosition(w, { x: 0, z: 0, yaw: 0 });
      expect(Math.hypot(p.x - prev.x, p.z - prev.z)).toBeLessThan(0.4 + 1e-6);
      prev = p;
      visited.add(w.edge);
    }
    expect(visited.size).toBeGreaterThan(1);
    for (const e of visited) expect(net.edges).toContain(e);
  });

  it("keeps the same sidewalk side when walking on along the same street", () => {
    const w = createWalker(net, 2, true, -1, 0);
    expect(walkerPosition(w, { x: 0, z: 0, yaw: 0 }).x).toBeCloseTo(35, 6);
  });
});
