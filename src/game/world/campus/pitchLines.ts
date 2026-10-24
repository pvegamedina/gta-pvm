// Pure line markings for sports pitches (no THREE): the pitch polygon's
// oriented box gets the markings of its OSM sport, scaled down to fit small
// pitches: football / futsal / rugby (touchlines, halfway line, centre
// circle, penalty and goal areas), tennis / paddle (net, service lines,
// singles sidelines), basketball (centre circle, keys) and an outline for
// anything else. world/campus/landuse.ts drapes them as thin white strips.

import type { Ring, Vec2 } from "../../map/types";
import { orientedBox } from "./roofs";

/** Margin (m) between the polygon's box and the outer lines. */
const MARGIN = 0.8;
const CIRCLE_SEGMENTS = 32;

type Line = Vec2[];

export function pitchMarkings(ring: Ring, sport: string | undefined): Line[] {
  const b = orientedBox(ring);
  const hl = b.halfL - MARGIN;
  const hw = b.halfW - MARGIN;
  if (hl < 2 || hw < 1.5) return [];
  const vx = -b.uz;
  const vz = b.ux;
  // Pitch frame: u along the long axis, v across, origin at the centre.
  const P = (u: number, v: number): Vec2 => [b.cx + b.ux * u + vx * v, b.cz + b.uz * u + vz * v];
  const rect = (u0: number, v0: number, u1: number, v1: number): Line => [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1), P(u0, v0)];
  const seg = (u0: number, v0: number, u1: number, v1: number): Line => [P(u0, v0), P(u1, v1)];
  const arc = (cu: number, cv: number, r: number, a0 = 0, a1 = Math.PI * 2): Line => {
    const out: Line = [];
    const n = Math.max(6, Math.round((CIRCLE_SEGMENTS * (a1 - a0)) / (Math.PI * 2)));
    for (let k = 0; k <= n; k++) {
      const a = a0 + ((a1 - a0) * k) / n;
      out.push(P(cu + Math.cos(a) * r, cv + Math.sin(a) * r));
    }
    return out;
  };
  const outline = rect(-hl, -hw, hl, hw);
  const L = hl * 2;
  const W = hw * 2;
  switch (sport) {
    case "soccer":
    case "futsal":
    case "multi":
    case "rugby": {
      const lines: Line[] = [outline, seg(0, -hw, 0, hw)];
      if (sport === "rugby") {
        // 22 m lines (scaled with the pitch length).
        const d = Math.min(22, L * 0.22);
        lines.push(seg(-hl + d, -hw, -hl + d, hw), seg(hl - d, -hw, hl - d, hw));
        return lines;
      }
      const cr = Math.min(9.15, W * 0.15);
      lines.push(arc(0, 0, cr));
      const pd = Math.min(16.5, L * 0.16);
      const pw = Math.min(20.15, W * 0.31);
      const gd = Math.min(5.5, L * 0.055);
      const gw = Math.min(9.16, W * 0.14);
      lines.push(rect(-hl, -pw, -hl + pd, pw), rect(hl - pd, -pw, hl, pw));
      lines.push(rect(-hl, -gw, -hl + gd, gw), rect(hl - gd, -gw, hl, gw));
      return lines;
    }
    case "tennis":
    case "paddle_tennis": {
      // Court sized to the polygon (run-off around it), regulation proportions.
      const cl = Math.min(hl, sport === "tennis" ? 11.885 : 10);
      const cw = Math.min(hw, sport === "tennis" ? 5.485 : 5);
      const singles = sport === "tennis" ? cw * 0.75 : cw;
      const service = sport === "tennis" ? cl * 0.54 : cl * 0.69;
      return [
        rect(-cl, -cw, cl, cw),
        seg(0, -cw, 0, cw),
        seg(-cl, -singles, cl, -singles),
        seg(-cl, singles, cl, singles),
        seg(-service, -singles, -service, singles),
        seg(service, -singles, service, singles),
        seg(-service, 0, service, 0),
      ];
    }
    case "basketball": {
      const cl = Math.min(hl, 14);
      const cw = Math.min(hw, 7.5);
      const key = Math.min(5.8, cl * 0.4);
      const kw = Math.min(2.45, cw * 0.33);
      const three = Math.min(6.75, cl * 0.48);
      return [
        rect(-cl, -cw, cl, cw),
        seg(0, -cw, 0, cw),
        arc(0, 0, Math.min(1.8, cw * 0.25)),
        rect(-cl, -kw, -cl + key, kw),
        rect(cl - key, -kw, cl, kw),
        arc(-cl + 1.6, 0, three, -Math.PI / 2, Math.PI / 2).filter(([x, z]) => insideBox(x, z)),
        arc(cl - 1.6, 0, three, Math.PI / 2, (3 * Math.PI) / 2).filter(([x, z]) => insideBox(x, z)),
      ].filter((l) => l.length >= 2);
    }
    default:
      return [outline];
  }

  function insideBox(x: number, z: number): boolean {
    const du = (x - b.cx) * b.ux + (z - b.cz) * b.uz;
    const dv = (x - b.cx) * vx + (z - b.cz) * vz;
    return Math.abs(du) <= hl + 1e-6 && Math.abs(dv) <= hw + 1e-6;
  }
}
