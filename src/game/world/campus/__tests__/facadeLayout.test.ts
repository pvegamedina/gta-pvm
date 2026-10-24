import { describe, it, expect } from "vitest";
import {
  FACADE_DEPTH,
  FAMILIES,
  ROOF_PROP,
  convexCorners,
  facadeFamily,
  floorPlan,
  frontEdge,
  layoutFacade,
  moduleYaw,
  slotEdge,
  type FacadeInput,
} from "../facadeLayout";
import type { Ring } from "../../../map/types";

// CCW from above (x east, z south): west edge first, going south.
const rect: Ring = [
  [0, 0],
  [0, 10],
  [20, 10],
  [20, 0],
];
const ell: Ring = [
  [0, 0],
  [0, 10],
  [6, 10],
  [6, 4],
  [12, 4],
  [12, 0],
];

function circle(n: number, r: number): Ring {
  const out: Ring = [];
  // Angle decreasing walks counter-clockwise when seen from above with z pointing south.
  for (let k = 0; k < n; k++) out.push([Math.cos((-k / n) * Math.PI * 2) * r, Math.sin((-k / n) * Math.PI * 2) * r]);
  return out;
}

const base: FacadeInput = { id: "w1", category: "university", ring: rect, base: 10, top: 16.4, levels: 2 };

describe("slotEdge", () => {
  it("splits an edge into 2 m slots scaled to fit exactly", () => {
    expect(slotEdge(10)).toEqual({ count: 5, scale: 1 });
    const s = slotEdge(9)!;
    expect(s.count * 2 * s.scale).toBeCloseTo(9, 9);
    expect(s.scale).toBeGreaterThan(0.75);
    expect(s.scale).toBeLessThan(1.34);
  });

  it("keeps a single (stretched or squeezed) slot for short edges and rejects tiny ones", () => {
    expect(slotEdge(1.6)).toEqual({ count: 1, scale: 0.8 });
    expect(slotEdge(2.6)!.count).toBe(1);
    expect(slotEdge(1.4)).toBeNull();
  });
});

describe("convexCorners", () => {
  it("flags every corner of a CCW rectangle as convex", () => {
    expect(convexCorners(rect)).toEqual([true, true, true, true]);
  });

  it("flags the re-entrant corner of an L shape as concave", () => {
    expect(convexCorners(ell)).toEqual([true, true, true, false, true, true]);
  });
});

describe("moduleYaw", () => {
  it("turns the module front (+z) to the edge's outward normal", () => {
    // West edge (going south): outward is -x.
    const yaw = moduleYaw([0, 0], [0, 10]);
    expect(Math.sin(yaw)).toBeCloseTo(-1, 9);
    expect(Math.cos(yaw)).toBeCloseTo(0, 9);
    // Local +x then runs along the edge (cos yaw, -sin yaw) = +z (south).
    expect(Math.cos(yaw)).toBeCloseTo(0, 9);
    expect(-Math.sin(yaw)).toBeCloseTo(1, 9);
  });
});

describe("facadeFamily", () => {
  it("is stable per building id and appropriate per category", () => {
    expect(facadeFamily("university", "w42")).toBe(facadeFamily("university", "w42"));
    expect(facadeFamily("sports", "w1")).toBe("sportsHall");
    expect(facadeFamily("house", "w9")).toBe("house");
    const uni = new Set(["w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8", "w9", "w10", "w11", "w12"].map((id) => facadeFamily("university", id)));
    // Campus buildings get some variety.
    expect(uni.size).toBeGreaterThan(1);
  });
});

describe("floorPlan", () => {
  it("uses mapped levels and scales modules to the real storey height", () => {
    const p = floorPlan(6.4, 2);
    expect(p.floors).toBe(2);
    expect(p.floorHeight).toBeCloseTo(3.2, 9);
    expect(p.sy).toBeCloseTo(3.2 / 3, 9);
  });

  it("derives a storey count from the height when levels are unknown", () => {
    const p = floorPlan(14);
    expect(p.floors).toBe(4);
    expect(p.floors * p.floorHeight).toBeCloseTo(14, 9);
  });
});

describe("frontEdge", () => {
  it("picks the edge whose outside is nearest to a road", () => {
    // Road running east-west south of the rectangle (z = 18): the south edge (index 1) faces it.
    expect(frontEdge(rect, (_x, z) => Math.abs(z - 18))).toBe(1);
    // Road west of it (x = -9): the west edge (index 0).
    expect(frontEdge(rect, (x) => Math.abs(x + 9))).toBe(0);
  });

  it("only puts the entrance on an edge long enough for a door bay", () => {
    // A bay sticking out: its 4 m front (index 3) is nearest the road but too short for three slots,
    // so the entrance goes on the first 8 m edge either side of it (index 1).
    const notched: Ring = [
      [0, 0],
      [0, 10],
      [8, 10],
      [8, 14],
      [12, 14],
      [12, 10],
      [20, 10],
      [20, 0],
    ];
    expect(frontEdge(notched, (_x, z) => Math.abs(z - 18))).toBe(1);
  });

  it("falls back to the longest edge without a road lookup", () => {
    expect(frontEdge(rect)).toBe(1);
  });
});

