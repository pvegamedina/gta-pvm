# Campus El Carmen Overhaul — Implementation Plan

> **For agentic workers:** each phase is executed by ONE writer subagent (no parallel writers on
> the same files). Phases ship independently: every phase ends with `npm test` + `npm run typecheck`
> green, visual verification in a real browser, and a commit + push to `main` done by the
> orchestrator. Strict TDD for pure logic (failing test first). Steps use checkbox syntax.

**Goal:** Turn "Ciudad Abierta" into a faithful, playable recreation of the University of Huelva's
Campus de El Carmen (real terrain, roads, buildings and trees), with better vehicles, nature,
two-handed weapon handling, softer locomotion, realistic engine audio and a round of polish.

**Architecture:** Real-world data (OpenStreetMap + IGN MDT05 elevation) is converted OFFLINE by a
build script into one compact map file (`public/maps/campus-el-carmen.json`). The client builds the
world from that file instead of the procedural grid city: heightfield terrain, draped road ribbons,
extruded buildings dressed with Downtown City MegaKit facade modules, instanced vegetation, a road
graph for traffic and a footway graph for pedestrians. The server reads spawn points from the same
file. Assets are Quaternius CC0 packs converted to meshopt-compressed GLB.

**Tech Stack:** Next.js 16, React 19, three.js r186, Rapier 0.21 (ragdolls), TypeScript 7,
vitest 5, ws 8; offline tooling: tsx, `geotiff` (DEM decoding), gltf-transform, obj2gltf.

---

## Data sources and licences (verified 2026-10-24)

| Data | Source | Licence | Notes |
|---|---|---|---|
| Campus bbox | Nominatim, way 127717781 | ODbL | 37.2661–37.2750 N, −6.9282…−6.9184 E (~980 × 870 m) |
| Vector map | Overpass API, bbox + 150 m margin (37.2647,−6.9299,37.2763,−6.9167) | ODbL — attribution "© OpenStreetMap contributors" required | 137 buildings (33 with `building:levels`), 293 tree nodes, 15 tree rows, motorway→footway roads, grass/parks/pitches/water |
| Elevation | IGN WCS `Elevacion4258_5` (MDT05, 5 m) | CC BY 4.0 — "© Instituto Geográfico Nacional" | 257 × 293 int16 GeoTIFF, 2–32 m, high ground NW (Cabezo de la Almagra), sloping SE |
| Characters / guns | Quaternius (already in repo) | CC0 | |
| Cars | Quaternius "Realistic Car Pack" (itch.io `lowpoly-cars`) | CC0 | Cop, Taxi, SUV, NormalCar1/2, SportsCar1/2 |
| Public transport | Quaternius "Public Transport Pack" (Drive only) | CC0 | Drive download quota exhausted on 2026-10-24 — retry; Ambulance, Bus, SchoolBus, Bicycle, TrafficCone, TrafficLight, TrafficSign1-3, Train |
| Nature | Quaternius "Ultimate Nature Pack" (itch.io `150-lowpoly-nature-models`) | CC0 | PalmTree, PineTree, CommonTree, Bush, Rock, Grass, Flowers… |
| Buildings | Quaternius "Downtown City MegaKit [Standard]" (itch.io) | CC0 | 153 glTF modules: Brick walls/windows/corners, cornices, roofs, doors, sidewalks |

Raw downloads live in the session scratchpad; only the data the build needs is committed under
`data/campus/` (raw OSM JSON + DEM GeoTIFF + README with attribution).

---

## Phase 1 — Feel: locomotion, two-handed weapons, engine audio

**Files:** `src/game/player/foot.ts`, `src/game/characters/{animationState,animationBlend,modelRig,weaponPose}.ts`,
new `src/game/characters/ik.ts`, `src/game/audio/audio.ts` (+ new `src/game/audio/engine.ts`),
`src/game/vehicles/playerCar.ts`, tests under the matching `__tests__/`.

