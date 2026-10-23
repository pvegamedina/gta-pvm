// Shared mutable accumulators filled while the city is built (buildings + street
// furniture both contribute trees/benches; parking lots and curb spots feed vehicle
// spawning). Kept in one place so build order stays easy to audit against the seed.

export interface TreeItem {
  x: number;
  z: number;
  s: number;
  y: number;
}
export interface BenchItem {
  x: number;
  z: number;
  ry: number;
}
export interface SlotItem {
  x: number;
  z: number;
  yaw: number;
}

export interface CityState {
  treeList: TreeItem[];
  benchList: BenchItem[];
  lotSlots: SlotItem[];
  streetSlots: SlotItem[];
}

export function createCityState(): CityState {
  return { treeList: [], benchList: [], lotSlots: [], streetSlots: [] };
}
