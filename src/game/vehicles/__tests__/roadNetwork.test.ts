import { describe, it, expect } from "vitest";
import { RoadNetwork, signalState, SIGNAL_CYCLE, createDriver, advanceDriver, driverPosition, distanceToStop, turnAhead, type NetworkSource } from "../roadNetwork";
import type { GraphEdge, MapRoad, Vec2 } from "../../map/types";

function road(points: Vec2[], extra: Partial<MapRoad> = {}): MapRoad {
  return { id: "w", class: "tertiary", width: 8, lanes: 2, oneway: false, surface: "asphalt", sidewalkOffset: 0, points, ...extra };
}

/**
 * A "+" junction at the origin (node 0) with four 60 m arms ending at nodes
 * 1 (east), 2 (west), 3 (north, -z) and 4 (south, +z). Every arm is a two-way
 * road drawn from the centre outwards. Node 0 has a traffic light.
 */
function plus(): NetworkSource {
  const nodes: Vec2[] = [
    [0, 0],
    [60, 0],
    [-60, 0],
    [0, -60],
    [0, 60],
  ];
  const roads = [1, 2, 3, 4].map((n) => road([nodes[0], nodes[n]]));
  const roadEdges: GraphEdge[] = [];
  roads.forEach((_, r) => {
    roadEdges.push({ from: 0, to: r + 1, road: r, i0: 0, i1: 1, length: 60 });
    roadEdges.push({ from: r + 1, to: 0, road: r, i0: 1, i1: 0, length: 60 });
  });
  return { roads, graph: { nodes, roadEdges, footEdges: [] }, trafficLights: [{ x: 0, z: 0, nodes: [0] }] };
}

const net = new RoadNetwork(plus());
const edgeOf = (from: number, to: number) => net.edges.findIndex((e) => e.from === from && e.to === to);

describe("RoadNetwork lanes", () => {
  it("puts the lane on the right-hand side of the travel direction", () => {
    // East arm, driving towards the centre (heading west): right-hand side is north (-z).
    const p = net.lanePath(edgeOf(1, 0), 0);
    for (const [, z] of p.pts) expect(z).toBeCloseTo(-2, 6);
    expect(p.pts[0][0]).toBeGreaterThan(p.pts[p.pts.length - 1][0]);
  });

  it("splits one-way roads into lanes across the whole carriageway", () => {
    const src = plus();
    (src.roads as MapRoad[])[0] = road(src.roads[0].points, { oneway: true, lanes: 2, width: 8 });
    const n = new RoadNetwork(src);
    const e = n.edges.findIndex((x) => x.from === 0 && x.to === 1);
    expect(n.lanesOf(e)).toBe(2);
    // Heading east: right-hand side is south (+z).
    expect(n.laneOffset(e, 0)).toBeCloseTo(-2, 6);
    expect(n.laneOffset(e, 1)).toBeCloseTo(2, 6);
  });

  it("trims lane paths short of a junction so cars can turn through it", () => {
    const p = net.lanePath(edgeOf(1, 0), 0);
    const end = p.pts[p.pts.length - 1];
    expect(end[0]).toBeGreaterThan(4);
    expect(end[0]).toBeLessThan(8);
    expect(p.length).toBeCloseTo(p.cum[p.cum.length - 1], 9);
  });
});

describe("RoadNetwork routing", () => {
  it("never U-turns at a junction that has other exits, and prefers going straight", () => {
    const into = edgeOf(1, 0); // heading west into the junction
    const counts = new Map<number, number>();
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 3000; i++) {
      const nxt = net.pickNext(into, rnd);
      counts.set(nxt, (counts.get(nxt) ?? 0) + 1);
    }
    expect(counts.has(edgeOf(0, 1))).toBe(false);
    const straight = counts.get(edgeOf(0, 2)) ?? 0;
    const left = counts.get(edgeOf(0, 4)) ?? 0;
    const right = counts.get(edgeOf(0, 3)) ?? 0;
    expect(straight).toBeGreaterThan(left);
    expect(straight).toBeGreaterThan(right);
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
  });

  it("turns around at a dead end", () => {
    expect(net.pickNext(edgeOf(0, 1), Math.random)).toBe(edgeOf(1, 0));
  });

  it("returns -1 when a one-way street leads nowhere", () => {
    const src = plus();
    src.graph.roadEdges = src.graph.roadEdges.filter((e) => !(e.from === 1 && e.to === 0));
    const n = new RoadNetwork(src);
    expect(n.pickNext(n.edges.findIndex((e) => e.from === 0 && e.to === 1), Math.random)).toBe(-1);
  });

  it("links the end of one lane to the start of the next with a smooth connector", () => {
    const a = edgeOf(1, 0);
    const b = edgeOf(0, 4); // left turn (south)
    const pa = net.lanePath(a, 0);
    const pb = net.lanePath(b, 0);
    const c = net.connector(a, 0, b, 0);
    expect(c.pts[0]).toEqual(pa.pts[pa.pts.length - 1]);
    expect(c.pts[c.pts.length - 1]).toEqual(pb.pts[0]);
    expect(c.pts.length).toBeGreaterThan(4);
    const chord = Math.hypot(pb.pts[0][0] - pa.pts[pa.pts.length - 1][0], pb.pts[0][1] - pa.pts[pa.pts.length - 1][1]);
    expect(c.length).toBeGreaterThan(chord);
    expect(c.length).toBeLessThan(chord * 1.6);
  });
});

