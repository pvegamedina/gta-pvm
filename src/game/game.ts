// Engine entry point: builds the scene/city, wires input, physics, combat,
// health, HUD and networking, and runs the fixed-step game loop. Mirrors the
// legacy single-file game's structure, split across src/game/** modules.

import * as THREE from "three";
import {
  WEAPONS,
  WEAPON_ORDER,
  SPAWN_POINTS,
  MAX_HEALTH,
  RESPAWN_DELAY_MS,
  MAX_NAME_LENGTH,
  type WeaponId,
  type PlayerMotion,
  type ServerMessage,
} from "@shared/protocol";

import { STEP } from "./core/constants";
import { createRng, WORLD_SEED } from "./core/rng";
import { clamp } from "./core/math";

import { CollisionGrid } from "./world/colliders";
import { createCityState } from "./world/cityState";
import { createEnvironment } from "./world/environment";
import { buildGround } from "./world/ground";
import { buildBlocks } from "./world/buildings";
import { buildSignals } from "./world/signals";
import { buildStreet, buildScenery } from "./world/street";
import { buildMapTexture, drawMinimap, type MinimapDot } from "./world/minimap";

import { visualVeh, removeVeh, type Vehicle } from "./vehicles/meshes";
import { spawnVehicles, updateAI } from "./vehicles/traffic";
import { updatePlayerCar } from "./vehicles/playerCar";

import { makeHuman } from "./player/human";
import { createPlayerState, type PlayerState } from "./player/playerState";
import { updateFoot, footSpeed } from "./player/foot";
import { nearestVehicle, enterCar, exitCar, forceExitCar } from "./player/enterExit";

import { spawnPeds, updatePeds, hitPed, spookPedsNear, type Ped } from "./pedestrians/peds";

import { createCameraState, snapCamera, updateCamera } from "./camera/camera";
import { createAudioSystem } from "./audio/audio";

import { tickWeapon, tryFire, tryMelee, startReload, nextWeapon, totalSpread } from "./combat/weapons";
import { applyDamage, tickRegen, respawn as respawnHealth, vehicleHitDamage, crashDamage, VEHICLE_HIT_SPEED_THRESHOLD } from "./combat/health";
import { createEffectsSystem } from "./combat/effects";
import { ShootableRegistry, castShot } from "./combat/shootables";
import { setHeldWeapon, applyAimPose, type WeaponMeshHandle } from "./combat/weaponMesh";

import { NetClient, defaultServerUrl } from "./net/client";
import { RemotePlayerManager } from "./net/remotePlayers";

import { Hud } from "./hud/hud";

export interface GameHandle {
  dispose(): void;
}

const $ = (id: string) => document.getElementById(id);

function loadName(): string {
  try {
    const n = localStorage.getItem("gta-pvm:name");
    if (n && n.trim()) return n.slice(0, MAX_NAME_LENGTH);
  } catch {
    // localStorage unavailable (private mode, etc.)
  }
  return "Jugador" + Math.floor(Math.random() * 1000);
}

function saveName(n: string): void {
  try {
    localStorage.setItem("gta-pvm:name", n);
  } catch {
    // ignore
  }
}

