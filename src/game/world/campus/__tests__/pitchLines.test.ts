import { describe, it, expect } from "vitest";
import { pitchMarkings } from "../pitchLines";
import type { Ring } from "../../../map/types";

// A 100 x 64 m football pitch, long axis east-west.
const field: Ring = [
  [0, 0],
  [0, 64],
  [100, 64],
  [100, 0],
];
// A tennis court 23.8 x 11 m (doubles) plus run-off: 36 x 18.
const court: Ring = [
  [0, 0],
  [0, 18],
  [36, 18],
  [36, 0],
];

function inside(lines: [number, number][][], minX: number, maxX: number, minZ: number, maxZ: number): boolean {
  return lines.every((l) => l.every(([x, z]) => x >= minX - 1e-6 && x <= maxX + 1e-6 && z >= minZ - 1e-6 && z <= maxZ + 1e-6));
}

describe("pitchMarkings", () => {
  it("draws a football pitch: touchlines, halfway line, centre circle and both boxes", () => {
    const lines = pitchMarkings(field, "soccer");
    // outline, halfway, centre circle, 2 penalty areas, 2 goal areas
    expect(lines.length).toBe(7);
    expect(inside(lines, 0, 100, 0, 64)).toBe(true);
    // The halfway line crosses the pitch at x = 50.
    const halfway = lines.find((l) => l.length === 2 && l.every(([x]) => Math.abs(x - 50) < 1e-6));
    expect(halfway).toBeDefined();
    // Centre circle: every point ~9.15 m from the centre.
    const circle = lines.find((l) => l.length > 10)!;
    for (const [x, z] of circle) expect(Math.hypot(x - 50, z - 32)).toBeCloseTo(9.15, 6);
  });

  it("draws tennis courts with the net, service lines and singles sidelines", () => {
    const lines = pitchMarkings(court, "tennis");
    expect(lines.length).toBeGreaterThanOrEqual(6);
    expect(inside(lines, 0, 36, 0, 18)).toBe(true);
  });

  it("draws a basketball court with keys and a centre circle", () => {
    const lines = pitchMarkings([[0, 0], [0, 15], [28, 15], [28, 0]], "basketball");
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });

  it("only outlines pitches of other sports, and nothing for slivers", () => {
    expect(pitchMarkings(field, "archery").length).toBe(1);
    expect(pitchMarkings(field, undefined).length).toBe(1);
    expect(pitchMarkings([[0, 0], [0, 1], [1, 1], [1, 0]], "soccer")).toEqual([]);
  });
});
