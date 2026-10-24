// Sky dome, sun/moon sprites, stars, clouds and the day/night light update.
// Ported from the legacy game's sky shader + updateEnv().
//
// Phase 5: the sun's orthographic shadow frustum is sized by the graphics
// preset (setShadows) and its centre is snapped to the shadow-map texel grid
// (world/shadowSnap.ts) so shadows don't shimmer while it follows the player;
// the clouds are one InstancedMesh (one draw call instead of ~50).

import * as THREE from "three";
import { lerp, smooth } from "../core/math";
import { radialTex } from "./materials";
import { snapShadowCentre, type V3 } from "./shadowSnap";

export interface EnvState {
  tod: number;
  nightF: number;
}

export interface BuildingLightMat {
  emissiveIntensity: number;
}

export interface Environment {
  scene: THREE.Scene;
  state: EnvState;
  /** `fy` is the ground height at the focus (the sun's shadow frustum follows it). */
  update(dt: number, fx: number, fz: number, camera: THREE.PerspectiveCamera, fy?: number): void;
  registerBuildingMat(m: BuildingLightMat): void;
  lightMats: { bulb: THREE.MeshBasicMaterial | null; pool: THREE.MeshBasicMaterial | null; head: THREE.MeshLambertMaterial | null };
  lightDir: THREE.Vector3;
  advanceHours(h: number): void;
  tickClockOnly(dt: number): void;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  carSpot: THREE.SpotLight;
  /** Graphics preset: sun shadows on/off, map resolution and frustum half size (m). */
  setShadows(enabled: boolean, mapSize: number, halfSize: number): void;
}

