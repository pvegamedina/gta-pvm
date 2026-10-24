// Uniform-grid spatial hash for fast bbox / point lookups of map features
// (buildings, road segments…). Items are stored in every cell their bbox
// touches; queries de-duplicate and keep insertion order so results are
// deterministic.

export class SpatialHash<T> {
  private readonly cells = new Map<string, number[]>();
  private readonly items: T[] = [];

  constructor(readonly cellSize: number) {
    if (!(cellSize > 0)) throw new Error("SpatialHash: cellSize must be > 0");
  }

  get size(): number {
    return this.items.length;
  }

  insert(item: T, minX: number, minZ: number, maxX: number, maxZ: number): void {
    const id = this.items.length;
    this.items.push(item);
    const [i0, j0, i1, j1] = this.cellRange(minX, minZ, maxX, maxZ);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const key = `${i},${j}`;
        const bucket = this.cells.get(key);
        if (bucket) bucket.push(id);
        else this.cells.set(key, [id]);
      }
    }
  }

  /** Items whose bbox cells overlap the query rectangle (a superset of true hits). */
  query(minX: number, minZ: number, maxX: number, maxZ: number): T[] {
    const [i0, j0, i1, j1] = this.cellRange(minX, minZ, maxX, maxZ);
    const seen = new Set<number>();
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > this.cells.size) {
      // Query larger than the occupied area: scan the occupied cells instead.
      for (const [key, bucket] of this.cells) {
        const comma = key.indexOf(",");
        const i = Number(key.slice(0, comma));
        const j = Number(key.slice(comma + 1));
        if (i >= i0 && i <= i1 && j >= j0 && j <= j1) for (const id of bucket) seen.add(id);
      }
    } else {
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const bucket = this.cells.get(`${i},${j}`);
          if (bucket) for (const id of bucket) seen.add(id);
        }
      }
    }
    return [...seen].sort((a, b) => a - b).map((id) => this.items[id]);
  }

  queryPoint(x: number, z: number): T[] {
    return this.query(x, z, x, z);
  }

  queryRadius(x: number, z: number, r: number): T[] {
    return this.query(x - r, z - r, x + r, z + r);
  }

  private cellRange(minX: number, minZ: number, maxX: number, maxZ: number): [number, number, number, number] {
    const s = this.cellSize;
    // Clamp so infinite/huge rectangles still produce finite integer ranges.
    return [Math.floor(minX / s), Math.floor(minZ / s), Math.floor(maxX / s), Math.floor(maxZ / s)].map((v) =>
      Math.max(-1e7, Math.min(1e7, v)),
    ) as [number, number, number, number];
  }
}
