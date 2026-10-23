// RigFactory implementations: GLB character models once assets are loaded,
// or the procedural box human when loading failed.

import type { CharacterAssets } from "../assets/characterAssets";
import type { RigFactory } from "./characterRig";
import { createModelRig } from "./modelRig";
import { createProceduralRig } from "./proceduralRig";

export function modelRigFactory(assets: CharacterAssets): RigFactory {
  return (spec) => createModelRig(assets, spec);
}

export const proceduralRigFactory: RigFactory = createProceduralRig;
