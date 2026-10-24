// Texel snapping for the sun's shadow camera. The orthographic shadow frustum
// follows the player; if its centre moves by fractions of a shadow-map texel
// every frame, shadow edges crawl and shimmer. Snapping the centre to the
// texel grid of the light's view plane (the two axes across the light
// direction) keeps the rasterization stable while the frustum still follows.
// Pure (no THREE), tested.

export interface V3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Light-view basis matching three's lookAt (camera at target + dir, up +y):
 * z = dir, x = normalize(up × z), y = z × x. Falls back to +x up when the
 * light is (nearly) vertical.
 */
export function lightBasis(dir: V3): { x: V3; y: V3; z: V3 } {
  const z = dir;
  // up × z with up = (0, 1, 0) is (z.z, 0, -z.x).
  let x = { x: z.z, y: 0, z: -z.x };
  let l = Math.hypot(x.x, x.y, x.z);
  if (l < 1e-6) {
    // up = (0, 0, 1): up × z = (-z.y, z.x, 0)
    x = { x: -z.y, y: z.x, z: 0 };
    l = Math.hypot(x.x, x.y, x.z) || 1;
  }
  x = { x: x.x / l, y: x.y / l, z: x.z / l };
  const y = { x: z.y * x.z - z.z * x.y, y: z.z * x.x - z.x * x.z, z: z.x * x.y - z.y * x.x };
  return { x, y, z };
}

/**
 * Snaps `p` so its coordinates along the light's view-plane axes are whole
 * multiples of `texel` (m); the component along the light is unchanged.
 * Writes into and returns `out`.
 */
export function snapShadowCentre(p: V3, dir: V3, texel: number, out: V3): V3 {
  const b = lightBasis(dir);
  const px = p.x * b.x.x + p.y * b.x.y + p.z * b.x.z;
  const py = p.x * b.y.x + p.y * b.y.y + p.z * b.y.z;
  const dx = Math.round(px / texel) * texel - px;
  const dy = Math.round(py / texel) * texel - py;
  out.x = p.x + dx * b.x.x + dy * b.y.x;
  out.y = p.y + dx * b.x.y + dy * b.y.y;
  out.z = p.z + dx * b.x.z + dy * b.y.z;
  return out;
}
