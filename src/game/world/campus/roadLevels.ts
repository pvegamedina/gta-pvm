// Heights of the drawn road layers above the terrain, shared by the road
// meshes (roads.ts) and the visual surface-lift sampler that puts feet on
// them (surfaceLift.ts). Plain constants, no THREE.

/** Heights above the terrain (m) of each layer, lowest first. */
export const LIFT = {
  footway: 0.035,
  junction: 0.05,
  road: 0.06,
  crossing: 0.075,
  kerbTop: 0.16,
} as const;

/** Dropped kerb: how far the sidewalk dips at a crossing (m) and the ramp length either side. */
export const KERB_DROP = LIFT.kerbTop - LIFT.road - 0.01;
export const KERB_RAMP = 1.2;