- [ ] **1.1 Inertial on-foot movement.** Replace instant velocity with acceleration/deceleration
  (walk accel ≈ 6 m/s², run build-up ≈ 1 s from walk to sprint, braking ≈ 8 m/s² with a short
  slide-out, turning rate limit). Pure `stepFootVelocity(v, input, dt)` with tests: monotonic
  ramp-up, never overshoots target speed, stops within expected distance, framerate-independent.
- [ ] **1.2 Locomotion animation follows real speed.** Walk→run is progressive because speed is;
  add start/stop lean (slight torso pitch with acceleration), foot-planting-aware playback rate to
  reduce foot sliding. Tests on the pure blend helpers.
- [ ] **1.3 Two-handed grip.** Analytic two-bone IK (`ik.ts`, pure math, tested) for the LEFT arm
  to a `supportHand` marker on each weapon (rifle handguard, pistol grip for a two-handed
  Weaver/isosceles stance); right hand stays on the grip. Upper-body aim override so the rifle is
  shouldered and levelled at the crosshair (no more one-handed upward rifle). Per-weapon config in
  `weaponPose.ts` (`supportHand` offset, stock-to-shoulder offset).
- [ ] **1.4 Engine audio with gearbox.** RPM model from wheel speed and gear ratios
  (`engine.ts`, pure, tested: upshift/downshift points, RPM drop on shift, idle, rev limiter),
  synthesized engine (harmonic oscillators + filtered noise driven by RPM and load), audible shift
  dip + exhaust pop on upshift, turbo whoosh for sport cars, tire screech on skid/handbrake,
  per-vehicle profiles (sedan, sport, SUV, van/bus diesel, police). Remote cars use the same
  synthesis attenuated by distance (cap concurrent voices).
- [ ] **1.5 Verify + commit** `feat: inertial locomotion, two-handed weapons and gearbox engine audio`.

## Phase 2 — Vehicles

**Files:** `public/models/vehicles/*.glb`, `src/game/vehicles/{types,meshes,traffic,playerCar}.ts`,
`src/game/assets/*`, tests.

- [ ] **2.1 Assets** (orchestrator): convert the 7 cars (+ public transport if the Drive quota
  allows) to meshopt GLB with separate wheel nodes; record per-model bbox/wheel positions.
- [ ] **2.2 Data-driven vehicle catalogue:** each type = model + dimensions + mass + top speed +
  acceleration + steering + engine profile + collider radius/offsets; traffic picks weighted types
  (taxis, police occasionally, buses on main roads when available).
- [ ] **2.3 Rendering:** spinning/steering wheels, brake + reverse lights, headlights at night,
  police/ambulance light bars with siren option (`H` long press), shared materials, instanced where
  possible. Ragdoll kinematic bodies sized per type.
- [ ] **2.4 Props:** traffic cones and signs (from the transport pack when available).
- [ ] **2.5 Verify + commit** `feat: Quaternius vehicle fleet with animated wheels and lights`.

## Phase 3 — Map data pipeline (offline)

**Files:** `data/campus/{osm.json,mdt05.tif,README.md}`, `scripts/map/*.ts`,
`public/maps/campus-el-carmen.json`, `src/game/map/{types,loader}.ts`, tests. `package.json`:
`geotiff` devDependency + `"map:build": "tsx scripts/map/build.ts"`.

