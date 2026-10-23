// Sky dome, sun/moon sprites, stars, clouds and the day/night light update.
// Ported from the legacy game's sky shader + updateEnv().

import * as THREE from "three";
import { lerp, smooth } from "../core/math";
import { radialTex } from "./materials";

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
  update(dt: number, fx: number, fz: number, camera: THREE.PerspectiveCamera): void;
  registerBuildingMat(m: THREE.MeshLambertMaterial): void;
  lightMats: { bulb: THREE.MeshBasicMaterial | null; pool: THREE.MeshBasicMaterial | null; head: THREE.MeshLambertMaterial | null };
  lightDir: THREE.Vector3;
  advanceHours(h: number): void;
  tickClockOnly(dt: number): void;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  carSpot: THREE.SpotLight;
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

  const clouds: THREE.Group[] = [];
  {
    const sg = new THREE.SphereGeometry(1, 8, 6);
    const cm = new THREE.MeshLambertMaterial({ color: 0xffffff, fog: false });
    for (let i = 0; i < 12; i++) {
      const g = new THREE.Group();
      const n = 3 + Math.floor(Math.random() * 3);
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(sg, cm);
        m.scale.set(18 + Math.random() * 16, 7 + Math.random() * 4, 12 + Math.random() * 8);
        m.position.set(k * 20 - n * 10, Math.random() * 4, Math.random() * 10);
        g.add(m);
      }
      g.position.set((Math.random() - 0.5) * 1300, 130 + Math.random() * 50, (Math.random() - 0.5) * 1300);
      scene.add(g);
      clouds.push(g);
    }
  }

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
    s.left = -70;
    s.right = 70;
    s.top = 70;
    s.bottom = -70;
    s.near = 1;
    s.far = 500;
  }
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(sun.target);

  const carSpot = new THREE.SpotLight(0xfff2cc, 0, 70, 0.5, 0.5, 1);
  carSpot.decay = 1;
  scene.add(carSpot);
  scene.add(carSpot.target);

  const bMats: THREE.MeshLambertMaterial[] = [];
  const lightMats: Environment["lightMats"] = { bulb: null, pool: null, head: null };
  const lightDir = new THREE.Vector3();

  const state: EnvState = { tod: 9.5, nightF: 0 };
  let lt = 0;

  function update(dt: number, fx: number, fz: number, camera: THREE.PerspectiveCamera) {
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
    sun.target.position.set(fx, 0, fz);
    sun.position.set(fx + lightDir.x * 200, lightDir.y * 200, fz + lightDir.z * 200);
    skyMesh.position.copy(camera.position);
    sunSprite.position.copy(camera.position).addScaledVector(sv, 800);
    sunSprite.visible = sunH > -0.06;
    moonSprite.position.copy(camera.position).addScaledVector(sv, -800);
    moonSprite.visible = sunH < 0.06;
    stars.position.copy(camera.position);
    (stars.material as THREE.PointsMaterial).opacity = state.nightF;
    for (let i = 0; i < bMats.length; i++) bMats[i].emissiveIntensity = state.nightF * 1.1;
    if (lightMats.bulb) lightMats.bulb.color.setRGB(lerp(0.55, 1, state.nightF), lerp(0.55, 0.95, state.nightF), lerp(0.5, 0.75, state.nightF));
    if (lightMats.pool) lightMats.pool.opacity = state.nightF * 0.55;
    if (lightMats.head) lightMats.head.emissiveIntensity = 0.25 + state.nightF * 1.4;
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i];
      c.position.x += dt * 3;
      if (c.position.x > 700) c.position.x = -700;
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
  };
}

export function lightState(tod: number, axis: 0 | 1): "R" | "Y" | "G" {
  const t = tod % 24;
  if (axis === 0) {
    if (t < 9) return "G";
    if (t < 10.5) return "Y";
    return "R";
  }
  if (t >= 12 && t < 21) return "G";
  if (t >= 21 && t < 22.5) return "Y";
  return "R";
}