describe("layoutFacade", () => {
  const road = (_x: number, z: number) => Math.abs(z - 18);
  const lay = layoutFacade(base, { roadDistance: road });

  it("covers every floor of every edge with 2 m slots", () => {
    expect(lay.fallback).toBe(false);
    const wall = lay.placements.filter((p) => p.role === "wall");
    const doors = lay.placements.filter((p) => p.role === "door");
    // Perimeter 60 m = 30 slots per floor (offset edges are a bit longer, still 30 slots), 2 floors;
    // the entrance frame takes one ground-floor slot.
    expect(wall.length + doors.length).toBe(60);
    for (const p of wall) {
      expect(p.sy).toBeCloseTo(3.2 / 3, 9);
      expect(p.y === 10 || Math.abs(p.y - 13.2) < 1e-9).toBe(true);
    }
  });

  it("puts one entrance on the ground floor of the edge facing the road", () => {
    const doors = lay.placements.filter((p) => p.role === "door");
    expect(doors.length).toBeGreaterThanOrEqual(1);
    expect(lay.frontEdge).toBe(1);
    for (const d of doors) {
      expect(d.y).toBe(10);
      // South edge: outward normal is +z.
      expect(d.z).toBeGreaterThan(10);
    }
    expect(lay.entrance![1]).toBeGreaterThan(10);
  });

  it("stands every module just outside the footprint, facing out", () => {
    for (const p of lay.placements.filter((q) => q.role === "wall")) {
      const fx = Math.sin(p.yaw);
      const fz = Math.cos(p.yaw);
      // Moving back along the facing from the module origin by FACADE_DEPTH lands on the footprint boundary.
      const bx = p.x - fx * FACADE_DEPTH;
      const bz = p.z - fz * FACADE_DEPTH;
      const onEdge = Math.min(Math.abs(bx), Math.abs(bx - 20), Math.abs(bz), Math.abs(bz - 10));
      expect(onEdge).toBeLessThan(0.05);
    }
  });

  it("caps the last floor with a cornice row and the corners with posts", () => {
    const cornice = lay.placements.filter((p) => p.role === "cornice");
    expect(cornice.length).toBe(30);
    for (const c of cornice) expect(c.y).toBeCloseTo(16.4, 9);
    expect(lay.placements.filter((p) => p.role === "corner").length).toBe(4);
  });

  it("puts air-conditioning units on big flat roofs only, inside the footprint", () => {
    const big = layoutFacade({ ...base, ring: [[0, 0], [0, 40], [30, 40], [30, 0]] });
    const ac = big.placements.filter((p) => p.role === "roofProp");
    expect(ac.length).toBeGreaterThan(0);
    for (const p of ac) {
      expect(p.y).toBeCloseTo(16.4, 9);
      expect(p.x).toBeGreaterThan(2.4);
      expect(p.x).toBeLessThan(27.6);
    }
    expect(layoutFacade({ ...base, pitched: true }).placements.some((p) => p.role === "roofProp")).toBe(false);
  });

  it("leaves the cornice out under a pitched roof", () => {
    const pitched = layoutFacade({ ...base, pitched: true }, { roadDistance: road });
    expect(pitched.placements.some((p) => p.role === "cornice")).toBe(false);
    expect(pitched.placements.filter((p) => p.role === "wall").length).toBe(lay.placements.filter((p) => p.role === "wall").length);
  });

  it("only uses modules of its family and is deterministic", () => {
    const fam = FAMILIES[lay.family];
    const allowed = new Set([fam.ground.window, fam.ground.plain, ...fam.ground.door, fam.upper.window, fam.upper.plain, fam.top ?? fam.upper.plain, fam.cornice, fam.corner, ROOF_PROP].filter(Boolean));
    for (const p of lay.placements) expect(allowed.has(p.module)).toBe(true);
    expect(layoutFacade(base, { roadDistance: road })).toEqual(lay);
  });

  it("skips the entrance where the ground outside buries the door", () => {
    const buried = layoutFacade(base, { roadDistance: road, groundAt: () => 12 });
    expect(buried.placements.some((p) => p.role === "door")).toBe(false);
  });

  it("gives up on curved footprints made of many short edges", () => {
    const round = layoutFacade({ ...base, ring: circle(48, 9) });
    expect(round.fallback).toBe(true);
    expect(round.placements.length).toBe(0);
  });

  it("handles concave footprints without corner posts in the re-entrant corner", () => {
    const l = layoutFacade({ ...base, ring: ell });
    expect(l.fallback).toBe(false);
    expect(l.placements.filter((p) => p.role === "corner").length).toBe(5);
  });

  it("marks a share of the windows as lit at night", () => {
    const big = layoutFacade({ ...base, top: 10 + 14, levels: undefined });
    const windows = big.placements.filter((p) => p.window);
    const lit = windows.filter((p) => p.lit).length;
    expect(windows.length).toBeGreaterThan(10);
    expect(lit).toBeGreaterThan(0);
    expect(lit).toBeLessThan(windows.length);
  });
});