export function createGame(): GameHandle {
  THREE.ColorManagement.enabled = false;

  const canvas = $("c") as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  // r186 deprecated PCFSoftShadowMap in favor of PCFShadowMap (same soft-shadow behavior).
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xbfdcf2, 120, 900);
  const camera = new THREE.PerspectiveCamera(65, 1, 0.5, 2500);

  const env = createEnvironment(scene);
  const grid = new CollisionGrid();
  const city = createCityState();
  const shootables = new ShootableRegistry();
  const rng = createRng(WORLD_SEED);

  // World build — rng() call order must match the legacy game exactly.
  buildGround(scene);
  buildBlocks(scene, rng, grid, city, env, shootables);
  const signals = buildSignals(scene, grid);
  buildStreet(scene, rng, grid, city, env);
  buildScenery(scene);
  const mapTexture = buildMapTexture();

  const vehicles: Vehicle[] = [];
  spawnVehicles(scene, vehicles, city);
  for (const v of vehicles) shootables.add(v.root, { kind: "vehicle", refId: v });

  let peds: Ped[] = spawnPeds(scene, 32);
  for (const p of peds) shootables.add(p.mesh.group, { kind: "ped", refId: p });

  const playerMesh = makeHuman({ skin: 0xe0ac84, shirt: 0xd9442b, pants: 0x2b3a55, hair: 0x2a1c14, shoe: 0xf0f0f0 });
  playerMesh.group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  scene.add(playerMesh.group);
  const player: PlayerState = createPlayerState(playerMesh, 21, 10.2, 2.3);
  let heldWeaponMesh: WeaponMeshHandle | null = null;

  const cam = createCameraState(2.3);
  const audio = createAudioSystem();
  const effects = createEffectsSystem(scene, audio);
  const remotePlayers = new RemotePlayerManager(scene, shootables);
  const hud = new Hud();
  const miniCtx = ($("mini") as HTMLCanvasElement).getContext("2d")!;

  // ---------------- Networking ----------------
  let myId: string | null = null;
  let myName = loadName();
  let pendingSpawn: { x: number; z: number; yaw: number } | null = null;
  let localPing = 0;
  let localKills = 0;
  let localDeaths = 0;

  const nameInput = $("nameInput") as HTMLInputElement | null;
  if (nameInput) nameInput.value = myName;

  const net = new NetClient(defaultServerUrl(), myName, {
    onStatus: (status, count) => {
      if (status === "connecting") hud.setServerStatus("Conectando…", "");
      else if (status === "online") hud.setServerStatus(`En línea · ${count} jugador${count === 1 ? "" : "es"}`, "online");
      else hud.setServerStatus("Sin conexión — modo un jugador", "offline");
    },
    onMessage: handleServerMessage,
  });
  net.connect();
  net.setMotionSource(buildMotion);

  function buildMotion(): PlayerMotion {
    return {
      p: [player.x, player.y, player.z],
      yaw: player.yaw,
      speed: footSpeed(player),
      ground: player.ground,
      weapon: player.weapon,
      aiming: player.aiming,
      car: player.car
        ? { type: player.car.type, color: player.car.color, yaw: player.car.yaw, speed: player.car.speed, steer: player.car.steerVis }
        : null,
    };
  }

  function handleServerMessage(msg: ServerMessage): void {
    switch (msg.t) {
      case "welcome": {
        myId = msg.id;
        pendingSpawn = msg.spawn;
        for (const p of msg.players) remotePlayers.add(p);
        break;
      }
      case "playerJoined":
        remotePlayers.add(msg.player);
        break;
      case "playerLeft":
        remotePlayers.remove(msg.id);
        break;
      case "states":
        for (const s of msg.players) {
          if (s.id === myId) continue;
          remotePlayers.pushMotion(s.id, s.motion);
        }
        break;
      case "shot": {
        if (msg.shooterId === myId) break;
        const origin = new THREE.Vector3(msg.origin[0], msg.origin[1], msg.origin[2]);
        const end = new THREE.Vector3(msg.end[0], msg.end[1], msg.end[2]);
        effects.muzzleFlash(origin);
        effects.tracer(origin, end);
        if (msg.hit) effects.impactSpark(end);
        const dist = origin.distanceTo(camera.position);
        effects.gunshot(msg.weapon, dist);
        break;
      }
      case "health": {
        if (msg.id === myId) {
          player.health = msg.health;
          player.alive = msg.health > 0;
          if (msg.attackerId) hud.flashDamage();
        } else {
          remotePlayers.setHealth(msg.id, msg.health, msg.health > 0);
        }
        break;
      }
      case "killed": {
        const killerName = msg.killerId ? remotePlayers.get(msg.killerId)?.name ?? (msg.killerId === myId ? myName : "???") : null;
        const victimName = msg.victimId === myId ? myName : remotePlayers.get(msg.victimId)?.name ?? "???";
        hud.pushKillFeed({ killer: killerName ?? "Mundo", victim: victimName, weapon: msg.weapon ? WEAPONS[msg.weapon].name : msg.cause ?? "" });
        if (msg.victimId === myId) onLocalDeath(killerName);
        break;
      }
      case "respawned": {
        if (msg.id === myId) {
          teleportPlayer(msg.spawn.x, msg.spawn.z, msg.spawn.yaw);
          respawnHealth(player);
          player.health = msg.health;
          refillAmmo();
          hud.hideDeathOverlay();
          deathAt = null;
        }
        break;
      }
      case "scores": {
        remotePlayers.setScores(msg.players);
        const mine = msg.players.find((p) => p.id === myId);
        if (mine) {
          localKills = mine.kills;
          localDeaths = mine.deaths;
        }
        break;
      }
      case "pong":
        localPing = Math.max(0, Math.round(performance.now() - msg.ts));
        break;
      default:
        break;
    }
  }

  function refillAmmo(): void {
    for (const id of WEAPON_ORDER) {
      player.ammo[id].mag = WEAPONS[id].magSize;
      player.ammo[id].reserve = WEAPONS[id].reserve;
      player.ammo[id].reloading = false;
      player.ammo[id].reloadT = 0;
      player.ammo[id].spread = 0;
    }
  }

  function teleportPlayer(x: number, z: number, yaw: number): void {
    if (player.car) forceExitCar(player, grid, vehicles);
    player.x = x;
    player.z = z;
    player.yaw = yaw;
    player.y = 0.25;
    player.vx = player.vz = player.vy = 0;
    player.ground = true;
    player.mesh.group.rotation.set(0, yaw, 0);
    player.mesh.group.position.set(x, player.y, z);
    snapCamera(cam, player);
  }

  // ---------------- Input ----------------
  const keys: Record<string, boolean> = {};
  let playing = false;
  let paused = false;
  let started = false;
  let soundOn = true;
  let tClock = 0;
  let dragging = false;
  let firingHeld = false;
  let aimingHeld = false;
  let fireEdgeConsumed = false;
  let deathAt: number | null = null;
  let killerAtDeath: string | null = null;

  function lockPointer(): void {
    try {
      const r = canvas.requestPointerLock();
      if (r && (r as Promise<void>).catch) (r as Promise<void>).catch(() => {});
    } catch {
      // ignore
    }
  }

  function resize(): void {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }

  function toast(m: string): void {
    hud.toast(m);
  }

  function onLocalDeath(killer: string | null): void {
    if (deathAt !== null) return;
    deathAt = tClock;
    killerAtDeath = killer;
    if (player.car) forceExitCar(player, grid, vehicles);
    player.firing = false;
    player.aiming = false;
  }

  function resetGame(): void {
    player.mode = "foot";
    player.car = null;
    const spawn = pendingSpawn || { x: 21, z: 10.2, yaw: 2.3 };
    player.x = spawn.x;
    player.z = spawn.z;
    player.y = 0.25;
    player.yaw = spawn.yaw;
    player.vx = player.vz = player.vy = 0;
    player.ground = true;
    player.mesh.group.visible = true;
    player.health = MAX_HEALTH;
    player.alive = true;
    player.lastDamageAt = -Infinity;
    player.weapon = "fists";
    player.aiming = false;
    player.firing = false;
    refillAmmo();
    deathAt = null;
    hud.hideDeathOverlay();
    env.state.tod = 9.5;
    for (const v of vehicles) removeVeh(scene, v);
    vehicles.length = 0;
    spawnVehicles(scene, vehicles, city);
    for (const v of vehicles) shootables.add(v.root, { kind: "vehicle", refId: v });
    for (const p of peds) {
      scene.remove(p.mesh.group);
      shootables.remove(p.mesh.group);
    }
    peds = spawnPeds(scene, 32);
    for (const p of peds) shootables.add(p.mesh.group, { kind: "ped", refId: p });
    player.mesh.group.position.set(player.x, player.y, player.z);
    player.mesh.group.rotation.set(0, player.yaw, 0);
    cam.yaw = player.yaw;
    cam.pitch = 0.3;
    env.carSpot.intensity = 0;
    snapCamera(cam, player);
    hud.setMode("A PIE", false);
  }

  function startGame(): void {
    audio.init();
    if (audio.ctx && audio.ctx.resume) audio.ctx.resume();
    const nm = (nameInput?.value || "").trim().slice(0, MAX_NAME_LENGTH);
    if (nm) {
      myName = nm;
      saveName(nm);
    }
    started = true;
    playing = true;
    paused = false;
    $("start")?.classList.add("hidden");
    $("pause")?.classList.add("hidden");
    hud.setHudVisible(true);
    resetGame();
    lockPointer();
  }

  function pauseGame(): void {
    if (!playing || paused) return;
    paused = true;
    $("pause")?.classList.remove("hidden");
    for (const k in keys) keys[k] = false;
    if (document.exitPointerLock) document.exitPointerLock();
  }

  function resumeGame(): void {
    if (!playing || !paused) return;
    paused = false;
    $("pause")?.classList.add("hidden");
    lockPointer();
  }

  function restartGame(): void {
    resetGame();
    if (paused) resumeGame();
    toast("Partida reiniciada");
  }

  function interact(): void {
    if (player.mode === "car") {
      if (!exitCar(player, grid, vehicles)) toast("Frena para poder salir");
      return;
    }
    const v = nearestVehicle(player, vehicles);
    if (v) enterCar(player, v);
  }

  function switchWeapon(w: WeaponId): void {
    if (player.weapon === w) return;
    player.weapon = w;
    heldWeaponMesh = setHeldWeapon(player.mesh, heldWeaponMesh, w);
  }

  // ---------------- Combat ----------------
  const MUZZLE_OFFSET = new THREE.Vector3();
  function fireWeapon(): void {
    if (!player.alive || player.mode === "car") return;
    const id = player.weapon;
    if (id === "fists") {
      const ammo = player.ammo.fists;
      if (!tryMelee(ammo, WEAPONS.fists)) return;
      const dir = camera.getWorldDirection(new THREE.Vector3());
      const origin = camera.position.clone();
      const res = castShot(origin, dir, WEAPONS.fists.range, shootables, 0.3);
      if (res.hit && (res.hit.kind === "ped" || res.hit.kind === "remotePlayer")) {
        if (res.hit.kind === "ped") hitPed(res.hit.refId as Ped);
        else {
          hud.hitMarker();
          net.send({ t: "shoot", weapon: "fists", origin: [origin.x, origin.y, origin.z], end: [res.point.x, res.point.y, res.point.z], targetId: String(res.hit.refId) });
        }
      }
      return;
    }
    const spec = WEAPONS[id];
    const ammo = player.ammo[id];
    const result = tryFire(ammo, spec);
    if (result.dryClick) {
      effects.dryClick();
      return;
    }
    if (result.startedReload && !result.fired) {
      effects.reloadSound(id);
      return;
    }
    if (!result.fired) return;
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const spread = totalSpread(spec, ammo);
    if (spread > 0) {
      dir.x += (Math.random() - 0.5) * spread;
      dir.y += (Math.random() - 0.5) * spread;
      dir.z += (Math.random() - 0.5) * spread;
      dir.normalize();
    }
    const origin = camera.position.clone();
    const res = castShot(origin, dir, spec.range, shootables, 0.3);
    effects.muzzleFlash(origin.clone().addScaledVector(dir, 0.3));
    effects.tracer(origin, res.point);
    effects.gunshot(id, 0);
    cam.shake = Math.min(1, cam.shake + (id === "m4" ? 0.08 : 0.12));
    let targetId: string | null = null;
    let hitSomething = false;
    if (res.hit) {
      hitSomething = true;
      effects.impactSpark(res.point);
      if (res.hit.kind === "ped") {
        hitPed(res.hit.refId as Ped);
        spookPedsNear(peds, res.point.x, res.point.z, 14);
      } else if (res.hit.kind === "remotePlayer") {
        targetId = String(res.hit.refId);
        hud.hitMarker();
      } else if (res.hit.kind === "remoteCar") {
        hud.hitMarker();
      }
    }
    net.send({ t: "shoot", weapon: id, origin: [origin.x, origin.y, origin.z], end: [res.point.x, res.point.y, res.point.z], targetId });
    void hitSomething;
    if (result.startedReload) effects.reloadSound(id);
  }

  function manualReload(): void {
    if (player.weapon === "fists" || player.mode === "car") return;
    const ammo = player.ammo[player.weapon];
    if (startReload(ammo, WEAPONS[player.weapon])) effects.reloadSound(player.weapon);
  }

  // ---------------- Event wiring ----------------
  const onResize = () => resize();
  const onBlur = () => {
    for (const k in keys) keys[k] = false;
    firingHeld = false;
    aimingHeld = false;
  };
  const onVisibility = () => {
    if (document.hidden) pauseGame();
  };
  const onPointerLockChange = () => {
    if (!document.pointerLockElement && playing && !paused) pauseGame();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (!playing) return;
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].indexOf(e.code) >= 0) e.preventDefault();
    if (e.code === "Escape") {
      pauseGame();
      return;
    }
    if (e.code === "KeyP") {
      if (!e.repeat) {
        if (paused) resumeGame();
        else pauseGame();
      }
      return;
    }
    if (e.code === "Tab") {
      hud.setScoreboardVisible(true);
      return;
    }
    if (paused) return;
    keys[e.code] = true;
    if (e.repeat) return;
    if (e.code === "KeyE") interact();
    else if (e.code === "KeyH" && player.mode === "car") audio.horn();
    else if (e.code === "KeyN") {
      env.advanceHours(6);
      toast("Hora: " + Math.floor(env.state.tod) + ":00");
    } else if (e.code === "Digit1") switchWeapon("fists");
    else if (e.code === "Digit2") switchWeapon("pistol");
    else if (e.code === "Digit3") switchWeapon("m4");
    else if (e.code === "KeyQ") switchWeapon(nextWeapon(player.weapon));
    else if (e.code === "KeyR") manualReload();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    keys[e.code] = false;
    if (e.code === "Tab") hud.setScoreboardVisible(false);
  };
  const onMouseDown = (e: MouseEvent) => {
    dragging = true;
    if (playing && !paused && !document.pointerLockElement) lockPointer();
    if (!playing || paused) return;
    if (e.button === 0) {
      firingHeld = true;
      fireEdgeConsumed = false;
    } else if (e.button === 2) {
      aimingHeld = true;
    }
  };
  const onMouseUp = (e: MouseEvent) => {
    dragging = false;
    if (e.button === 0) firingHeld = false;
    else if (e.button === 2) aimingHeld = false;
  };
  const onContextMenu = (e: MouseEvent) => e.preventDefault();
  const onMouseMove = (e: MouseEvent) => {
    if (!playing || paused) return;
    if (document.pointerLockElement !== canvas && !dragging) return;
    cam.yaw -= (e.movementX || 0) * 0.0022;
    cam.pitch = clamp(cam.pitch + (e.movementY || 0) * 0.0018, -0.15, 1.2);
    cam.lastMouse = tClock;
  };
  const onWheel = (e: WheelEvent) => {
    if (playing && !paused) cam.zoom = clamp(cam.zoom + Math.sign(e.deltaY) * 0.1, 0.6, 1.8);
  };

  const btnPlay = $("btnPlay");
  const btnPause = $("btnPause");
  const btnResume = $("btnResume");
  const btnRestart = $("btnRestart");
  const btnRestart2 = $("btnRestart2");
  const btnSound = $("btnSound");
  const onPlayClick = () => startGame();
  const onPauseClick = () => (paused ? resumeGame() : pauseGame());
  const onResumeClick = () => resumeGame();
  const onRestartClick = () => restartGame();
  const onSoundClick = () => {
    soundOn = !soundOn;
    audio.soundOn = soundOn;
    if (btnSound) btnSound.textContent = soundOn ? "🔊 Sonido: sí" : "🔇 Sonido: no";
  };

  btnPlay?.addEventListener("click", onPlayClick);
  btnPause?.addEventListener("click", onPauseClick);
  btnResume?.addEventListener("click", onResumeClick);
  btnRestart?.addEventListener("click", onRestartClick);
  btnRestart2?.addEventListener("click", onRestartClick);
  btnSound?.addEventListener("click", onSoundClick);
  window.addEventListener("resize", onResize);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVisibility);
  document.addEventListener("pointerlockchange", onPointerLockChange);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  canvas.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("wheel", onWheel);

  // ---------------- Fixed-step simulation ----------------
  let lastVehicleHitAt = -Infinity;

  function step(dt: number): void {
    tClock += dt;
    signals.update(env.state.tod);

    if (player.alive) {
      if (player.mode === "foot") {
        const fw = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
        const st = (keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0);
        updateFoot(player, dt, { forward: fw, strafe: st, run: !!(keys.ShiftLeft || keys.ShiftRight), jump: !!keys.Space }, cam.yaw, grid, vehicles);
        if (player.aiming) player.yaw = cam.yaw;
        checkVehicleHit(dt);
      } else if (player.car) {
        const input = { up: !!(keys.KeyW || keys.ArrowUp), down: !!(keys.KeyS || keys.ArrowDown), left: !!(keys.KeyA || keys.ArrowLeft), right: !!(keys.KeyD || keys.ArrowRight), handbrake: !!keys.Space };
        const impact = updatePlayerCar(player.car, dt, input, grid, vehicles);
        if (impact > 7) {
          cam.shake = Math.min(1, impact / 25);
          audio.thump(impact);
        }
        const dmg = crashDamage(impact);
        if (dmg > 0) {
          const killed = applyDamage(player, dmg, tClock);
          net.send({ t: "selfDamage", amount: dmg, cause: "vehicle" });
          hud.flashDamage();
          if (killed) onLocalDeath(null);
        }
      }
    } else {
      // Ragdoll-ish fall while dead.
      player.mesh.group.rotation.x += (Math.PI / 2 - player.mesh.group.rotation.x) * Math.min(1, dt * 4);
    }
    tickRegen(player, dt, tClock);
    tickWeapon(player.ammo[player.weapon], WEAPONS[player.weapon], dt);

    for (const v of vehicles) if (v.mode === "ai") updateAI(v, dt, vehicles, env.state.tod, player);
    updatePeds(scene, peds, dt, vehicles, player, cam.fx, cam.fz);
    for (const v of vehicles) {
      if (v.mode === "parked") continue;
      visualVeh(v, dt, env.state.nightF);
    }
    if (player.mode === "car" && player.car) {
      const v = player.car;
      env.carSpot.position.set(v.x + Math.sin(v.yaw) * 1.5, 1.0, v.z + Math.cos(v.yaw) * 1.5);
      env.carSpot.target.position.set(v.x + Math.sin(v.yaw) * 25, 0, v.z + Math.cos(v.yaw) * 25);
      env.carSpot.intensity = env.state.nightF * 1.6;
    }
  }

  function checkVehicleHit(dt: number): void {
    if (tClock - lastVehicleHitAt < 0.4) return;
    for (const v of vehicles) {
      if (v.mode === "player") continue;
      const sp = Math.abs(v.speed);
      if (sp < VEHICLE_HIT_SPEED_THRESHOLD) continue;
      for (const o of v.spec.offs) {
        const cx = v.x + Math.sin(v.yaw) * o;
        const cz = v.z + Math.cos(v.yaw) * o;
        const dx = player.x - cx;
        const dz = player.z - cz;
        const rs = 0.45 + v.spec.rad;
        const d2 = dx * dx + dz * dz;
        if (d2 < rs * rs) {
          lastVehicleHitAt = tClock;
          const dmg = vehicleHitDamage(sp);
          if (dmg > 0) {
            const d = Math.sqrt(d2) || 0.001;
            player.vx += (dx / d) * sp * 0.4;
            player.vz += (dz / d) * sp * 0.4;
            const killed = applyDamage(player, dmg, tClock);
            net.send({ t: "selfDamage", amount: dmg, cause: "fall" });
            hud.flashDamage();
            if (killed) onLocalDeath(null);
          }
          void dt;
          return;
        }
      }
    }
  }

  // ---------------- Frame loop ----------------
  let last = 0;
  let acc = 0;
  let rafId = 0;

  function frame(t: number): void {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (t - last) / 1000 || 0);
    last = t;

    if (!started) {
      env.tickClockOnly(dt);
      const a = t / 9000;
      camera.position.set(Math.cos(a) * 230, 70, Math.sin(a) * 230);
      camera.lookAt(0, 10, 0);
      env.update(dt, 0, 0, camera);
      renderer.render(scene, camera);
      return;
    }

    if (playing && !paused) {
      // Weapon state: aiming/firing flags consumed by physics + fire logic below.
      player.aiming = aimingHeld && player.mode === "foot" && player.alive;
      if (firingHeld && player.alive && player.mode !== "car") {
        const spec = WEAPONS[player.weapon];
        if (spec.automatic || !fireEdgeConsumed) {
          fireWeapon();
          fireEdgeConsumed = true;
        }
      }
      applyAimPose(player.mesh, player.aiming, player.weapon !== "fists");

      acc += dt;
      let n = 0;
      while (acc >= STEP && n < 6) {
        step(STEP);
        acc -= STEP;
        n++;
      }
      if (n === 6) acc = 0;

      updateCamera(cam, camera, player, dt, tClock, grid);
      env.update(dt, cam.fx, cam.fz, camera);
      effects.update(dt);
      remotePlayers.update(env.state.nightF);
      updateHud(dt);
      updateAudioFx();

      if (deathAt !== null) {
        const left = Math.max(0, (deathAt + RESPAWN_DELAY_MS / 1000 - tClock));
        hud.showDeathOverlay(killerAtDeath, left);
        if (left <= 0 && !net.isOnline()) {
          const sp = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
          teleportPlayer(sp.x, sp.z, sp.yaw);
          respawnHealth(player);
          refillAmmo();
          hud.hideDeathOverlay();
          deathAt = null;
        }
      }
    }
    renderer.render(scene, camera);
  }

  function updateAudioFx(): void {
    const on = soundOn && playing && !paused && player.mode === "car";
    const sp = on && player.car ? Math.abs(player.car.speed) : 0;
    const thr = keys.KeyW || keys.ArrowUp ? 1 : 0;
    audio.updateEngine(on, sp, thr);
  }

  const dots: MinimapDot[] = [];
  function updateHud(dt: number): void {
    const hh = Math.floor(env.state.tod);
    const mm = Math.floor((env.state.tod - hh) * 60);
    hud.setClock(hh, mm);
    const car = player.mode === "car" ? player.car : null;
    hud.setMode(car ? "CONDUCIENDO · " + car.spec.name.toUpperCase() : "A PIE", !!car);
    let pr = "";
    if (car) pr = Math.abs(car.speed) > 6 ? "Frena para poder salir (E)" : "Pulsa E para salir del vehículo";
    else {
      const v = nearestVehicle(player, vehicles);
      if (v) pr = "Pulsa E para entrar · " + v.spec.name;
    }
    hud.setPrompt(pr);
    if (car) hud.setSpeedo(Math.abs(car.speed) * 3.6, (Math.abs(car.speed) / car.spec.max) * 100);
    hud.setHealth(player.health, MAX_HEALTH);
    const armed = player.weapon !== "fists" && player.mode === "foot";
    const ammo = player.ammo[player.weapon];
    hud.setWeaponHud(player.weapon, ammo.mag, ammo.reserve, ammo.reloading, armed);
    if (hud.isScoreboardVisible()) {
      const rows = [{ name: myName, kills: localKills, deaths: localDeaths, ping: localPing }];
      for (const rp of remotePlayers.all()) rows.push({ name: rp.name, kills: rp.kills, deaths: rp.deaths, ping: rp.ping });
      hud.updateScoreboard(rows);
    }
    hud.tick(dt);
    drawMini();
  }

  function drawMini(): void {
    dots.length = 0;
    for (const v of vehicles) {
      if (v.mode === "player") continue;
      if (Math.abs(v.x - cam.fx) > 130 || Math.abs(v.z - cam.fz) > 130) continue;
      dots.push({ x: v.x, z: v.z, color: v.mode === "ai" ? "#ffb347" : "#c9d1d9", r: v.mode === "ai" ? 3.6 : 2.6 });
    }
    for (const rp of remotePlayers.all()) {
      const m = rp.lastMotion;
      if (!m) continue;
      if (Math.abs(m.p[0] - cam.fx) > 130 || Math.abs(m.p[2] - cam.fz) > 130) continue;
      dots.push({ x: m.p[0], z: m.p[2], color: "#4ea8ff", r: 3 });
    }
    const headingYaw = player.mode === "car" && player.car ? player.car.yaw : player.yaw;
    drawMinimap(miniCtx, mapTexture, cam.yaw, cam.fx, cam.fz, headingYaw, dots);
  }

  // ---------------- Boot ----------------
  resize();
  env.update(0, 0, 0, camera);
  signals.update(env.state.tod);
  rafId = requestAnimationFrame(frame);

  return {
    dispose() {
      cancelAnimationFrame(rafId);
      net.close();
      btnPlay?.removeEventListener("click", onPlayClick);
      btnPause?.removeEventListener("click", onPauseClick);
      btnResume?.removeEventListener("click", onResumeClick);
      btnRestart?.removeEventListener("click", onRestartClick);
      btnRestart2?.removeEventListener("click", onRestartClick);
      btnSound?.removeEventListener("click", onSoundClick);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("wheel", onWheel);
      renderer.dispose();
    },
  };
}
