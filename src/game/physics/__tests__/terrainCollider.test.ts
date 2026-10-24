// The ragdoll world's ground is a Rapier heightfield built from the map
// terrain. Rapier's heightfield layout (rows/columns, column-major storage,
// centred on its translation) is easy to get transposed or mirrored, so this
// checks it against the game's own `heightAt` with real ray casts.

import { describe, it, expect, beforeAll } from "vitest";
import { loadRapier, PhysicsWorld, type Rapier } from "../physicsWorld";
import { heightAt, type Terrain } from "../../map/terrain";

let R: Rapier;
beforeAll(async () => {
  const r = await loadRapier();
  if (!r) throw new Error("Rapier failed to load");
  R = r;
});

/** Deliberately asymmetric terrain: a different slope along x and z plus bumps. */
function terrain(): Terrain {
  const width = 7;
  const height = 5;
  const heights = new Float32Array(width * height);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) heights[j * width + i] = 3 + 0.8 * i + 2.5 * j + ((i * 7 + j * 3) % 4) * 0.6;
  return { originX: -40, originZ: 100, cellSize: 4, width, height, heights };
}

function groundHit(world: PhysicsWorld, x: number, z: number): number | null {
  const ray = new R.Ray({ x, y: 200, z }, { x: 0, y: -1, z: 0 });
  const hit = world.world.castRay(ray, 400, true);
  return hit ? 200 - hit.timeOfImpact : null;
}

describe("PhysicsWorld.addTerrain", () => {
  it("matches heightAt exactly at every heightfield sample", () => {
    const t = terrain();
    const world = new PhysicsWorld(R);
    world.addTerrain(t);
    world.step();
    for (let j = 0; j < t.height; j++) {
      for (let i = 0; i < t.width; i++) {
        // Nudge just off the exact vertex (ray-vs-edge corner cases) and inside the border.
        const x = t.originX + Math.min(i * t.cellSize + 0.03, (t.width - 1) * t.cellSize - 0.03);
        const z = t.originZ + Math.min(j * t.cellSize + 0.03, (t.height - 1) * t.cellSize - 0.03);
        const y = groundHit(world, x, z);
        expect(y, `sample ${i},${j}`).not.toBeNull();
        expect(y!).toBeCloseTo(heightAt(t, x, z), 1);
      }
    }
    world.dispose();
  });

  it("stays within a few centimetres of heightAt between samples", () => {
    const t = terrain();
    const world = new PhysicsWorld(R);
    world.addTerrain(t);
    world.step();
    for (const [x, z] of [
      [-37.3, 101.1],
      [-21.5, 109.9],
      [-17.2, 114.4],
    ]) {
      const y = groundHit(world, x, z)!;
      // Triangles vs bilinear interpolation differ a little inside non-planar cells.
      expect(Math.abs(y - heightAt(t, x, z))).toBeLessThan(0.6);
    }
    world.dispose();
  });
});
