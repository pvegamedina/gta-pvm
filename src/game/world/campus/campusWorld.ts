// Builds the playable Campus de El Carmen from the loaded map: terrain,
// roads, buildings, water, traffic lights and (once its models arrive)
// vegetation; installs the ground sampler every gameplay system uses; and
// exposes the road / foot networks for traffic and pedestrians.

import * as THREE from "three";
import type { CampusMap } from "../../map/loader";
import type { MapSpawn } from "../../map/types";
import { setGroundSampler, setSurfaceLift, setWorldBounds } from "../ground";
import { createSurfaceLift } from "./surfaceLift";
import type { CollisionGrid } from "../colliders";
import type { ShootableRegistry } from "../../combat/shootables";
import type { Environment } from "../environment";
import { RoadNetwork } from "../../vehicles/roadNetwork";
import { FootNetwork } from "../../pedestrians/footNetwork";
import { buildSignals, type Signals } from "../signals";
import { buildMapTexture, type MinimapTexture } from "../minimap";
import { meshHeightAt } from "./terrainMesh";
import { createSurface, type Surface } from "./surface";
import { buildTerrainMesh } from "./terrain";
import { buildRoads, type RoadsBuild } from "./roads";
import { buildBuildings, type BuildingsBuild } from "./buildings";
import { buildWater } from "./water";
import { buildNature, type NatureAssets, type NatureBuild } from "./nature";
import { buildFacades, type FacadeBuild } from "./facades";
import { buildMarkings, type MarkingsBuild } from "./markings";
import { buildPitchLines } from "./landuse";
import { buildFurniture, type FurnitureBuild } from "./furniture";
import { placeFurniture, type PropPlacement } from "./furniturePlacement";
import type { PropAssets } from "../../assets/props";
import { createBuildingIndex, buildingAt } from "../../map/queries";
import { isDrivable } from "./mapPainter";
import type { Vec2 } from "../../map/types";
import type { MegakitAssets } from "../../assets/megakit";
import { createRoadIndex, nearestRoadPoint } from "../../map/queries";

export interface CampusWorld {
  map: CampusMap;
  surface: Surface;
  /** Height of the rendered terrain only (no bridge decks). */
  terrainHeight(x: number, z: number): number;
  roadNet: RoadNetwork;
  footNet: FootNetwork;
  signals: Signals;
  minimap: MinimapTexture;
  buildings: BuildingsBuild;
  roads: RoadsBuild;
  markings: MarkingsBuild;
  nature: NatureBuild | null;
  /** MegaKit facade modules (once the kit is loaded). */
  facades: FacadeBuild | null;
  /** Street furniture (once the prop models are loaded). */
  furniture: FurnitureBuild | null;
  spawns: readonly MapSpawn[];
  /** Adds trees + scatter once the nature models are loaded. */
  addNature(assets: NatureAssets): NatureBuild;
  /** Dresses the buildings with MegaKit modules once the kit is loaded. */
  addFacades(assets: MegakitAssets): FacadeBuild;
  /** Street lamps, benches, bins, bollards, planters, bike racks and cones. */
  addFurniture(props: PropAssets | null, megakit: MegakitAssets | null): FurnitureBuild;
  /** Where the campus centre is (attract camera, etc.). */
  centre: THREE.Vector3;
}

