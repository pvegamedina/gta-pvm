// Engine entry point: loads the Campus de El Carmen map and builds the world
// from it (world/campus/*), wires input, physics, combat, health, HUD and
// networking, and runs the fixed-step game loop.
// Deaths hand the body over to physics/corpses.ts (Rapier ragdolls, local and
// visual only) so it stays on the ground while the entity respawns fresh.
// Phase 5: player settings (settings/*: pause-menu panel, graphics presets
// applied live, persisted), the boot loading bar (loading/*), the ambient
// soundscape + footsteps + car doors (audio/ambience*), vehicle VFX
// (vehicles/vehicleVfx.ts) and the F3 performance overlay (hud/perfHud.ts).
// Active ragdoll phase 1: dying bodies keep fading muscles (physics/muscles.ts)
// and F4 toggles the ragdoll debug overlay (physics/ragdollDebug.ts).

import * as THREE from "three";
import {
  WEAPONS,
  WEAPON_ORDER,
  SPAWN_POINTS,
  MAX_HEALTH,
  RESPAWN_DELAY_MS,
  MAX_NAME_LENGTH,
  SESSION_REPLACED_MESSAGE,
  type WeaponId,
  type PlayerMotion,
  type ServerMessage,
} from "@shared/protocol";

import { STEP } from "./core/constants";
import { clamp } from "./core/math";

import { CollisionGrid } from "./world/colliders";
import { groundY, resetGround, surfaceY } from "./world/ground";
import { createEnvironment } from "./world/environment";
import { drawMinimap, type MinimapDot } from "./world/minimap";
import { buildCampusWorld, type CampusWorld } from "./world/campus/campusWorld";
import { loadNatureAssets, updateNatureVisibility, type NatureAssets } from "./world/campus/nature";
import { fetchCampusMap, type CampusMap } from "./map/loader";
import { loadMegakit, type MegakitAssets } from "./assets/megakit";
import { loadPropAssets, type PropAssets } from "./assets/props";
import { createRoadIndex, nearestRoadPoint } from "./map/queries";
import { isDrivable } from "./world/campus/mapPainter";

import { addVeh, visualVeh, removeVeh, type Vehicle } from "./vehicles/meshes";
import { loadVehicleAssets } from "./vehicles/vehicleAssets";
import { resolveVehicleType } from "./vehicles/catalog";
import { sirenFlash } from "./vehicles/animation";
import { HoldKey } from "./core/holdKey";
import { maintainTraffic, settleOnGround, spawnAICar, spawnParked, updateAI } from "./vehicles/traffic";
import { distanceToStop, signalState } from "./vehicles/roadNetwork";
import { updatePlayerCar } from "./vehicles/playerCar";

import { randomPedColors, type HumanColors } from "./player/human";
import { createPlayerState, type PlayerState } from "./player/playerState";
import { updateFoot, footSpeed } from "./player/foot";
import { nearestVehicle, enterCar, exitCar, forceExitCar } from "./player/enterExit";

import { spawnPeds, updatePeds, hitPed, spookPedsNear, pedPosition, pedVelocity, type Ped } from "./pedestrians/peds";

import { createCameraState, snapCamera, updateCamera, cameraRight } from "./camera/camera";
import { createAudioSystem, type LocalVehicleSound, type RemoteVehicleSound } from "./audio/audio";
import { engineProfileFor } from "./audio/engine";
import type { SirenSource } from "./audio/siren";

import { tickWeapon, tryFire, tryMelee, startReload, nextWeapon, totalSpread } from "./combat/weapons";
import { applyDamage, tickRegen, respawn as respawnHealth, vehicleHitDamage, crashDamage, VEHICLE_HIT_SPEED_THRESHOLD } from "./combat/health";
import { createEffectsSystem, type ImpactKind } from "./combat/effects";
import { ShootableRegistry, castShot, type RaycastShotResult } from "./combat/shootables";
import { WEAPON_FEEL, spreadToCrosshairGap } from "./combat/recoil";
import { rayTerrainHit } from "./combat/impacts";

import { loadRapier, PhysicsWorld, type PhysicsVehicle } from "./physics/physicsWorld";
import { CorpseManager } from "./physics/corpses";
import { RagdollDebugOverlay } from "./physics/ragdollDebug";
import type { Ragdoll } from "./physics/ragdoll";
import { findKillingShot, ramVelocity, shotImpulse, type RecordedShot, type Vec3 } from "./physics/deathImpulse";
import type { DeathCause } from "./physics/muscles";

import { loadCharacterAssets } from "./assets/characterAssets";
import { DEFAULT_CHARACTER, CHARACTER_NAMES, cycleCharacter, parseCharacterId, randomCharacter, resolveCharacter, type CharacterId } from "./characters/characterChoice";
import { CharacterPreview } from "./characters/characterPreview";
import type { CharacterRig, RigFactory } from "./characters/characterRig";
import { modelRigFactory, proceduralRigFactory } from "./characters/rigFactory";

import { NetClient, defaultServerUrl } from "./net/client";
import { RemotePlayerManager } from "./net/remotePlayers";

import { Hud } from "./hud/hud";
import { createPlaceTracker, updateBuildingName, updateStreetName } from "./hud/placeNames";
import { PerfHud } from "./hud/perfHud";

import { defaultPreset, loadSettings, saveSettings, type Settings, type SettingsStorage } from "./settings/settings";
import { PRESET_LABELS, presetConfig } from "./settings/graphicsPresets";
import { applyGraphics } from "./settings/graphics";
import { SettingsMenu } from "./settings/settingsMenu";
import { LoadingScreen } from "./loading/loadingScreen";
import { getViewScale } from "./world/lod";
import { createGroundClassifier, type GroundSurface } from "./world/campus/groundMaterial";
import { FootstepClock, ambienceMix, footstepGain } from "./audio/ambience";
import { VehicleVfx } from "./vehicles/vehicleVfx";
import { tyreSlip } from "./vehicles/vfxLogic";

export interface GameHandle {
  dispose(): void;
}

const $ = (id: string) => document.getElementById(id);

/** Procedural-fallback look of the local player (the model rig ignores it). */
const PLAYER_COLORS: HumanColors = { skin: 0xe0ac84, shirt: 0xd9442b, pants: 0x2b3a55, hair: 0x2a1c14, shoe: 0xf0f0f0 };
const PED_COUNT = 32;
/** Seconds between traffic upkeep passes (despawn far cars, top up near the player). */
const TRAFFIC_UPKEEP_S = 0.5;
/** Vehicles farther than this from the camera focus are not drawn (m). */
const VEHICLE_VIEW = 240;
/** A network "killed" is matched to a shot that landed this recently / this close (for the ragdoll impulse). */
const KILL_SHOT_MAX_AGE = 0.8;
const KILL_SHOT_MAX_DIST = 2.2;
/** Share of a body (kg) the bumper of a ramming car shoves. */
const RAM_MASS = 40;

/** localStorage, or null where it is unavailable (private mode, blocked site data). */
function settingsStorage(): SettingsStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

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

const CHARACTER_KEY = "gta-pvm:character";

/** The player's explicit character choice (null when never chosen / storage unavailable). */
function loadCharacter(): CharacterId | null {
  try {
    return parseCharacterId(localStorage.getItem(CHARACTER_KEY));
  } catch {
    return null;
  }
}

function saveCharacter(c: CharacterId): void {
  try {
    localStorage.setItem(CHARACTER_KEY, c);
  } catch {
    // ignore (private mode, blocked storage): the choice just won't persist
  }
}

const SESSION_ID_KEY = "gta-pvm:sessionId";

function newSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `sid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** One session id per browser, persisted in localStorage so a page reload
 * (same tab/browser) resumes the same session (see server/room.ts onHello).
 * Falls back to an ephemeral in-memory id when storage is unavailable
 * (private browsing, blocked site data, etc.) — the game must not crash, it
 * just won't be recognized as "the same session" across a reload in that case. */
function loadOrCreateSessionId(): string {
  try {
    const existing = localStorage.getItem(SESSION_ID_KEY);
    if (existing) return existing;
    const fresh = newSessionId();
    localStorage.setItem(SESSION_ID_KEY, fresh);
    return fresh;
  } catch {
    return newSessionId();
  }
}

export function createGame(): GameHandle {
  THREE.ColorManagement.enabled = false;

  const canvas = $("c") as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  // Pixel ratio, shadows, fog and the camera far plane come from the graphics preset (applySettings).
  // r186 deprecated PCFSoftShadowMap in favor of PCFShadowMap (same soft-shadow behavior).
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  // Player settings: stored ones, else defaults with a preset guessed from the device.
  let settings: Settings = loadSettings(
    settingsStorage(),
    defaultPreset({ devicePixelRatio: window.devicePixelRatio, hardwareConcurrency: navigator.hardwareConcurrency }),
  );

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xbfdcf2, 160, 1100);
  const camera = new THREE.PerspectiveCamera(65, 1, 0.5, 2500);

  const env = createEnvironment(scene);
  const grid = new CollisionGrid();
  const shootables = new ShootableRegistry();
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  /** The campus, built from the map file once it is loaded (Boot below). */
  let world: CampusWorld | null = null;
  /** Dev hook: draw every vegetation chunk regardless of distance (aerial screenshots). */
  let natureShowAll = false;
  /** Drivable-road lookup used to park the player's first car by the kerb. */
  let roadIndex: ReturnType<typeof createRoadIndex> | null = null;

  // Vehicles spawn once their models and the map are loaded (Boot below) and on every reset.
  const vehicles: Vehicle[] = [];
  /** Vehicles whose hitbox is registered as a shootable. */
  const registeredCars = new Set<Vehicle>();
  /** AI cars that ran off the end of a dead-end road this tick (recycled by maintainTraffic). */
  const deadCars = new Set<Vehicle>();
  let trafficTimer = 0;

  /** Keeps the shootable registry in sync with the vehicle list (traffic comes and goes). */
  function syncVehicleHitboxes(removed: readonly Vehicle[] = []): void {
    for (const v of removed) {
      shootables.remove(v.hitbox);
      registeredCars.delete(v);
    }
    for (const v of vehicles) {
      if (registeredCars.has(v)) continue;
      shootables.add(v.hitbox, { kind: "vehicle", refId: v });
      registeredCars.add(v);
    }
  }

  /** A kerbside parking spot on the drivable road nearest (x, z), facing along it. */
  function carSlotNear(x: number, z: number): { x: number; z: number; yaw: number } | null {
    if (!world || !roadIndex) return null;
    const roads = world.map.roads;
    const hit = nearestRoadPoint(roadIndex, x, z, { maxDistance: 80, filter: (r) => isDrivable(r.class) && !r.bridge && r.class !== "motorway" });
    if (!hit) return null;
    const r = roads[hit.road];
    const [ax, az] = r.points[hit.segment];
    const [bx, bz] = r.points[hit.segment + 1];
    const yaw = Math.atan2(bx - ax, bz - az);
    // Right-hand kerb of the road's drawing direction: right = (-cos yaw, sin yaw).
    const side = r.width / 2 - 1.2;
    return { x: hit.x - Math.cos(yaw) * side, z: hit.z + Math.sin(yaw) * side, yaw };
  }

  function respawnVehicles(near?: { x: number; z: number }): void {
    for (const v of vehicles) removeVeh(scene, v);
    syncVehicleHitboxes(vehicles);
    vehicles.length = 0;
    deadCars.clear();
    if (!world) return;
    spawnParked(scene, vehicles, world.map, near ? carSlotNear(near.x, near.z) : null);
    const fx = near?.x ?? 0;
    const fz = near?.z ?? 0;
    for (let k = 0; k < 12; k++) maintainTraffic(scene, vehicles, world.roadNet, fx, fz, deadCars);
    syncVehicleHitboxes();
  }

  /** A random spawn point from the map (protocol fallback list before it loads). */
  function randomSpawn(): { x: number; z: number; yaw: number } {
    const list = world && world.spawns.length > 0 ? world.spawns : SPAWN_POINTS;
    const sp = list[Math.floor(Math.random() * list.length)];
    return { x: sp.x, z: sp.z, yaw: sp.yaw };
  }
  /** Long press of H in a car with a light bar toggles it and the siren (a tap is the horn). */
  const hornKey = new HoldKey(0.45);
  /** Red/blue light thrown around by the nearest flashing light bar (night especially). */
  const sirenLight = new THREE.PointLight(0xff2020, 0, 26, 1);
  scene.add(sirenLight);

  // ---------------- Characters ----------------
  // Character models load asynchronously (see Boot below). Until then rigs are
  // built procedurally; "Jugar" stays disabled, peds are spawned and remote
  // players get their rigs once the final factory is known.
  let rigFactory: RigFactory = proceduralRigFactory;
  let assetsReady = false;
  let disposed = false;
  /** Explicit choice (picker, persisted); it wins over the colour-derived default. */
  let chosenCharacter: CharacterId | null = loadCharacter();
  /** Our model: the choice, else derived from the server-assigned colour once `welcome` arrives. */
  let localCharacter: CharacterId = chosenCharacter ?? DEFAULT_CHARACTER;
  let peds: Ped[] = [];

  const player: PlayerState = createPlayerState(rigFactory({ character: localCharacter, colors: PLAYER_COLORS, castShadow: true }), 21, 10.2, 2.3);
  scene.add(player.mesh.group);

  /**
   * Replaces the local player's rig, keeping its transform/visibility (the rig
   * re-attaches the held weapon on its next update). `disposeOld` false keeps
   * the old rig alive (it is being handed over as a corpse).
   */
  function setPlayerRig(rig: CharacterRig, disposeOld = true): void {
    const old = player.mesh;
    rig.group.position.copy(old.group.position);
    rig.group.rotation.copy(old.group.rotation);
    rig.group.visible = old.group.visible;
    if (disposeOld) old.dispose();
    scene.add(rig.group);
    player.mesh = rig;
  }

  function rebuildPlayerRig(): void {
    setPlayerRig(rigFactory({ character: localCharacter, colors: PLAYER_COLORS, castShadow: true }));
  }

  function despawnPeds(): void {
    for (const p of peds) {
      shootables.remove(p.mesh.group);
      p.mesh.dispose();
    }
    peds = [];
  }

  function respawnPeds(x: number, z: number): void {
    despawnPeds();
    if (!world) return;
    peds = spawnPeds(scene, PED_COUNT, rigFactory, world.footNet, x, z);
    for (const p of peds) shootables.add(p.mesh.group, { kind: "ped", refId: p });
  }

  const cam = createCameraState(2.3);
  const audio = createAudioSystem();
  const effects = createEffectsSystem(scene, audio);
  const corpses = new CorpseManager(scene);
  /** Rapier world for ragdolls; null until loaded (or if it failed: animated corpses). */
  let physics: PhysicsWorld | null = null;
  /** F4: ragdoll wireframes, joints, centre of mass, contacts and muscle state. */
  const ragdollDebug = new RagdollDebugOverlay(scene, () => corpses.ragdolls(), () => physics);
  /** Recent shots (ours + remote) used to aim the ragdoll impulse of network kills. */
  const recentShots: (RecordedShot & { weapon: WeaponId })[] = [];
  function recordShot(origin: THREE.Vector3, end: THREE.Vector3, weapon: WeaponId): void {
    recentShots.push({ origin: { x: origin.x, y: origin.y, z: origin.z }, end: { x: end.x, y: end.y, z: end.z }, time: tClock, weapon });
    if (recentShots.length > 24) recentShots.shift();
  }
  /** While dead, the camera follows our corpse instead of the hidden entity. */
  let localCorpse: { focus(out: THREE.Vector3): boolean } | null = null;
  const corpseFocus = new THREE.Vector3();
  const remotePlayers = new RemotePlayerManager(scene, shootables);
  const hud = new Hud();
  const miniCtx = ($("mini") as HTMLCanvasElement).getContext("2d")!;
  const perfHud = new PerfHud();
  const vfx = new VehicleVfx(scene);
  /** Ground surface lookup (footsteps, dust); real once the map is loaded. */
  let groundAt: (x: number, z: number) => GroundSurface = () => "asphalt";
  const footClock = new FootstepClock();
  /** Footsteps played and the last surface (dev telemetry: audio can't be heard in automated checks). */
  const stepStats = { count: 0, surface: "" as GroundSurface | "" };

  // ---------------- Settings ----------------
  /** Mouse-look multiplier (settings). */
  let mouseSens = settings.mouseSensitivity;
  let graphicsApplied = false;
  /** Applies settings live (audio buses, mouse, graphics preset, perf HUD) and persists them. */
  function applySettings(next: Settings, persist = true): void {
    const presetChanged = !graphicsApplied || next.preset !== settings.preset;
    settings = next;
    mouseSens = next.mouseSensitivity;
    cam.motion = next.cameraMotion;
    audio.setVolumes(next.masterVolume, next.sfxVolume, next.ambienceVolume);
    if (presetChanged) {
      applyGraphics(presetConfig(next.preset), { renderer, scene, camera, env });
      graphicsApplied = true;
    }
    perfHud.setVisible(next.showPerf);
    if (persist) saveSettings(next, settingsStorage());
  }
  const settingsMenu = new SettingsMenu(settings, (s) => applySettings(s), () => {
    // Back to the pause menu (if we are still paused).
    if (paused) $("pause")?.classList.remove("hidden");
  });
  function openSettings(): void {
    if (!paused) return;
    $("pause")?.classList.add("hidden");
    settingsMenu.open();
  }
  function togglePerfHud(): void {
    const next = { ...settings, showPerf: !settings.showPerf };
    applySettings(next);
    settingsMenu.set(next);
  }

  // ---------------- Networking ----------------
  let myId: string | null = null;
  let myName = loadName();
  const mySessionId = loadOrCreateSessionId();
  let pendingSpawn: { x: number; z: number; yaw: number } | null = null;
  let localPing = 0;
  let localKills = 0;
  let localDeaths = 0;

  const nameInput = $("nameInput") as HTMLInputElement | null;
  if (nameInput) nameInput.value = myName;

  const net = new NetClient(defaultServerUrl(), myName, mySessionId, {
    onStatus: (status, count) => {
      if (status === "connecting") hud.setServerStatus("Conectando…", "");
      else if (status === "online") hud.setServerStatus(`En línea · ${count} jugador${count === 1 ? "" : "es"}`, "online");
      else hud.setServerStatus("Sin conexión — modo un jugador", "offline");
    },
    onMessage: handleServerMessage,
  });
  if (chosenCharacter) net.setCharacter(chosenCharacter, false);
  net.connect();
  net.setMotionSource(buildMotion);

  /** Current aim pitch (sent to others so their copy of us aims up/down too). */
  let aimPitch = 0;
  function buildMotion(): PlayerMotion {
    return {
      p: [player.x, player.y, player.z],
      yaw: player.yaw,
      speed: footSpeed(player),
      ground: player.ground,
      weapon: player.weapon,
      aiming: player.aiming,
      aimPitch: Math.round(aimPitch * 1000) / 1000,
      car: player.car
        ? { type: player.car.type, color: player.car.color, yaw: player.car.yaw, speed: player.car.speed, steer: player.car.steerVis, siren: player.car.siren, brake: player.car.braking }
        : null,
    };
  }

  function handleServerMessage(msg: ServerMessage): void {
    switch (msg.t) {
      case "welcome": {
        myId = msg.id;
        pendingSpawn = msg.spawn;
        // Our choice wins; otherwise the server's pick (colour-derived), same as other clients see.
        const me = msg.players.find((p) => p.id === msg.id);
        const character = chosenCharacter ?? resolveCharacter(me?.character, me?.color);
        if (character !== localCharacter) {
          localCharacter = character;
          if (assetsReady) rebuildPlayerRig();
        }
        // msg.players includes this client's own snapshot — skip it, it is
        // not a remote player.
        for (const p of msg.players) {
          if (p.id === msg.id) continue;
          remotePlayers.add(p);
        }
        break;
      }
      case "playerJoined":
        remotePlayers.add(msg.player);
        break;
      case "playerLeft":
        remotePlayers.remove(msg.id);
        break;
      case "characterChanged":
        remotePlayers.setCharacter(msg.id, msg.character);
        break;
      case "states":
        for (const s of msg.players) {
          if (s.id === myId) continue;
          remotePlayers.pushMotion(s.id, s.motion);
        }
        break;
      case "shot": {
        if (msg.shooterId === myId) break;
        remotePlayers.notifyAttack(msg.shooterId, msg.weapon);
        const origin = new THREE.Vector3(msg.origin[0], msg.origin[1], msg.origin[2]);
        const end = new THREE.Vector3(msg.end[0], msg.end[1], msg.end[2]);
        recordShot(origin, end, msg.weapon);
        if (msg.weapon !== "fists") {
          // Visual only: the round leaves the shooter's gun (when its model is
          // known) and its impact plays on arrival; damage was already resolved
          // server-side. The surface/corpse it lands on is resolved locally.
          const muzzle = remotePlayers.muzzleWorldPosition(msg.shooterId, new THREE.Vector3()) ?? origin;
          const dir = end.clone().sub(origin);
          const dist = dir.length();
          dir.normalize();
          const imp = msg.hit
            ? { point: end, kind: "flesh" as ImpactKind, normal: null }
            : resolveImpact(origin, dir, castShot(origin, dir, dist + 0.3, shootables, 0.3, camera), msg.weapon);
          const yaw = remotePlayers.get(msg.shooterId)?.lastMotion?.yaw ?? 0;
          effects.shot({ weapon: msg.weapon, muzzle, end: imp.point, right: cameraRight(yaw), impact: imp.kind, normal: imp.normal, shooter: msg.shooterId, local: false });
        }
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
        if (msg.victimId === myId) onLocalDeath(killerName, msg.killerId);
        else spawnRemoteCorpse(msg.victimId, msg.killerId);
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
      case "error": {
        toast(msg.message);
        if (msg.message === SESSION_REPLACED_MESSAGE) {
          // Another tab/reload just claimed this browser session — stop
          // auto-reconnecting, or we'd immediately kick it right back.
          net.close();
        }
        break;
      }
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
    // (Re)spawns show the fresh rig the corpse left behind.
    player.mesh.group.visible = true;
    localCorpse = null;
    player.x = x;
    player.z = z;
    player.yaw = yaw;
    player.y = groundY(x, z);
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

  /** A killing blow: impulse at a world point, and what kind of death it makes (muscle fade style). */
  type DeathBlow = { impulse: Vec3; point: Vec3; cause: DeathCause };

  function onLocalDeath(killer: string | null, killerId: string | null = null, cause: DeathCause = "generic"): void {
    if (deathAt !== null) return;
    deathAt = tClock;
    killerAtDeath = killer;
    // A crash death keeps (part of) the car's momentum for the body thrown out of it.
    const carVel = player.car ? { x: player.car.vx * 0.6, y: 1, z: player.car.vz * 0.6 } : null;
    if (player.car) forceExitCar(player, grid, vehicles);
    player.firing = false;
    player.aiming = false;
    // Detach the body: it becomes a corpse; we respawn later with a fresh rig.
    const body = player.mesh;
    body.group.position.set(player.x, player.y, player.z);
    body.group.rotation.set(0, player.yaw, 0);
    body.group.visible = true;
    const velocity = carVel ?? { x: player.vx, y: player.vy, z: player.vz };
    setPlayerRig(rigFactory({ character: localCharacter, colors: PLAYER_COLORS, castShadow: true }), false);
    player.mesh.group.visible = false;
    const blow = killingBlow({ x: player.x, y: player.y, z: player.z }, killerId);
    // Thrown out of a crashing car = a tumble, like being run over.
    localCorpse = corpses.spawn({ rig: body, velocity, impulse: blow, cause: blow?.cause ?? (carVel ? "ram" : cause) });
  }

  /** Impulse of the blow that killed someone standing at `pos`: a recent shot, or a ramming remote car. */
  function killingBlow(pos: Vec3, killerId: string | null): DeathBlow | null {
    const shot = findKillingShot(recentShots, pos, tClock, KILL_SHOT_MAX_AGE, KILL_SHOT_MAX_DIST);
    if (shot) {
      const dir = { x: shot.end.x - shot.origin.x, y: shot.end.y - shot.origin.y, z: shot.end.z - shot.origin.z };
      return { impulse: shotImpulse(dir, shot.weapon), point: shot.end, cause: "shot" };
    }
    const car = killerId ? remotePlayers.get(killerId)?.car : null;
    if (car) return ramBlow({ x: Math.sin(car.yaw) * car.speed, y: 0, z: Math.cos(car.yaw) * car.speed }, pos);
    return null;
  }

  /** Shove of a car moving at `carVel` hitting a body standing at `pos`. */
  function ramBlow(carVel: Vec3, pos: Vec3): DeathBlow {
    const v = ramVelocity(carVel);
    return { impulse: { x: v.x * RAM_MASS, y: v.y * RAM_MASS, z: v.z * RAM_MASS }, point: { x: pos.x, y: pos.y + 0.9, z: pos.z }, cause: "ram" };
  }

  /** A remote player died: their current body stays as a corpse (fresh hidden rig for the respawn). */
  function spawnRemoteCorpse(victimId: string, killerId: string | null): void {
    const velocity = remotePlayers.velocityOf(victimId);
    const rig = remotePlayers.detachRigForCorpse(victimId);
    if (!rig) return;
    const p = { x: rig.group.position.x, y: rig.group.position.y, z: rig.group.position.z };
    let blow = killingBlow(p, killerId);
    if (!blow && killerId === myId && player.car) blow = ramBlow({ x: player.car.vx, y: 0, z: player.car.vz }, p);
    corpses.spawn({ rig, velocity, impulse: blow, cause: blow?.cause ?? "generic" });
  }

  /** Kills a ped: its body becomes a corpse and the ped gets a fresh (hidden) rig for its respawn. */
  function killPed(p: Ped, blow: { impulse: Vec3; point: Vec3 } | null, velocity: Vec3 = pedVelocity(p), cause: DeathCause = blow ? "shot" : "generic"): void {
    if (p.state === "down") return;
    hitPed(p);
    const body = p.mesh;
    shootables.remove(body.group);
    const fresh = rigFactory({ character: randomCharacter(), colors: randomPedColors(), castShadow: false });
    fresh.group.visible = false;
    scene.add(fresh.group);
    p.mesh = fresh;
    p.bodyTaken = true;
    shootables.add(fresh.group, { kind: "ped", refId: p });
    corpses.spawn({ rig: body, velocity, impulse: blow, cause });
  }

  /** Refines a hitscan result: the ground (raised blocks / roads) or a corpse in front of it, when closer. */
  function resolveImpact(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    res: RaycastShotResult,
    weapon: WeaponId,
  ): { point: THREE.Vector3; kind: ImpactKind; normal: THREE.Vector3 | null } {
    let point = res.point;
    let dist = res.distance;
    let kind: ImpactKind = "none";
    let normal = res.normal;
    const living = !!res.hit && (res.hit.kind === "ped" || res.hit.kind === "remotePlayer");
    if (res.hit) kind = living ? "flesh" : res.hit.kind === "building" ? "surface" : "vehicle";
    const gd = rayTerrainHit(origin, dir, dist, (x, z) => groundY(x, z));
    if (gd !== null && gd < dist) {
      dist = gd;
      point = origin.clone().addScaledVector(dir, gd);
      kind = "surface";
      normal = new THREE.Vector3(0, 1, 0);
    }
    // Corpses take the round unless it hit a living character first.
    const corpseHit = living ? null : corpses.shoot(origin, dir, dist, weapon);
    if (corpseHit) return { point: corpseHit.point, kind: "flesh", normal: null };
    return { point, kind, normal };
  }

  function resetGame(): void {
    corpses.clear();
    effects.clear();
    vfx.clear();
    localCorpse = null;
    recentShots.length = 0;
    cam.recoil.reset();
    player.mode = "foot";
    player.car = null;
    const spawn = pendingSpawn || randomSpawn();
    player.x = spawn.x;
    player.z = spawn.z;
    player.y = groundY(spawn.x, spawn.z);
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
    respawnVehicles(spawn);
    respawnPeds(spawn.x, spawn.z);
    player.mesh.group.position.set(player.x, player.y, player.z);
    player.mesh.group.rotation.set(0, player.yaw, 0);
    cam.yaw = player.yaw;
    cam.pitch = 0.3;
    env.carSpot.intensity = 0;
    sirenLight.intensity = 0;
    hornKey.cancel();
    snapCamera(cam, player);
    hud.setMode("A PIE", false);
  }

  function startGame(): void {
    if (!assetsReady) return;
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
    refreshPickers();
    for (const k in keys) keys[k] = false;
    hornKey.cancel();
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
      else audio.door(false);
      return;
    }
    const v = nearestVehicle(player, vehicles);
    if (v) {
      enterCar(player, v);
      audio.door(true);
    }
  }

  function switchWeapon(w: WeaponId): void {
    // The rig picks the new weapon model up on its next update.
    player.weapon = w;
  }

  // ---------------- Combat ----------------
  function fireWeapon(): void {
    if (!player.alive || player.mode === "car") return;
    const id = player.weapon;
    if (id === "fists") {
      const ammo = player.ammo.fists;
      if (!tryMelee(ammo, WEAPONS.fists)) return;
      player.mesh.triggerAttack("fists");
      const dir = camera.getWorldDirection(new THREE.Vector3());
      const origin = camera.position.clone();
      const res = castShot(origin, dir, WEAPONS.fists.range, shootables, 0.3, camera);
      if (res.hit && (res.hit.kind === "ped" || res.hit.kind === "remotePlayer")) {
        effects.impact(res.point, "flesh", null);
        if (res.hit.kind === "ped") killPed(res.hit.refId as Ped, { impulse: shotImpulse(dir, "fists"), point: res.point });
        else {
          hud.hitMarker();
          recordShot(origin, res.point, "fists");
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
    player.mesh.triggerAttack(id);
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const spread = totalSpread(spec, ammo);
    if (spread > 0) {
      dir.x += (Math.random() - 0.5) * spread;
      dir.y += (Math.random() - 0.5) * spread;
      dir.z += (Math.random() - 0.5) * spread;
      dir.normalize();
    }
    const origin = camera.position.clone();
    const res = castShot(origin, dir, spec.range, shootables, 0.3, camera);
    const imp = resolveImpact(origin, dir, res, id);
    // The visible round flies from the gun's muzzle to the hitscan point (the
    // crosshair ray from the camera). Without a muzzle (rig not ready) fall
    // back to a point in front of the camera — past its 0.5 near plane.
    const muzzle = new THREE.Vector3();
    if (!player.mesh.muzzleWorldPosition(muzzle)) muzzle.copy(origin).addScaledVector(dir, 1.2);
    effects.shot({ weapon: id, muzzle, end: imp.point, right: cameraRight(cam.yaw), impact: imp.kind, normal: imp.normal, shooter: "local", local: true });
    effects.gunshot(id, 0);
    effects.mechClick(id);
    // Gun feel: camera kick/climb/FOV punch + a little positional shake.
    cam.recoil.fire(id);
    cam.shake = Math.min(1, cam.shake + WEAPON_FEEL[id].shake);
    recordShot(origin, imp.point, id);
    let targetId: string | null = null;
    if (res.hit && imp.kind === "flesh" && imp.point === res.point) {
      if (res.hit.kind === "ped") {
        killPed(res.hit.refId as Ped, { impulse: shotImpulse(dir, id), point: res.point });
        spookPedsNear(peds, res.point.x, res.point.z, 14);
        hud.hitMarker();
        effects.hitTick();
      } else if (res.hit.kind === "remotePlayer") {
        targetId = String(res.hit.refId);
        hud.hitMarker();
        effects.hitTick();
      }
    } else if (res.hit && res.hit.kind === "remoteCar" && imp.point === res.point) {
      hud.hitMarker();
    }
    // `end` is the visual impact (ground/corpse included); targetId drives damage.
    net.send({ t: "shoot", weapon: id, origin: [origin.x, origin.y, origin.z], end: [imp.point.x, imp.point.y, imp.point.z], targetId });
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
    hornKey.cancel();
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
    if (e.code === "F3") {
      // Frame-time overlay (the browser's own F3 is "find").
      e.preventDefault();
      if (!e.repeat) togglePerfHud();
      return;
    }
    if (e.code === "F4") {
      e.preventDefault();
      if (!e.repeat) ragdollDebug.toggle();
      return;
    }
    // The settings panel takes the keyboard: Esc goes back to the pause menu.
    if (settingsMenu.isOpen()) {
      if (e.code === "Escape") settingsMenu.close();
      return;
    }
    // Character picker: <-/-> on the start screen or the pause menu (not while typing a name).
    if ((!started || paused) && (e.code === "ArrowLeft" || e.code === "ArrowRight") && !(document.activeElement instanceof HTMLInputElement)) {
      e.preventDefault();
      stepCharacter(e.code === "ArrowLeft" ? -1 : 1);
      return;
    }
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
    else if (e.code === "KeyH" && player.mode === "car") {
      audio.horn();
      hornKey.press(performance.now() / 1000);
    }
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
    if (e.code === "KeyH") hornKey.release(performance.now() / 1000);
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
    cam.yaw -= (e.movementX || 0) * 0.0022 * mouseSens;
    cam.pitch = clamp(cam.pitch + (e.movementY || 0) * 0.0018 * mouseSens, -0.15, 1.2);
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
  const btnSettings = $("btnSettings");
  const onSettingsClick = () => openSettings();
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
  btnSettings?.addEventListener("click", onSettingsClick);
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
  /** Local throttle for "ram" messages per remote target — the server also
   * rate-limits per attacker/target pair; this just avoids spamming it every
   * frame while in continuous contact. */
  const lastRamAt = new Map<string, number>();
  const RAM_LOCAL_COOLDOWN_S = 0.5;
  /** Fraction of speed the car keeps after absorbing a ram impact (there is no
   * separate vehicle-health stat in this codebase — the bit of "vehicle
   * impact damage" is modeled as a speed/momentum loss on hard contact,
   * distinct from the driver's own crash-damage health hit above). */
  const RAM_IMPACT_SPEED_RETENTION = 0.82;

  const remoteCars: PhysicsVehicle[] = [];
  const physicsCars: (readonly PhysicsVehicle[])[] = [vehicles, remoteCars];

  function step(dt: number): void {
    tClock += dt;
    const w = world!;
    w.signals.update(tClock);

    if (player.alive) {
      if (player.mode === "foot") {
        const fw = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
        const st = (keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0);
        // Face the camera while aiming or firing a gun, so the gun (and the
        // visible bullets leaving its muzzle) point where the shot goes; moving
        // sideways / backwards relative to that facing is slower.
        const facingLocked = player.aiming || (firingHeld && player.weapon !== "fists");
        updateFoot(player, dt, { forward: fw, strafe: st, run: !!(keys.ShiftLeft || keys.ShiftRight), jump: !!keys.Space }, cam.yaw, grid, vehicles, facingLocked ? cam.yaw : null);
        if (facingLocked) {
          player.yaw = cam.yaw;
          player.mesh.group.rotation.y = player.yaw;
        }
        checkVehicleHit(dt);
      } else if (player.car) {
        const input = { up: !!(keys.KeyW || keys.ArrowUp), down: !!(keys.KeyS || keys.ArrowDown), left: !!(keys.KeyA || keys.ArrowLeft), right: !!(keys.KeyD || keys.ArrowRight), handbrake: !!keys.Space };
        const impact = updatePlayerCar(player.car, dt, input, grid, vehicles);
        // Keep the player's own transform mirroring the car while driving —
        // buildMotion() reads player.x/y/z/yaw (not player.car's), so without
        // this a remote client would see the car rendered but frozen at the
        // position/heading it was entered from, never actually moving.
        player.x = player.car.x;
        player.y = player.car.y;
        player.z = player.car.z;
        player.yaw = player.car.yaw;
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
        // Ramming peds/players is a separate concern from "I hit a wall":
        // it never touches the driver's own health (only crashDamage above does).
        checkCarRam();
      }
    }
    tickRegen(player, dt, tClock);
    tickWeapon(player.ammo[player.weapon], WEAPONS[player.weapon], dt);

    for (const v of vehicles) if (v.mode === "ai" && !updateAI(v, dt, vehicles, w.roadNet, tClock, player)) deadCars.add(v);
    trafficTimer -= dt;
    if (trafficTimer <= 0) {
      trafficTimer = TRAFFIC_UPKEEP_S;
      syncVehicleHitboxes(maintainTraffic(scene, vehicles, w.roadNet, cam.fx, cam.fz, deadCars));
    }
    updatePeds(peds, dt, vehicles, player, cam.fx, cam.fz, w.footNet);
    for (const v of vehicles) {
      // Far cars are hidden (the fog hides them anyway; saves their draw calls).
      v.root.visible = v.mode === "player" || Math.hypot(v.x - cam.fx, v.z - cam.fz) < VEHICLE_VIEW * getViewScale();
      if (v.mode === "parked" && v.visual.settled) continue;
      visualVeh(v, dt, env.state.nightF);
    }
    if (hornKey.update(performance.now() / 1000)) toggleSiren();
    // Ragdoll physics (only steps while corpses exist): cars are kinematic pushers.
    remoteCars.length = 0;
    for (const rp of remotePlayers.all()) if (rp.car && rp.car.root.visible) remoteCars.push(rp.car);
    corpses.step(physicsCars);
    if (player.mode === "car" && player.car) {
      const v = player.car;
      env.carSpot.position.set(v.x + Math.sin(v.yaw) * 1.5, v.y + 1.0, v.z + Math.cos(v.yaw) * 1.5);
      env.carSpot.target.position.set(v.x + Math.sin(v.yaw) * 25, v.y, v.z + Math.cos(v.yaw) * 25);
      env.carSpot.intensity = env.state.nightF * 1.6;
    }
    updateSirenLight();
  }

  function toggleSiren(): void {
    const car = player.mode === "car" ? player.car : null;
    if (!car || !car.spec.siren) return;
    car.siren = !car.siren;
    toast(car.siren ? "Sirena activada" : "Sirena desactivada");
  }

  /** Every flashing light bar: ours (or parked local ones) and remote players' police cars. */
  function forEachSiren(fn: (v: Vehicle, id: string) => void): void {
    vehicles.forEach((v, i) => {
      if (v.siren && v.spec.siren) fn(v, `veh:${i}`);
    });
    for (const rp of remotePlayers.all()) if (rp.car && rp.car.root.visible && rp.car.siren && rp.car.spec.siren) fn(rp.car, rp.id);
  }

  /** Puts the shared siren light over the flashing car nearest the camera, coloured by the bar pattern. */
  function updateSirenLight(): void {
    let best: Vehicle | null = null;
    let bd = Infinity;
    forEachSiren((v) => {
      const d = Math.hypot(v.x - cam.fx, v.z - cam.fz);
      if (d < bd) {
        bd = d;
        best = v;
      }
    });
    const v = best as Vehicle | null;
    if (!v || bd > 120) {
      sirenLight.intensity = 0;
      return;
    }
    const f = sirenFlash(v.sirenT);
    sirenLight.position.set(v.x, v.y + v.spec.H + 0.6, v.z);
    sirenLight.color.setHex(f.red ? 0xff2020 : 0x2050ff);
    sirenLight.intensity = f.red || f.blue ? 1.2 + env.state.nightF * 3 : 0;
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
            if (killed) onLocalDeath(null, null, "ram");
          }
          void dt;
          return;
        }
      }
    }
  }

  /** Ramming (atropellar): the local player's own car hitting a pedestrian or
   * a remote player's hitbox, gated by relative speed so idling into someone
   * at walking pace doesn't hurt them. Peds are resolved locally (same as a
   * gunshot hit); remote players are reported to the server, which validates
   * and applies the damage authoritatively (see server/room.ts onRam). */
  function checkCarRam(): void {
    const car = player.car;
    if (!car) return;
    const speed = Math.abs(car.speed);
    if (speed < VEHICLE_HIT_SPEED_THRESHOLD) return;
    const rs = 0.5 + car.spec.rad;

    for (const p of peds) {
      if (p.state === "down") continue;
      const pos = pedPosition(p);
      const dx = car.x - pos.x;
      const dz = car.z - pos.z;
      if (dx * dx + dz * dz >= rs * rs) continue;
      // The body is thrown along the car's velocity (on top of being shoved by its proxy).
      killPed(p, null, ramVelocity({ x: car.vx, y: 0, z: car.vz }), "ram");
      spookPedsNear(peds, pos.x, pos.z, 10);
      car.vx *= RAM_IMPACT_SPEED_RETENTION;
      car.vz *= RAM_IMPACT_SPEED_RETENTION;
      cam.shake = Math.min(1, cam.shake + 0.1);
    }

    for (const rp of remotePlayers.all()) {
      // Remote players currently driving are a car-vs-car collision, not a
      // ram-a-person hit — out of scope here.
      if (!rp.alive || rp.car || !rp.lastMotion) continue;
      const dx = car.x - rp.lastMotion.p[0];
      const dz = car.z - rp.lastMotion.p[2];
      if (dx * dx + dz * dz >= rs * rs) continue;
      const last = lastRamAt.get(rp.id);
      if (last !== undefined && tClock - last < RAM_LOCAL_COOLDOWN_S) continue;
      lastRamAt.set(rp.id, tClock);
      net.send({ t: "ram", targetId: rp.id, speed });
      car.vx *= RAM_IMPACT_SPEED_RETENTION;
      car.vz *= RAM_IMPACT_SPEED_RETENTION;
      cam.shake = Math.min(1, cam.shake + 0.12);
    }
  }

  // ---------------- Frame loop ----------------
  const _viewDir = new THREE.Vector3();
  const _frustum = new THREE.Frustum();
  const _viewProj = new THREE.Matrix4();
  const _sphere = new THREE.Sphere(new THREE.Vector3(), 1.3);

  /**
   * Skinned character rigs are never frustum-culled by three (their bounds
   * move with the animation), so hide pedestrians outside the view ourselves:
   * a dozen-plus draw calls each.
   */
  function cullPeds(): void {
    camera.updateMatrixWorld();
    _viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_viewProj);
    for (const p of peds) {
      const g = p.mesh.group;
      if (!g.visible) continue;
      _sphere.center.set(g.position.x, g.position.y + 0.9, g.position.z);
      if (!_frustum.intersectsSphere(_sphere)) g.visible = false;
    }
  }
  let last = 0;
  let acc = 0;
  let rafId = 0;

  function frame(t: number): void {
    rafId = requestAnimationFrame(frame);
    const rawMs = t - last;
    const dt = Math.min(0.1, rawMs / 1000 || 0);
    last = t;

    if (!started) {
      // Attract mode: a slow aerial orbit around the campus.
      env.tickClockOnly(dt);
      const a = t / 16000;
      const c = world?.centre ?? new THREE.Vector3();
      camera.position.set(c.x + Math.cos(a) * 470, c.y + 210, c.z + Math.sin(a) * 470);
      camera.lookAt(c.x, c.y, c.z);
      env.update(dt, c.x, c.z, camera, c.y);
      renderer.render(scene, camera);
      perfFrame(rawMs, dt);
      preview?.render(dt);
      return;
    }
    if (paused) preview?.render(dt);

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

      acc += dt;
      let n = 0;
      while (acc >= STEP && n < 6) {
        step(STEP);
        acc -= STEP;
        n++;
      }
      if (n === 6) acc = 0;

      // Camera first: the rig levels the gun at this frame's aim pitch.
      const focus = deathAt !== null && localCorpse && localCorpse.focus(corpseFocus) ? corpseFocus : null;
      updateCamera(cam, camera, player, dt, tClock, grid, focus);
      cullPeds();
      aimPitch = viewPitch();
      if (player.mode === "foot") {
        player.mesh.update(dt, {
          speed: player.alive ? footSpeed(player) : 0,
          ground: player.ground,
          weapon: player.weapon,
          aiming: player.aiming,
          alive: player.alive,
          aimPitch,
          vx: player.vx,
          vz: player.vz,
          vy: player.vy,
        });
      }
      env.update(dt, cam.fx, cam.fz, camera, groundY(cam.fx, cam.fz, cam.fy));
      if (world?.nature) updateNatureVisibility(world.nature, cam.fx, cam.fz, natureShowAll);
      world?.facades?.update(cam.fx, cam.fz, natureShowAll, camera);
      world?.furniture?.update(cam.fx, cam.fz, env.state.nightF, natureShowAll);
      corpses.update(dt);
      ragdollDebug.update(dt);
      effects.update(dt);
      remotePlayers.update(dt, env.state.nightF, camera.position.x, camera.position.z);
      updateHud(dt);
      updateAudioFx(dt);
      updateFootsteps(dt);
      updateVfx(dt);

      if (deathAt !== null) {
        const left = Math.max(0, (deathAt + RESPAWN_DELAY_MS / 1000 - tClock));
        hud.showDeathOverlay(killerAtDeath, left);
        if (left <= 0 && !net.isOnline()) {
          const sp = randomSpawn();
          teleportPlayer(sp.x, sp.z, sp.yaw);
          respawnHealth(player);
          refillAmmo();
          hud.hideDeathOverlay();
          deathAt = null;
        }
      }
    } else {
      // Paused / game over: fade the engines out (their state is kept).
      updateAudioFx(dt);
    }
    renderer.render(scene, camera);
    perfFrame(rawMs, dt);
  }

  /** Feeds the F3 overlay with this frame's time and the renderer's counters (read right after render). */
  function perfFrame(rawMs: number, dt: number): void {
    if (!(rawMs > 0) || rawMs > 1000) return;
    const cfg = presetConfig(settings.preset);
    perfHud.update(rawMs, dt, renderer.info, `Calidad ${PRESET_LABELS[settings.preset]} · Sombras ${cfg.shadows ? cfg.shadowMapSize : "no"} · Escala ${renderer.getPixelRatio().toFixed(2)}`);
  }

  /** Footsteps on the surface under the player, at the locomotion cadence (jump landings too). */
  function updateFootsteps(dt: number): void {
    if (player.mode !== "foot" || !player.alive) {
      footClock.step(dt, 0, true);
      return;
    }
    const speed = footSpeed(player);
    const ev = footClock.step(dt, speed, player.ground);
    if (ev === "none") return;
    const surface = groundAt(player.x, player.z);
    audio.footstep(surface, footstepGain(speed, ev === "land"));
    stepStats.count++;
    stepStats.surface = surface;
  }

  /** Reused VFX inputs (no garbage per frame). */
  const vfxVehicles: Vehicle[] = [];
  const vfxPlayer = { car: null as unknown as Vehicle, throttle: 0, handbrake: false, hardBrake: 0, slip: 0 };
  const vfxGround = (x: number, z: number) => groundY(x, z);
  const vfxSurface = (x: number, z: number) => groundAt(x, z);
  const vfxFrame = {
    dt: 0,
    time: 0,
    camera,
    viewportHeight: 1,
    nightF: 0,
    player: null as typeof vfxPlayer | null,
    vehicles: vfxVehicles as Iterable<Vehicle>,
    groundY: vfxGround,
    surfaceAt: vfxSurface,
  };

  function updateVfx(dt: number): void {
    vfxVehicles.length = 0;
    for (const v of vehicles) vfxVehicles.push(v);
    for (const rp of remotePlayers.all()) if (rp.car) vfxVehicles.push(rp.car);
    const car = player.mode === "car" && player.alive ? player.car : null;
    if (car) {
      vfxPlayer.car = car;
      vfxPlayer.throttle = localSound.throttle;
      vfxPlayer.handbrake = !!keys.Space;
      vfxPlayer.hardBrake = carHardBrake;
      vfxPlayer.slip = localSound.slip;
    }
    vfxFrame.dt = dt;
    vfxFrame.time = tClock;
    vfxFrame.viewportHeight = renderer.domElement.height;
    vfxFrame.nightF = env.state.nightF;
    vfxFrame.player = car ? vfxPlayer : null;
    vfx.update(vfxFrame);
  }

  /** Pitch (rad, + = up) of the view ray without the recoil kick (the held gun has its own). */
  function viewPitch(): number {
    camera.getWorldDirection(_viewDir);
    return Math.asin(clamp(_viewDir.y, -1, 1)) - cam.recoil.pitch;
  }

  /** Reused per-frame vehicle audio inputs (no garbage per frame for our car). */
  const localSound: LocalVehicleSound = { type: "sedan", topSpeed: 40, wheelRadius: 0.36, speed: 0, throttle: 0, slip: 0 };
  /** 0..1 service-brake bite this frame (S while rolling forward): skid marks + screech. */
  let carHardBrake = 0;
  const remoteSounds: RemoteVehicleSound[] = [];
  const sirenSounds: SirenSource[] = [];

  function updateAudioFx(dt: number): void {
    const car = player.mode === "car" && player.alive ? player.car : null;
    if (car) {
      const fwd = !!(keys.KeyW || keys.ArrowUp);
      const back = !!(keys.KeyS || keys.ArrowDown);
      localSound.type = car.spec.engine;
      localSound.topSpeed = car.spec.max;
      localSound.wheelRadius = car.spec.wr;
      localSound.speed = car.speed;
      // Backing up, the reverse pedal (S) is the accelerator.
      localSound.throttle = car.speed < -0.5 ? (back ? 1 : 0) : fwd ? 1 : 0;
      // Tyre slip: sideways speed (car frame), handbrake skids and locked-up hard braking.
      const lateral = Math.abs(car.vx * Math.cos(car.yaw) - car.vz * Math.sin(car.yaw));
      carHardBrake = back && car.speed > 0.5 ? 1 : 0;
      localSound.slip = tyreSlip({ lateral, speed: Math.abs(car.speed), handbrake: !!keys.Space, hardBrake: carHardBrake });
    }
    remoteSounds.length = 0;
    const right = cameraRight(cam.yaw);
    for (const rp of remotePlayers.all()) {
      const v = rp.car;
      if (!v || !v.root.visible) continue;
      const dx = v.x - camera.position.x;
      const dz = v.z - camera.position.z;
      const d = Math.hypot(dx, dz);
      remoteSounds.push({ id: rp.id, type: v.spec.engine, topSpeed: v.spec.max, wheelRadius: v.spec.wr, speed: v.speed, distance: d, pan: d > 0.1 ? ((dx * right.x + dz * right.z) / d) * 0.8 : 0 });
    }
    audio.updateVehicles(dt, playing && !paused, car ? localSound : null, remoteSounds);
    sirenSounds.length = 0;
    forEachSiren((v, id) => {
      const dx = v.x - camera.position.x;
      const dz = v.z - camera.position.z;
      const d = v === car ? 0 : Math.hypot(dx, dz);
      sirenSounds.push({ id, distance: d, pan: d > 0.1 ? ((dx * right.x + dz * right.z) / d) * 0.8 : 0 });
    });
    audio.updateSirens(playing && !paused, sirenSounds);
    // Ambient bed: day/night crossfade, wind from height above the lowest ground and speed.
    const minH = world?.map.terrain.minHeight ?? 0;
    const listenerSpeed = car ? Math.abs(car.speed) * 0.6 : footSpeed(player);
    audio.updateAmbience(dt, playing && !paused, ambienceMix(env.state.nightF, player.y - minH, listenerSpeed));
  }

  // ---------------- Location toasts (street names, campus buildings) ----------------
  const places = createPlaceTracker();
  let namedRoads: ReturnType<typeof createRoadIndex> | null = null;
  let entrances: { name: string; x: number; z: number }[] = [];
  function updatePlaces(dt: number): void {
    if (!world || !player.alive) return;
    if (!namedRoads) {
      namedRoads = createRoadIndex(world.map.roads.filter((r) => r.name && r.footway !== "sidewalk" && r.footway !== "crossing"));
      entrances = world.buildings.info.filter((b) => b.name && b.entrance).map((b) => ({ name: b.name!, x: b.entrance![0], z: b.entrance![1] }));
    }
    const hit = nearestRoadPoint(namedRoads, player.x, player.z, { maxDistance: 20 });
    const road = hit ? namedRoads.roads[hit.road] : null;
    const street = updateStreetName(places, road?.name && hit ? { name: road.name, excess: Math.max(0, hit.distance - road.width / 2) } : null, dt);
    const building = player.mode === "foot" ? updateBuildingName(places, entrances, player.x, player.z) : null;
    if (building) hud.showPlace(building, "Campus de El Carmen");
    else if (street) hud.showPlace(street, "Huelva");
  }

  const dots: MinimapDot[] = [];
  function updateHud(dt: number): void {
    updatePlaces(dt);
    const hh = Math.floor(env.state.tod);
    const mm = Math.floor((env.state.tod - hh) * 60);
    hud.setClock(hh, mm);
    const car = player.mode === "car" ? player.car : null;
    hud.setMode(car ? "CONDUCIENDO · " + car.spec.name.toUpperCase() : "A PIE", !!car);
    let pr = "";
    if (car) {
      pr = Math.abs(car.speed) > 6 ? "Frena para poder salir (E)" : "Pulsa E para salir del vehículo";
      if (car.spec.siren) pr += " · Mantén H: sirena";
    }
    else {
      const v = nearestVehicle(player, vehicles);
      if (v) pr = "Pulsa E para entrar · " + v.spec.name;
    }
    hud.setPrompt(pr);
    if (car) {
      // The bar doubles as a tachometer so gear changes are visible as well as audible.
      const eng = audio.engineTelemetry();
      const redline = eng ? engineProfileFor(eng.type).redline : 0;
      hud.setSpeedo(Math.abs(car.speed) * 3.6, eng ? (eng.rpm / redline) * 100 : (Math.abs(car.speed) / car.spec.max) * 100);
      hud.setGear(eng ? (eng.gear < 0 ? "R" : String(eng.gear)) : "");
    }
    hud.setHealth(player.health, MAX_HEALTH);
    const armed = player.weapon !== "fists" && player.mode === "foot";
    const ammo = player.ammo[player.weapon];
    hud.setWeaponHud(player.weapon, ammo.mag, ammo.reserve, ammo.reloading, armed);
    // Crosshair bloom = the real shot cone (spread) at the current FOV.
    if (armed) hud.setCrosshairGap(spreadToCrosshairGap(totalSpread(WEAPONS[player.weapon], ammo), camera.fov, window.innerHeight));
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
      const color = v.spec.siren ? (v.siren && sirenFlash(v.sirenT).blue ? "#4d7dff" : "#ff5a5a") : v.mode === "ai" ? "#ffb347" : "#c9d1d9";
      dots.push({ x: v.x, z: v.z, color, r: v.mode === "ai" ? 3.6 : 2.6 });
    }
    for (const rp of remotePlayers.all()) {
      const m = rp.lastMotion;
      if (!m) continue;
      if (Math.abs(m.p[0] - cam.fx) > 130 || Math.abs(m.p[2] - cam.fz) > 130) continue;
      dots.push({ x: m.p[0], z: m.p[2], color: "#4ea8ff", r: 3 });
    }
    const headingYaw = player.mode === "car" && player.car ? player.car.yaw : player.yaw;
    drawMinimap(miniCtx, world?.minimap ?? null, cam.yaw, cam.fx, cam.fz, headingYaw, dots);
  }

  // ---------------- Character picker ----------------
  // Start screen + pause menu: arrows / <- -> cycle through the models with a
  // live turntable preview; the choice persists (localStorage), is announced
  // to the server (setCharacter) and applied live by swapping our rig.
  let preview: CharacterPreview | null = null;
  const pickerHandlers: [Element, () => void][] = [];
  const pickers = Array.from(document.querySelectorAll(".charPicker"));

  function refreshPickers(): void {
    for (const p of pickers) {
      const name = p.querySelector(".charName");
      if (name) name.textContent = CHARACTER_NAMES[localCharacter];
    }
    // The (single) preview canvas lives in whichever overlay is showing.
    const visible = pickers.find((p) => !p.closest(".overlay")?.classList.contains("hidden"));
    const stage = visible?.querySelector(".charStage");
    if (preview && stage) preview.mount(stage);
  }

  function chooseCharacter(c: CharacterId): void {
    if (!assetsReady || c === localCharacter) return;
    chosenCharacter = c;
    localCharacter = c;
    saveCharacter(c);
    net.setCharacter(c, true);
    // Live swap keeps position/visibility; a body already lying as a corpse keeps its old model.
    rebuildPlayerRig();
    preview?.show(rigFactory, c);
    refreshPickers();
  }

  function stepCharacter(delta: number): void {
    chooseCharacter(cycleCharacter(localCharacter, delta));
  }

  function initCharacterPicker(): void {
    for (const p of pickers) {
      for (const [sel, delta] of [[".charPrev", -1], [".charNext", 1]] as const) {
        const btn = p.querySelector(sel);
        if (!(btn instanceof HTMLButtonElement)) continue;
        btn.disabled = false;
        const fn = () => stepCharacter(delta);
        btn.addEventListener("click", fn);
        pickerHandlers.push([btn, fn]);
      }
    }
    try {
      preview = new CharacterPreview();
      preview.show(rigFactory, localCharacter);
    } catch (err) {
      console.warn("[picker] preview unavailable", err);
      preview = null;
    }
    refreshPickers();
  }

  // ---------------- Boot ----------------
  applySettings(settings, false);
  resize();
  env.update(0, 0, 0, camera);
  rafId = requestAnimationFrame(frame);

  // The attract camera renders right away; "Jugar" waits for the campus map
  // (built as soon as it arrives) and the character models. A failed model
  // load falls back to procedural humans / box cars; a failed map is fatal.
  // Every stage reports to the loading bar (failures count as settled).
  const loading = new LoadingScreen();
  const playLabel = btnPlay?.textContent ?? "Jugar";
  function setPlayLoading(loadingNow: boolean, label = "Cargando…"): void {
    if (!(btnPlay instanceof HTMLButtonElement)) return;
    btnPlay.disabled = loadingNow;
    btnPlay.textContent = loadingNow ? label : playLabel;
  }
  setPlayLoading(true);
  const factoryReady = loading
    .track("characters", loadCharacterAssets())
    .then((assets) => modelRigFactory(assets))
    .catch((err: unknown) => {
      console.warn("[assets] character models failed to load, using procedural humans", err);
      return proceduralRigFactory;
    });
  // Vehicle models load in parallel too; a failure keeps the procedural box stand-ins.
  const vehiclesReady = loading.track("vehicles", loadVehicleAssets()).catch((err: unknown) => {
    console.warn("[assets] vehicle models failed to load, using procedural cars", err);
  });
  // The campus map (download progress) and the vegetation models.
  const mapReady: Promise<CampusMap | null> = loading
    .track("map", fetchCampusMap(undefined, undefined, (f) => loading.progress.progress("map", f)))
    .catch((err: unknown) => {
      console.error("[map] could not load the campus map", err);
      return null;
    });
  const natureReady: Promise<NatureAssets | null> = loading.track("nature", loadNatureAssets()).catch((err: unknown) => {
    console.warn("[assets] nature models failed to load, the campus will have no trees", err);
    return null;
  });
  const megakitReady: Promise<MegakitAssets | null> = loading.track("megakit", loadMegakit()).catch((err: unknown) => {
    console.warn("[assets] MegaKit facade modules failed to load, buildings keep their plain walls", err);
    return null;
  });
  const propsReady: Promise<PropAssets | null> = loading.track("props", loadPropAssets()).catch((err: unknown) => {
    console.warn("[assets] street prop models failed to load, no bicycles / cones / model traffic lights", err);
    return null;
  });
  const rapierReady = loading.track("physics", loadRapier());
  /** Resolves after the browser painted a frame (so the "building" label shows before the blocking build). */
  const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  // Build the world as soon as the map (and trees) are in, so the attract view shows it.
  const worldReady = Promise.all([mapReady, natureReady, megakitReady, propsReady]).then(async ([map, nature, megakit, props]) => {
    if (disposed || !map) {
      loading.progress.fail("world");
      return null;
    }
    loading.announce("world");
    await nextPaint();
    if (disposed) return null;
    try {
      const t0 = performance.now();
      const w = buildCampusWorld(scene, map, env, grid, shootables, anisotropy);
      if (nature) w.addNature(nature);
      if (megakit) {
        w.addFacades(megakit);
        // Attract mode orbits the whole campus: dress every building until the game starts.
        w.facades?.update(w.centre.x, w.centre.z, true);
      }
      w.addFurniture(props, megakit);
      if (props) w.signals.useModel(props.get("traffic_light") ?? null);
      roadIndex = createRoadIndex(map.roads);
      groundAt = createGroundClassifier(map.roads, map.landuse);
      world = w;
      console.info(
        `[world] campus built in ${Math.round(performance.now() - t0)} ms: roads ${w.roads.stats.triangles} tris, buildings ${w.buildings.stats.triangles} tris, ` +
          `${w.nature?.stats.trees ?? 0} trees + ${w.nature?.stats.scatter ?? 0} scatter, ${w.signals.count} signal heads, ` +
          `${w.facades?.stats.instances ?? 0} facade instances on ${w.facades?.stats.buildings ?? 0} buildings`,
      );
      loading.progress.done("world");
      return w;
    } catch (err) {
      console.error("[world] could not build the campus", err);
      loading.progress.fail("world");
      return null;
    }
  });
  // Rapier loads in parallel; a failure (null) keeps animated, non-physical corpses.
  Promise.all([factoryReady, rapierReady, vehiclesReady, worldReady])
    .then(([factory, R, , w]) => {
      if (disposed) return;
      if (!w) {
        setPlayLoading(true, "Error al cargar el mapa");
        loading.showError("Error al cargar el mapa");
        const err = $("err");
        if (err) err.textContent = "No se pudo cargar el mapa del campus. Recarga la página para intentarlo de nuevo.";
        return;
      }
      if (R) {
        try {
          physics = new PhysicsWorld(R);
          physics.addTerrain(w.map.terrainGrid);
          physics.addStaticTrimesh(w.buildings.trimesh.vertices, w.buildings.trimesh.indices);
          physics.addGridColliders(grid);
          corpses.setPhysics(physics);
        } catch (err) {
          console.warn("[physics] could not build the ragdoll world, ragdolls disabled", err);
          physics = null;
        }
      }
      rigFactory = factory;
      assetsReady = true;
      rebuildPlayerRig();
      remotePlayers.setRigFactory(factory);
      remotePlayers.refreshCars();
      loading.finish();
      setPlayLoading(false);
      initCharacterPicker();
    });

  /** Dev-only ragdoll staging helpers (exposed as __gtaDebug.ragdoll). */
  function ragdollDebugHooks() {
    const dummies: Ragdoll[] = [];
    /** A dummy that still exists (corpses get capped / cleared). */
    const get = (id: number): Ragdoll | null => {
      const rd = dummies[id];
      return rd && corpses.ragdolls().includes(rd) ? rd : null;
    };
    /** Height (m above the feet) of the body part a scripted ped shot aims at. */
    const PART_HEIGHT: Record<string, number> = { head: 1.55, chest: 1.25, pelvis: 0.9, legL: 0.35, legR: 0.35, armL: 1.2, armR: 1.2 };
    return {
      /** Spawns a ragdoll dummy in its idle pose `dist` m in front of the player, facing them
       * (or turned by `yawOffset`), holding its pose at `strength`. Returns its id, -1 without Rapier. */
      spawnDummy: (opts: { dist?: number; strength?: number; pinned?: boolean; character?: string; yawOffset?: number } = {}) => {
        if (!physics) return -1;
        const dist = opts.dist ?? 3;
        const x = player.x + Math.sin(player.yaw) * dist;
        const z = player.z + Math.cos(player.yaw) * dist;
        const rig = rigFactory({ character: parseCharacterId(opts.character) ?? randomCharacter(), colors: randomPedColors(), castShadow: true });
        rig.group.position.set(x, groundY(x, z), z);
        rig.group.rotation.set(0, player.yaw + Math.PI + (opts.yawOffset ?? 0), 0);
        rig.update(1 / 60, { speed: 0, ground: true, weapon: "fists", aiming: false, alive: true });
        const h = corpses.spawn({ rig, velocity: { x: 0, y: 0, z: 0 }, hold: { strength: opts.strength ?? 1, pinned: opts.pinned ?? false } });
        if (!h.ragdoll) return -1;
        dummies.push(h.ragdoll);
        return dummies.length - 1;
      },
      setStrength: (id: number, strength: number) => get(id)?.hold(strength),
      pin: (id: number, on: boolean) => get(id)?.setPinned(on),
      /** Kills dummy `id`: a shot along (dirX, dirZ) hitting ragdoll part `part` (bone name,
       * default the chest), a car ram at `speed` m/s along that direction, or a plain collapse. */
      kill: (id: number, opts: { dirX?: number; dirZ?: number; part?: string; cause?: DeathCause; speed?: number; weapon?: WeaponId; seed?: number } = {}) => {
        const rd = get(id);
        if (!rd) return null;
        rd.setPinned(false);
        const cause = opts.cause ?? "shot";
        const dx = opts.dirX ?? Math.sin(player.yaw);
        const dz = opts.dirZ ?? Math.cos(player.yaw);
        const len = Math.hypot(dx, dz) || 1;
        const dir = { x: dx / len, y: 0, z: dz / len };
        let struck: string | null = null;
        if (cause === "ram") {
          const speed = opts.speed ?? 12;
          rd.addVelocity(ramVelocity({ x: dir.x * speed, y: 0, z: dir.z * speed }));
        } else if (cause === "shot") {
          const p = rd.bodyOf(opts.part ?? "Abdomen")?.worldCom();
          if (p) struck = rd.applyImpulseAt(shotImpulse(dir, opts.weapon ?? "pistol"), p);
        }
        rd.startDeath({ cause, struck, seed: opts.seed ?? 1 });
        return struck;
      },
      /** Shoots the nearest living ped from the player's position at a body part (the real killPed path). */
      shootNearestPed: (part = "chest", weapon: WeaponId = "pistol") => {
        let best: Ped | null = null;
        let bestD = Infinity;
        for (const p of peds) {
          if (p.state === "down" || !p.mesh.group.visible) continue;
          const pos = pedPosition(p);
          const d = Math.hypot(pos.x - player.x, pos.z - player.z);
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
        if (!best) return null;
        const pos = pedPosition(best);
        const y = best.mesh.group.position.y + (PART_HEIGHT[part] ?? 1.25);
        const dir = { x: pos.x - player.x, y: 0, z: pos.z - player.z };
        killPed(best, { impulse: shotImpulse(dir, weapon), point: { x: pos.x, y, z: pos.z } });
        return { x: pos.x, z: pos.z, distance: bestD };
      },
      list: () =>
        corpses.ragdolls().map((rd) => {
          const t = rd.bodies[0]?.translation();
          return { mode: rd.muscleMode, strength: rd.strength, maxError: rd.maxMotorError(), sleeping: rd.isSleeping(), pelvis: t ? { x: t.x, y: t.y, z: t.z } : null };
        }),
      overlay: (on?: boolean) => {
        ragdollDebug.setVisible(on ?? !ragdollDebug.isVisible());
        return ragdollDebug.isVisible();
      },
      clear: () => {
        corpses.clear();
        dummies.length = 0;
      },
    };
  }

  // Dev-only telemetry and staging helpers for automated visual checks.
  const debugHook = process.env.NODE_ENV === "development";
  if (debugHook) {
    (window as unknown as Record<string, unknown>).__gtaDebug = {
      engine: () => audio.engineTelemetry(),
      player: () => ({ x: player.x, y: player.y, z: player.z, vx: player.vx, vz: player.vz, vy: player.vy, yaw: player.yaw, ground: player.ground, speed: footSpeed(player), mode: player.mode, aimPitch, alive: player.alive }),
      vehicles: () =>
        vehicles.map((v) => ({
          type: v.type,
          x: v.x,
          y: v.y,
          z: v.z,
          yaw: v.yaw,
          mode: v.mode,
          speed: v.speed,
          tPitch: v.tPitch,
          tRoll: v.tRoll,
          siren: v.siren,
          sirenT: v.sirenT,
          fallback: v.visual.fallback,
          lit: { ...v.visual.lit },
          edge: v.ai?.driver.edge ?? -1,
          braking: v.braking,
        })),
      peds: () => peds.map((p) => ({ x: p.x, z: p.z, state: p.state, visible: p.mesh.group.visible })),
      /** Dev-only staging for visual checks: drops a parked car (catalogue or legacy type) at a spot. */
      spawnVehicle: (type: string, x: number, z: number, yaw: number, color = 0x2f6fd6) => {
        const v = addVeh(scene, resolveVehicleType(type), color, x, z, yaw, "parked");
        v.y = groundY(x, z);
        settleOnGround(v, 0, true);
        visualVeh(v, 0, env.state.nightF);
        vehicles.push(v);
        syncVehicleHitboxes();
        return vehicles.length - 1;
      },
      teleport: (x: number, z: number, yaw = player.yaw) => teleportPlayer(x, z, yaw),
      /** Dev-only: an AI vehicle of a given type in traffic near the camera focus (index, or -1). */
      spawnTraffic: (type: string, minDist = 25, siren = false) => {
        if (!world) return -1;
        const v = spawnAICar(scene, vehicles, world.roadNet, cam.fx, cam.fz, minDist, resolveVehicleType(type));
        if (!v) return -1;
        v.siren = siren && v.spec.siren;
        syncVehicleHitboxes();
        return vehicles.indexOf(v);
      },
      /** Dev-only: puts the player in vehicle i (as if E was pressed next to it). */
      enterVehicle: (i: number) => {
        const v = vehicles[i];
        if (!v) return false;
        enterCar(player, v);
        hud.setMode("CONDUCIENDO · " + v.spec.name.toUpperCase(), true);
        return true;
      },
      setSiren: (on: boolean) => {
        if (player.car && player.car.spec.siren) player.car.siren = on;
      },
      /** Traffic AI state of vehicle i: distance to its stop line and the light it sees. */
      aiState: (i: number) => {
        const v = vehicles[i];
        if (!v?.ai || !world) return null;
        const d = v.ai.driver;
        const j = world.roadNet.stopJunction(d.edge);
        const light = j >= 0 && !d.onLink ? signalState(world.roadNet.junctionOffset(j), world.roadNet.approachGroup(d.edge), tClock) : null;
        return { edge: d.edge, onLink: d.onLink, junction: j, distStop: distanceToStop(d, world.roadNet), light, speed: v.speed };
      },
      /** Kills the local player (offline checks of the ragdoll on terrain). */
      die: () => {
        player.health = 0;
        player.alive = false;
        onLocalDeath(null);
      },
      /** Ragdoll muscle staging (dummies in front of the player, scripted deaths, F4 overlay). */
      ragdoll: ragdollDebugHooks(),
      /** Turns the follow camera to a yaw / pitch. */
      look: (yaw: number, pitch = cam.pitch) => {
        cam.yaw = yaw;
        cam.pitch = pitch;
      },
      showAllNature: (all: boolean) => {
        natureShowAll = all;
        if (world?.nature) updateNatureVisibility(world.nature, cam.fx, cam.fz, all);
        world?.facades?.update(cam.fx, cam.fz, all);
      },
      ground: (x: number, z: number) => groundY(x, z),
      /** Height of the drawn road / sidewalk / paving above the terrain (what foot IK stands on). */
      surfaceLift: (x: number, z: number) => surfaceY(x, z) - groundY(x, z),
      setTime: (tod: number) => {
        env.state.tod = tod;
      },
      clock: () => tClock,
      /** Signal heads/junctions and the light shown to each approach right now. */
      junctions: () => world?.map.trafficLights.map((j, i) => ({ i, x: j.x, z: j.z })) ?? [],
      buildings: () => world?.buildings.info.filter((b) => b.name).map((b) => ({ name: b.name, x: b.centroid[0], z: b.centroid[1], base: b.base, top: b.top })) ?? [],
      /** Named buildings with a facade entrance (point in front of the door, outward yaw). */
      buildingEntrances: () =>
        world?.buildings.info.filter((b) => b.name && b.entrance).map((b) => ({ name: b.name!, x: b.entrance![0], z: b.entrance![1], yaw: b.entranceYaw })) ?? [],
      renderInfo: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }),
      /** Settings / graphics preset (visual checks of each preset). */
      settings: () => ({ ...settings }),
      setPreset: (preset: Settings["preset"]) => {
        const next = { ...settings, preset };
        applySettings(next);
        settingsMenu.set(next);
      },
      /** Footstep surface under a point. */
      surface: (x: number, z: number) => groundAt(x, z),
      audio: () => ({ state: audio.ctx?.state ?? null, master: audio.master?.gain.value ?? null, steps: { ...stepStats } }),
      loading: () => ({ value: loading.progress.value(), label: loading.progress.label(), failed: loading.progress.failed() }),
      worldStats: () =>
        world
          ? {
              roads: world.roads.stats,
              markings: world.markings.stats,
              buildings: world.buildings.stats,
              nature: world.nature?.stats ?? null,
              signals: world.signals.count,
              facades: world.facades?.stats ?? null,
              furniture: world.furniture?.stats ?? null,
            }
          : null,
    };
  }

  return {
    dispose() {
      disposed = true;
      cancelAnimationFrame(rafId);
      net.close();
      player.mesh.dispose();
      despawnPeds();
      corpses.clear();
      ragdollDebug.dispose();
      physics?.dispose();
      resetGround();
      remotePlayers.dispose();
      effects.dispose();
      audio.dispose();
      if (debugHook) delete (window as unknown as Record<string, unknown>).__gtaDebug;
      preview?.dispose();
      for (const [el, fn] of pickerHandlers) el.removeEventListener("click", fn);
      btnPlay?.removeEventListener("click", onPlayClick);
      btnPause?.removeEventListener("click", onPauseClick);
      btnResume?.removeEventListener("click", onResumeClick);
      btnRestart?.removeEventListener("click", onRestartClick);
      btnRestart2?.removeEventListener("click", onRestartClick);
      btnSound?.removeEventListener("click", onSoundClick);
      btnSettings?.removeEventListener("click", onSettingsClick);
      settingsMenu.dispose();
      loading.dispose();
      vfx.dispose();
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