- [ ] **3.1 Projection:** local tangent-plane metres around the campus centre (x = east, z = south
  to match the game's axes; verify sign conventions with a test on two known points).
- [ ] **3.2 Terrain:** resample DEM to a regular grid (≈ 4–5 m), store as int16 decimetres
  (base64) + origin/cell size; bilinear `heightAt(x, z)` (tested).
- [ ] **3.3 Buildings:** footprints (outer ring, holes dropped), height from `height` /
  `building:levels × 3.2 m` / type defaults (university ≈ 3–4 levels, retail 1–2, houses 2),
  base = min terrain under footprint, names kept for HUD.
- [ ] **3.4 Roads:** polylines with class → width/lanes/one-way/surface; intersection nodes; road
  graph (nodes + directed edges) for traffic; footway graph for pedestrians; parking areas.
- [ ] **3.5 Landuse & nature:** grass/park/pitch/water polygons; tree nodes + tree rows sampled
  every ~7 m; species hints (palms along avenues, pines in parks) chosen deterministically by hash.
- [ ] **3.6 Gameplay data:** spawn points on sidewalks near campus buildings, traffic-light
  intersections (degree ≥ 3 on primary/secondary/tertiary), map bounds.
- [ ] **3.7 Verify** output size (target < 1.5 MB), schema tests, a debug top-down render.
  Commit `feat(map): Campus El Carmen data pipeline from OSM and IGN MDT05`.

## Phase 4 — World from map

**Files:** new `src/game/world/campus/*` (terrain, roads, buildings, facades, nature, landuse),
`world/{colliders,minimap,signals}.ts`, `player/foot.ts`, `vehicles/*`, `pedestrians/peds.ts`,
`physics/physicsWorld.ts`, `combat/shootables.ts`, `game.ts`, `shared/protocol.ts` + `server/*`
(spawn points from the map), tests.

- [ ] **4.1 Terrain mesh + `heightAt`** wired into player, vehicles (pitch/roll from terrain
  normal), peds, camera, bullets (terrain hits), ragdolls (Rapier heightfield collider).
- [ ] **4.2 Roads** as draped ribbons with lane markings, sidewalks + kerbs, crossings, parking.
- [ ] **4.3 Buildings:** extruded footprints placed on terrain; facades tiled with MegaKit
  modules per floor along each edge (windows/brick/cornice/roof), instanced per module type;
  flat roofs with parapets; polygon colliders in `CollisionGrid` (segment-based) + Rapier.
- [ ] **4.4 Nature:** instanced trees/bushes/rocks from OSM positions, grass patches on landuse.
- [ ] **4.5 Traffic on the road graph** (lane following, one-ways, intersections, traffic lights
  at mapped junctions); pedestrians on the footway graph.
- [ ] **4.6 Minimap** rendered from map data (roads by class, buildings, water), street-name toast
  when entering a new street (GTA style), spawn points shared with the server.
- [ ] **4.7 Remove the procedural grid city** (keep `legacy-index.html` untouched).
- [ ] **4.8 Verify** (top-down + street-level screenshots next to real campus landmarks), perf
  budget, commit `feat(world): playable Campus El Carmen with real terrain, roads and buildings`.

## Phase 5 — Polish

- [ ] **5.1 Settings menu** (pause): mouse sensitivity, master/SFX volume, graphics preset
  (shadows, pixel ratio, draw distance), persisted in localStorage.
- [ ] **5.2 Audio ambience:** footsteps by surface (asphalt/grass/pavement), city/birds by day,
  crickets at night, wind; vehicle doors.
- [ ] **5.3 VFX:** skid marks, exhaust smoke, headlight cones at night, dust when braking hard.
- [ ] **5.4 Performance:** instancing audit, shadow camera follows player, LOD/fade for far props,
  frame-time HUD toggle (F3).
- [ ] **5.5 Loading screen** with real progress (assets + map + physics).
- [ ] **5.6 Verify + commit** `feat: settings, ambience, vehicle VFX and performance pass`.

## Self-review

- Every user request maps to a task: vehicles (2), trees (3.5/4.4), buildings (4.3), real
  topography/roads/buildings (3, 4), two-handed weapons (1.3), progressive walk→run and gradual
  stop (1.1/1.2), engine audio with gear changes (1.4), extra quality ideas (5).
- Known risks: Drive quota for the transport pack (fallback: retry later; game works without it);
  facade tiling on irregular footprints (fallback: textured extrusion for edges shorter than one
  module); performance with many facade modules (instancing + merged geometry per building).