export function buildCampusWorld(
  scene: THREE.Scene,
  map: CampusMap,
  env: Environment,
  grid: CollisionGrid,
  shootables: ShootableRegistry,
  anisotropy: number,
): CampusWorld {
  const t = map.terrainGrid;
  const terrainHeight = (x: number, z: number) => meshHeightAt(t, x, z);
  const surface = createSurface(terrainHeight, map.roads);
  setGroundSampler(surface.height);
  setSurfaceLift(createSurfaceLift(map.roads));
  setWorldBounds(map.bounds);

  scene.add(buildTerrainMesh(map, anisotropy));
  const roads = buildRoads(map, terrainHeight, surface.decks, anisotropy);
  scene.add(roads.group);
  // Entrances face the nearest street or footway (not the sidewalks drawn along streets).
  const streetIndex = createRoadIndex(map.roads.filter((r) => r.footway !== "sidewalk" && r.class !== "steps"));
  const roadDistance = (x: number, z: number) => nearestRoadPoint(streetIndex, x, z, { maxDistance: 60 })?.distance ?? 60;
  const buildings = buildBuildings(map, grid, shootables, anisotropy, { terrainHeight, roadDistance });
  scene.add(buildings.group);
  for (const m of buildings.facadeMaterials) env.registerBuildingMat(m);
  const water = buildWater(map, terrainHeight);
  if (water) scene.add(water);
  const pitchLines = buildPitchLines(map, terrainHeight);
  if (pitchLines.mesh) scene.add(pitchLines.mesh);

  const roadNet = new RoadNetwork(map);
  const footNet = new FootNetwork(map);
  // Junction paint first: it tells the network (AI + signal poles) where each stop line is.
  const markings = buildMarkings(map, roadNet, terrainHeight, anisotropy);
  scene.add(markings.group);
  const signals = buildSignals(scene, roadNet, (x, z) => surface.height(x, z), grid);
  const minimap = buildMapTexture(map);

  const world: CampusWorld = {
    map,
    surface,
    terrainHeight,
    roadNet,
    footNet,
    signals,
    minimap,
    buildings,
    roads,
    markings,
    nature: null,
    facades: null,
    furniture: null,
    spawns: map.spawns,
    centre: new THREE.Vector3((map.bounds.minX + map.bounds.maxX) / 2, terrainHeight(0, 0), (map.bounds.minZ + map.bounds.maxZ) / 2),
    addNature(assets) {
      const n = buildNature(map, assets, terrainHeight, grid);
      scene.add(n.group);
      world.nature = n;
      return n;
    },
    addFurniture(props, megakit) {
      const f = buildFurniture(furniturePlacements(map, buildings), { props, megakit }, terrainHeight, grid, env);
      scene.add(f.group);
      world.furniture = f;
      return f;
    },
    addFacades(assets) {
      const f = buildFacades(buildings.facades, assets, anisotropy);
      scene.add(f.group);
      for (const m of f.lightMaterials) env.registerBuildingMat(m);
      world.facades = f;
      return f;
    },
  };
  return world;
}

/** Where the street furniture goes: placement rules + "not inside a building or on a carriageway". */
function furniturePlacements(map: CampusMap, buildings: BuildingsBuild): PropPlacement[] {
  const drivable = createRoadIndex(map.roads.filter((r) => isDrivable(r.class) && !r.bridge));
  const bIndex = createBuildingIndex(map.buildings);
  // Junction centres: graph nodes joined to three or more neighbours.
  const neighbours = new Map<number, Set<number>>();
  for (const e of map.graph.roadEdges) {
    for (const [a, b] of [
      [e.from, e.to],
      [e.to, e.from],
    ]) {
      let s = neighbours.get(a);
      if (!s) neighbours.set(a, (s = new Set()));
      s.add(b);
    }
  }
  const junctions: Vec2[] = [];
  neighbours.forEach((s, n) => {
    if (s.size >= 3) junctions.push(map.graph.nodes[n]);
  });
  const entrances = buildings.info
    .filter((b) => b.entrance && b.name && (b.category === "university" || b.category === "school"))
    .map((b) => ({ x: b.entrance![0], z: b.entrance![1], yaw: b.entranceYaw }));
  return placeFurniture(
    {
      roads: map.roads,
      campus: map.campus,
      junctions,
      entrances,
      parking: map.landuse.filter((l) => l.kind === "parking").map((l) => l.points),
      drivableDistance: (x, z) => nearestRoadPoint(drivable, x, z, { maxDistance: 30 })?.distance ?? 30,
    },
    (p) => {
      if (buildingAt(bIndex, p.x, p.z)) return true;
      const hit = nearestRoadPoint(drivable, p.x, p.z, { maxDistance: 12 });
      // Lamps stand just outside the kerb of their own street; everything else keeps off the carriageways.
      return hit !== null && hit.distance < map.roads[hit.road].width / 2 + (p.kind === "lamp" ? 0.3 : 0.6);
    },
  );
}
