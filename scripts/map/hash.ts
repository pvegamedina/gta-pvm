// Stable, platform-independent integer hash used for every "random" choice in
// the map build (tree species, scatter jitter, default house heights…), so the
// output is byte-identical across runs and machines.

/** 32-bit hash of a list of integers (murmur3-style finalizer per input). */
export function hash32(...values: number[]): number {
  let h = 0x811c9dc5;
  for (const v of values) {
    let k = Math.trunc(v) | 0;
    k = Math.imul(k, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  h ^= values.length;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash mapped to [0, 1). */
export function hash01(...values: number[]): number {
  return hash32(...values) / 4294967296;
}

/** Hash of a planar position quantized to decimetres. */
export function hashXZ(x: number, z: number, salt = 0): number {
  return hash01(Math.round(x * 10), Math.round(z * 10), salt);
}
