// Builds the playable Campus de El Carmen from the loaded map: terrain,
// roads, buildings, water, traffic lights and (once its models arrive)
// vegetation; installs the ground sampler every gameplay system uses; and
// exposes the road / foot networks for traffic and pedestrians.

import * as THREE from "three";
import type { CampusMap } from "../../map/loader";
import type { MapSpawn } from "../../map/types";
import { setGroundSampler, setWorldBounds } from "../ground";
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
  nature: NatureBuild | null;
  spawns: readonly MapSpawn[];
  /** Adds trees + scatter once the nature models are loaded. */
  addNature(assets: NatureAssets): NatureBuild;
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
  setWorldBounds(map.bounds);

  scene.add(buildTerrainMesh(map, anisotropy));
  const roads = buildRoads(map, terrainHeight, surface.decks, anisotropy);
  scene.add(roads.group);
  const buildings = buildBuildings(map, grid, shootables, anisotropy);
  scene.add(buildings.group);
  for (const m of buildings.facadeMaterials) env.registerBuildingMat(m);
  const water = buildWater(map, terrainHeight);
  if (water) scene.add(water);

  const roadNet = new RoadNetwork(map);
  const footNet = new FootNetwork(map);
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
    nature: null,
    spawns: map.spawns,
    centre: new THREE.Vector3((map.bounds.minX + map.bounds.maxX) / 2, terrainHeight(0, 0), (map.bounds.minZ + map.bounds.maxZ) / 2),
    addNature(assets) {
      const n = buildNature(map, assets, terrainHeight, grid);
      scene.add(n.group);
      world.nature = n;
      return n;
    },
  };
  return world;
}
