// Live turntable preview of the selected character for the picker on the
// start/pause overlays. Uses its own small WebGLRenderer + scene so it never
// touches the main renderer, its camera or the attract-mode view; the canvas
// is moved into whichever picker is visible. Rigs come from the game's
// RigFactory (same loaded assets), idling with the normal animation blend.

import * as THREE from "three";
import type { CharacterRig, RigFactory } from "./characterRig";
import type { CharacterId } from "./characterChoice";

/** Turntable spin (rad/s). */
const SPIN = 0.7;
const IDLE = { speed: 0, ground: true, weapon: "fists" as const, aiming: false, alive: true };

export class CharacterPreview {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private rig: CharacterRig | null = null;
  private angle = 0.5;

  constructor(width = 180, height = 220) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "charPreview";
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: "low-power" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    // Same colour pipeline as the main renderer (see game.ts).
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(28, width / height, 0.1, 50);
    this.camera.position.set(0, 1.05, 4.3);
    this.camera.lookAt(0, 0.92, 0);
    this.scene.add(new THREE.HemisphereLight(0xdfeaff, 0x40382e, 2.2));
    const key = new THREE.DirectionalLight(0xfff1dc, 2.4);
    key.position.set(2, 4, 3);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fc4ff, 1.2);
    rim.position.set(-3, 2, -2);
    this.scene.add(rim);
  }

  /** Shows `character` built with `factory` (replaces the previous rig). */
  show(factory: RigFactory, character: CharacterId): void {
    this.rig?.dispose();
    this.rig = factory({ character, colors: { skin: 0xe0ac84, shirt: 0xd9442b, pants: 0x2b3a55, hair: 0x2a1c14, shoe: 0xf0f0f0 }, castShadow: false });
    this.rig.group.rotation.y = this.angle;
    this.scene.add(this.rig.group);
  }

  /** Moves the preview canvas into `parent` (the visible picker's stage). */
  mount(parent: Element): void {
    if (this.canvas.parentElement !== parent) parent.prepend(this.canvas);
  }

  render(dt: number): void {
    if (!this.rig || !this.canvas.isConnected) return;
    this.angle += dt * SPIN;
    this.rig.group.rotation.y = this.angle;
    this.rig.update(dt, IDLE);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.rig?.dispose();
    this.rig = null;
    this.canvas.remove();
    this.renderer.dispose();
  }
}