export function createEnvironment(scene: THREE.Scene): Environment {
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color(0x2f7fd8) }, bot: { value: new THREE.Color(0xbfdcf2) } },
    vertexShader: "varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
    fragmentShader:
      "uniform vec3 top;uniform vec3 bot;varying vec3 vP;void main(){float h=normalize(vP).y;float t=pow(max(h,0.0),0.55);gl_FragColor=vec4(mix(bot,top,t),1.0);}",
    side: THREE.BackSide,
    depthWrite: false,
  });
  const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 16), skyMat);
  skyMesh.frustumCulled = false;
  skyMesh.renderOrder = -10;
  scene.add(skyMesh);

  const sunSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: radialTex([
        [0, "rgba(255,255,235,1)"],
        [0.18, "rgba(255,248,210,1)"],
        [0.3, "rgba(255,220,150,0.5)"],
        [1, "rgba(255,190,100,0)"],
      ]),
      transparent: true,
      depthWrite: false,
      fog: false,
    }),
  );
  sunSprite.scale.set(240, 240, 1);
  sunSprite.renderOrder = -9;
  scene.add(sunSprite);

  const moonSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: radialTex([
        [0, "rgba(240,244,255,1)"],
        [0.3, "rgba(235,240,255,1)"],
        [0.36, "rgba(190,205,255,0.35)"],
        [1, "rgba(150,170,255,0)"],
      ]),
      transparent: true,
      depthWrite: false,
      fog: false,
    }),
  );
  moonSprite.scale.set(120, 120, 1);
  moonSprite.renderOrder = -9;
  scene.add(moonSprite);

  let stars: THREE.Points;
  {
    const n = 500;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2;
      const y = Math.random() * 0.95 + 0.05;
      const r2 = Math.sqrt(1 - y * y);
      arr[i * 3] = Math.cos(th) * r2 * 860;
      arr[i * 3 + 1] = y * 860;
      arr[i * 3 + 2] = Math.sin(th) * r2 * 860;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    stars = new THREE.Points(
      g,
      new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }),
    );
    stars.frustumCulled = false;
    stars.renderOrder = -9;
    scene.add(stars);
  }

  // Clouds: 12 clusters of 3-5 squashed spheres, all puffs in one InstancedMesh
  // (positions are per puff: cluster centre + offset; clusters drift along x).
  const CLOUDS = 12;
  const cloudX = new Float32Array(CLOUDS);
  const puffs: { cloud: number; ox: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [];
  for (let i = 0; i < CLOUDS; i++) {
    cloudX[i] = (Math.random() - 0.5) * 1300;
    const cy = 130 + Math.random() * 50;
    const cz = (Math.random() - 0.5) * 1300;
    const n = 3 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      puffs.push({ cloud: i, ox: k * 20 - n * 10, y: cy + Math.random() * 4, z: cz + Math.random() * 10, sx: 18 + Math.random() * 16, sy: 7 + Math.random() * 4, sz: 12 + Math.random() * 8 });
    }
  }
  const cloudMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshLambertMaterial({ color: 0xffffff, fog: false }), puffs.length);
  cloudMesh.name = "clouds";
  // Puffs span the sky and drift: skip culling (one draw call anyway).
  cloudMesh.frustumCulled = false;
  scene.add(cloudMesh);
  const cloudM = new THREE.Matrix4();
  const cloudQ = new THREE.Quaternion();
  const cloudP = new THREE.Vector3();
  const cloudS = new THREE.Vector3();
  function placeClouds(): void {
    puffs.forEach((p, i) => {
      cloudM.compose(cloudP.set(cloudX[p.cloud] + p.ox, p.y, p.z), cloudQ, cloudS.set(p.sx, p.sy, p.sz));
      cloudMesh.setMatrixAt(i, cloudM);
    });
    cloudMesh.instanceMatrix.needsUpdate = true;
  }
  placeClouds();

  const cTopDay = new THREE.Color(0x2f7fd8);
  const cBotDay = new THREE.Color(0xbfdcf2);
  const cTopNight = new THREE.Color(0x02030c);
  const cBotNight = new THREE.Color(0x0a1224);
  const cTw = new THREE.Color(0xff8f4a);
  const cTwTop = new THREE.Color(0x5a4a8a);
  const hSkyDay = new THREE.Color(0xbfd9ff);
  const hSkyNight = new THREE.Color(0x2a3a66);
  const hGDay = new THREE.Color(0x6b6a55);
  const hGNight = new THREE.Color(0x10131c);
  const sunLow = new THREE.Color(0xffd0a0);
  const sunHigh = new THREE.Color(0xffffff);
  const moonCol = new THREE.Color(0x9fb4ff);

  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x6b6a55, 0.7 * Math.PI);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1 * Math.PI);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  {
    const s = sun.shadow.camera;
    // Shadow frustum (m) centred on the player and moved with them every frame.
    s.left = -80;
    s.right = 80;
    s.top = 80;
    s.bottom = -80;
    s.near = 1;
    s.far = 500;
  }
  sun.shadow.bias = -0.0006;
  // Layer 1 = shadow-only casters (vehicle shadow proxies, vehicles/meshes.ts SHADOW_ONLY_LAYER).
  sun.shadow.camera.layers.enable(1);
  scene.add(sun);
  scene.add(sun.target);
  /** Shadow-map texel size (m): frustum width / map resolution (texel snapping). */
  let shadowTexel = 160 / 2048;
  const focus: V3 = { x: 0, y: 0, z: 0 };
  const snapped: V3 = { x: 0, y: 0, z: 0 };

  function setShadows(enabled: boolean, mapSize: number, halfSize: number): void {
    sun.castShadow = enabled;
    const s = sun.shadow.camera;
    if (s.right !== halfSize) {
      s.left = -halfSize;
      s.right = halfSize;
      s.top = halfSize;
      s.bottom = -halfSize;
      s.updateProjectionMatrix();
    }
    if (sun.shadow.mapSize.x !== mapSize) {
      sun.shadow.mapSize.set(mapSize, mapSize);
      // three re-creates the render target at the new size when the map is gone.
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    shadowTexel = (2 * halfSize) / mapSize;
  }

  const carSpot = new THREE.SpotLight(0xfff2cc, 0, 70, 0.5, 0.5, 1);
  carSpot.decay = 1;
  scene.add(carSpot);
  scene.add(carSpot.target);

  const bMats: BuildingLightMat[] = [];
  const lightMats: Environment["lightMats"] = { bulb: null, pool: null, head: null };
  const lightDir = new THREE.Vector3();

  const state: EnvState = { tod: 9.5, nightF: 0 };
  let lt = 0;

  function update(dt: number, fx: number, fz: number, camera: THREE.PerspectiveCamera, fy = 0) {
    lt += dt;
    state.tod = (state.tod + dt * (24 / 480)) % 24;
    const a = ((state.tod - 6) / 24) * Math.PI * 2;
    const sunH = Math.sin(a);
    const sv = new THREE.Vector3(Math.cos(a) * 0.85, sunH, 0.45).normalize();
    const d = smooth(-0.08, 0.3, sunH);
    const tw = Math.exp(-Math.pow(sunH / 0.18, 2));
    skyMat.uniforms.top.value.copy(cTopNight).lerp(cTopDay, d).lerp(cTwTop, tw * 0.5);
    skyMat.uniforms.bot.value.copy(cBotNight).lerp(cBotDay, d).lerp(cTw, tw * 0.75);
    scene.fog && (scene.fog as THREE.Fog).color.copy(skyMat.uniforms.bot.value);
    state.nightF = 1 - smooth(-0.14, 0.12, sunH);
    hemi.color.copy(hSkyNight).lerp(hSkyDay, d);
    hemi.groundColor.copy(hGNight).lerp(hGDay, d);
    hemi.intensity = lerp(0.4, 0.7, d) * Math.PI;
    lightDir.copy(sunH >= 0 ? sv : sv.clone().negate());
    lightDir.y = Math.max(lightDir.y, 0.28);
    lightDir.normalize();
    if (sunH >= 0) {
      sun.color.copy(sunLow).lerp(sunHigh, smooth(0, 0.5, sunH));
      sun.intensity = 1.2 * smooth(-0.02, 0.25, sunH) * Math.PI;
    } else {
      sun.color.copy(moonCol);
      sun.intensity = 0.3 * smooth(-0.02, 0.2, -sunH) * Math.PI;
    }
    // Follow the focus, snapped to whole shadow texels (no shimmering edges).
    focus.x = fx;
    focus.y = fy;
    focus.z = fz;
    snapShadowCentre(focus, lightDir, shadowTexel, snapped);
    sun.target.position.set(snapped.x, snapped.y, snapped.z);
    sun.position.set(snapped.x + lightDir.x * 200, snapped.y + lightDir.y * 200, snapped.z + lightDir.z * 200);
    skyMesh.position.copy(camera.position);
    sunSprite.position.copy(camera.position).addScaledVector(sv, 800);
    sunSprite.visible = sunH > -0.06;
    moonSprite.position.copy(camera.position).addScaledVector(sv, -800);
    moonSprite.visible = sunH < 0.06;
    stars.position.copy(camera.position);
    (stars.material as THREE.PointsMaterial).opacity = state.nightF;
    for (let i = 0; i < bMats.length; i++) bMats[i].emissiveIntensity = state.nightF * 1.1;
    if (lightMats.bulb) lightMats.bulb.color.setRGB(lerp(0.55, 1, state.nightF), lerp(0.55, 0.95, state.nightF), lerp(0.5, 0.75, state.nightF));
    if (lightMats.pool) lightMats.pool.opacity = state.nightF * 0.8;
    if (lightMats.head) lightMats.head.emissiveIntensity = 0.25 + state.nightF * 1.4;
    if (dt > 0) {
      for (let i = 0; i < CLOUDS; i++) {
        cloudX[i] += dt * 3;
        if (cloudX[i] > 700) cloudX[i] = -700;
      }
      placeClouds();
    }
  }

  return {
    scene,
    state,
    update,
    registerBuildingMat: (m) => bMats.push(m),
    lightMats,
    lightDir,
    advanceHours: (h) => {
      state.tod = (state.tod + h) % 24;
    },
    tickClockOnly: (dt) => {
      state.tod = (state.tod + dt * 0.15) % 24;
    },
    sun,
    hemi,
    carSpot,
    setShadows,
  };
}
