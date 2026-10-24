// Pure triangle partitioning used when templating vehicle GLBs: split a
// mesh's triangles by which side of a plane their centroid lies on (the
// front wheel pair that comes as ONE mesh in the Public Transport Pack ->
// left / right wheels that can steer on their own; one shared lamp material
// -> headlights in front / tail lights behind).

/**
 * Triangle numbers (index / 3) whose centroid `measure` is <= `threshold`
 * (first list) and > `threshold` (second list).
 */
export function partitionTriangles(index: ArrayLike<number>, measure: (vertex: number) => number, threshold: number): [number[], number[]] {
  const below: number[] = [];
  const above: number[] = [];
  for (let t = 0; t < index.length / 3; t++) {
    const c = (measure(index[t * 3]) + measure(index[t * 3 + 1]) + measure(index[t * 3 + 2])) / 3;
    (c > threshold ? above : below).push(t);
  }
  return [below, above];
}