describe("traffic lights", () => {
  it("stops cars entering a signalled junction, not cars leaving it", () => {
    expect(net.stopJunction(edgeOf(1, 0))).toBe(0);
    expect(net.stopJunction(edgeOf(0, 1))).toBe(-1);
  });

  it("groups crossing approaches into different phases", () => {
    const ew = [net.approachGroup(edgeOf(1, 0)), net.approachGroup(edgeOf(2, 0))];
    const ns = [net.approachGroup(edgeOf(3, 0)), net.approachGroup(edgeOf(4, 0))];
    expect(ew[0]).toBe(ew[1]);
    expect(ns[0]).toBe(ns[1]);
    expect(ew[0]).not.toBe(ns[0]);
  });

  it("never shows green to both groups and cycles G -> Y -> R for each", () => {
    let green0 = 0;
    let green1 = 0;
    const seq: string[] = [];
    for (let t = 0; t < SIGNAL_CYCLE; t += 0.25) {
      const a = signalState(0, 0, t);
      const b = signalState(0, 1, t);
      expect(a === "G" && b === "G").toBe(false);
      expect(a !== "R" && b !== "R").toBe(false);
      if (a === "G") green0++;
      if (b === "G") green1++;
      if (seq[seq.length - 1] !== a) seq.push(a);
    }
    expect(green0).toBeGreaterThan(0);
    expect(green1).toBe(green0);
    expect(seq.slice(0, 3)).toEqual(["G", "Y", "R"]);
  });

  it("offsets the cycle per junction", () => {
    expect(signalState(0, 0, 0)).toBe("G");
    expect(signalState(SIGNAL_CYCLE / 2, 0, 0)).not.toBe("G");
  });
});

describe("Driver (path following)", () => {
  const seq = (vals: number[]) => {
    let i = 0;
    return () => vals[i++ % vals.length];
  };

  it("drives along its lane, through a junction connector and onto the next edge", () => {
    const d = createDriver(net, edgeOf(1, 0), 0, 0, seq([0.5]));
    const start = driverPosition(d, { x: 0, z: 0, yaw: 0 });
    expect(start.x).toBeGreaterThan(50);
    let prev = { ...start };
    let sawLink = false;
    for (let i = 0; i < 400; i++) {
      expect(advanceDriver(d, net, 0.5, seq([0.5]))).toBe(true);
      const p = driverPosition(d, { x: 0, z: 0, yaw: 0 });
      // Continuous motion: never jumps further than it drove.
      expect(Math.hypot(p.x - prev.x, p.z - prev.z)).toBeLessThan(0.5 + 1e-6);
      prev = p;
      if (d.onLink) sawLink = true;
    }
    expect(sawLink).toBe(true);
    // 200 m later it has crossed the junction and left along another arm.
    expect(d.edge).not.toBe(edgeOf(1, 0));
    expect(net.edges[d.edge].from === 0 || net.edges[d.edge].to === 0).toBe(true);
  });

  it("reports the distance left to the stop line of a signalled junction ahead", () => {
    const d = createDriver(net, edgeOf(1, 0), 0, 10, seq([0.5]));
    const p = net.lanePath(edgeOf(1, 0), 0);
    expect(distanceToStop(d, net)).toBeCloseTo(p.length - 10, 6);
    const out = createDriver(net, edgeOf(0, 1), 0, 10, seq([0.5]));
    expect(distanceToStop(out, net)).toBe(Infinity);
  });

  it("moves the stop line back by the approach's painted setback", () => {
    const e = edgeOf(1, 0);
    const d = createDriver(net, e, 0, 10, seq([0.5]));
    const p = net.lanePath(e, 0);
    expect(net.stopSetback(e)).toBe(0);
    net.setStopSetback(e, 4.4);
    expect(net.stopSetback(e)).toBe(4.4);
    expect(distanceToStop(d, net)).toBeCloseTo(p.length - 10 - 4.4, 6);
    net.setStopSetback(e, 0);
  });

  it("looks ahead into the next path to see upcoming turns", () => {
    // Force a left turn: next edge is 0 -> 4 (south) when heading west.
    const d = createDriver(net, edgeOf(1, 0), 0, 0, () => 0);
    d.nextEdge = edgeOf(0, 4);
    const p = net.lanePath(edgeOf(1, 0), 0);
    d.s = p.length - 2;
    const turn = turnAhead(d, net, 15);
    expect(turn).toBeGreaterThan(1.2);
    d.s = 5;
    expect(turnAhead(d, net, 15)).toBeLessThan(0.05);
  });

  it("fails to advance when the road just ends", () => {
    const src = plus();
    src.graph.roadEdges = src.graph.roadEdges.filter((e) => !(e.from === 1 && e.to === 0));
    const n = new RoadNetwork(src);
    const e = n.edges.findIndex((x) => x.from === 0 && x.to === 1);
    const d = createDriver(n, e, 0, 0, Math.random);
    let ok = true;
    for (let i = 0; i < 200 && ok; i++) ok = advanceDriver(d, n, 1, Math.random);
    expect(ok).toBe(false);
  });
});
