// Renders a ParticleBuffer (vfx/particles.ts) as ONE THREE.Points draw call:
// soft round sprites with per-particle world size, opacity and colour (a
// tiny ShaderMaterial with the scene fog), alpha-blended, no depth writes.
// The buffer's typed arrays are the attribute arrays, so a frame costs one
// upload and no allocation. Used for exhaust smoke and dust.

import * as THREE from "three";
import { radialTex } from "../world/materials";
import { ParticleBuffer, type ParticleLook } from "./particles";

const VERT = /* glsl */ `
attribute float size;
attribute float alpha;
attribute vec3 color;
uniform float uScale;
varying float vAlpha;
varying vec3 vColor;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = alpha > 0.0 ? size * uScale / max(0.1, -mvPosition.z) : 0.0;
  vAlpha = alpha;
  vColor = color;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
uniform sampler2D map;
varying float vAlpha;
varying vec3 vColor;
#include <fog_pars_fragment>
void main() {
  float a = texture2D(map, gl_PointCoord).a * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor, a);
  #include <fog_fragment>
}`;

export class ParticleSystem {
  readonly points: THREE.Points;
  readonly buffer: ParticleBuffer;
  private readonly material: THREE.ShaderMaterial;
  private readonly attrs: THREE.BufferAttribute[];

  constructor(
    capacity: number,
    /** Velocity damping (1/s) and upward acceleration (m/s²) of every particle. */
    private readonly drag = 1.2,
    private readonly buoyancy = 0.6,
  ) {
    this.buffer = new ParticleBuffer(capacity);
    const g = new THREE.BufferGeometry();
    const b = this.buffer;
    this.attrs = [
      new THREE.BufferAttribute(b.position, 3).setUsage(THREE.DynamicDrawUsage),
      new THREE.BufferAttribute(b.size, 1).setUsage(THREE.DynamicDrawUsage),
      new THREE.BufferAttribute(b.alpha, 1).setUsage(THREE.DynamicDrawUsage),
      new THREE.BufferAttribute(b.color, 3).setUsage(THREE.DynamicDrawUsage),
    ];
    g.setAttribute("position", this.attrs[0]);
    g.setAttribute("size", this.attrs[1]);
    g.setAttribute("alpha", this.attrs[2]);
    g.setAttribute("color", this.attrs[3]);
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 400 }, map: { value: null } }]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.material.uniforms.map.value = radialTex([
      [0, "rgba(255,255,255,1)"],
      [0.45, "rgba(255,255,255,0.55)"],
      [1, "rgba(255,255,255,0)"],
    ]);
    this.points = new THREE.Points(g, this.material);
    // Particles roam with the cars: no stale bounding sphere culling.
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    this.points.name = "vfx:particles";
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, look: ParticleLook): void {
    this.buffer.spawn(x, y, z, vx, vy, vz, look);
  }

  /** Simulates and uploads; `viewportHeight` (px) and the camera FOV size the sprites. */
  update(dt: number, camera: THREE.PerspectiveCamera, viewportHeight: number): void {
    this.material.uniforms.uScale.value = viewportHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const wasAlive = this.buffer.alive() > 0;
    this.buffer.step(dt, this.drag, this.buoyancy);
    // Nothing alive before or after: nothing changed on the GPU side.
    if (!wasAlive && this.buffer.alive() === 0) {
      this.points.visible = false;
      return;
    }
    this.points.visible = true;
    for (const a of this.attrs) a.needsUpdate = true;
  }

  clear(): void {
    this.buffer.clear();
    for (const a of this.attrs) a.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.uniforms.map.value?.dispose();
    this.material.dispose();
  }
}
