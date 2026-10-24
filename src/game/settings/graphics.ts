// Applies a graphics preset (graphicsPresets.ts) to the live renderer and
// scene, without a reload: pixel ratio, sun shadows (map size + frustum),
// fog range, camera far plane and the global LOD distance scale.

import * as THREE from "three";
import type { Environment } from "../world/environment";
import { setViewScale } from "../world/lod";
import { cameraFar, type GraphicsConfig } from "./graphicsPresets";

export interface GraphicsTargets {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  env: Environment;
}

export function applyGraphics(cfg: GraphicsConfig, t: GraphicsTargets): void {
  const { renderer, scene, camera, env } = t;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cfg.pixelRatioCap));
  const shadowsChanged = renderer.shadowMap.enabled !== cfg.shadows;
  renderer.shadowMap.enabled = cfg.shadows;
  env.setShadows(cfg.shadows, cfg.shadowMapSize, cfg.shadowHalfSize);
  if (shadowsChanged) {
    // Shadow receiving is compiled into the shaders: rebuild them once.
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
    });
  }
  const fog = scene.fog as THREE.Fog | null;
  if (fog) {
    fog.near = cfg.fogNear;
    fog.far = cfg.fogFar;
  }
  camera.far = cameraFar(cfg);
  camera.updateProjectionMatrix();
  setViewScale(cfg.viewScale);
}
