import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { addVeh, visualVeh } from "../meshes";
import { LAMP_ON } from "../vehicleAssets";
import { VEHICLE_CATALOG } from "../catalog";
import { ShootableRegistry, castShot } from "../../combat/shootables";

// Before the GLBs load (always, in node) vehicles use the procedural stand-in
// template, which has the same part roles as the real models.

describe("addVeh (procedural stand-in template)", () => {
  it("builds a raycastable hitbox sized from the catalogue", () => {
    const scene = new THREE.Scene();
    const v = addVeh(scene, "suv", 0xff0000, 0, 0, 0, "parked");
    v.hitbox.geometry.computeBoundingBox();
    const bb = v.hitbox.geometry.boundingBox!;
    expect(bb.max.x - bb.min.x).toBeCloseTo(VEHICLE_CATALOG.suv.W);
    expect(bb.max.z - bb.min.z).toBeCloseTo(VEHICLE_CATALOG.suv.L);
    expect(bb.max.y).toBeCloseTo(VEHICLE_CATALOG.suv.H);
    expect(v.hitbox.visible).toBe(false);
    expect(v.visual.fallback).toBe(true);
  });

  it("is hit by castShot through the shootable registry (only the hitbox is registered)", () => {
    const scene = new THREE.Scene();
    const v = addVeh(scene, "sedan", 0x00ff00, 10, 0, Math.PI / 2, "parked");
    v.y = 0;
    visualVeh(v, 0, 0);
    scene.updateMatrixWorld(true);
    const reg = new ShootableRegistry();
    reg.add(v.hitbox, { kind: "vehicle", refId: v });
    const res = castShot(new THREE.Vector3(0, 0.8, 0), new THREE.Vector3(1, 0, 0), 50, reg, 0.1, new THREE.PerspectiveCamera());
    expect(res.hit?.refId).toBe(v);
    expect(res.distance).toBeCloseTo(10 - VEHICLE_CATALOG.sedan.L / 2 - VEHICLE_CATALOG.sedan.zc, 1);
  });

  it("places the wheels on the ground and both front wheels on steering pivots", () => {
    const scene = new THREE.Scene();
    const v = addVeh(scene, "hatch", 0x123456, 0, 0, 0, "ai");
    expect(v.visual.spin).toHaveLength(3);
    expect(v.visual.steer).toHaveLength(2);
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const s of v.visual.spin) box.union(new THREE.Box3().setFromObject(s));
    // Within a centimetre (the stand-in tyres are 14-sided polygons).
    expect(Math.abs(box.min.y)).toBeLessThan(0.01);
  });
});

describe("visualVeh", () => {
  it("rolls the wheels with speed and steers the front pivots", () => {
    const scene = new THREE.Scene();
    const v = addVeh(scene, "sedan", 0x123456, 0, 0, 0, "ai");
    v.speed = 10;
    v.steerVis = 0.3;
    visualVeh(v, 0.1, 0);
    expect(v.spin).toBeCloseTo(1 / VEHICLE_CATALOG.sedan.wr);
    for (const s of v.visual.spin) expect(s.rotation.x).toBeCloseTo(v.spin);
    for (const p of v.visual.steer) expect(p.rotation.y).toBeCloseTo(0.3);
  });

  it("switches head, brake and reverse lamps to the lit materials and back", () => {
    const scene = new THREE.Scene();
    const v = addVeh(scene, "sedan", 0x123456, 0, 0, 0, "ai");
    v.speed = 5;
    v.braking = true;
    visualVeh(v, 0.016, 1);
    expect(v.visual.head.every((l) => l.mesh.material === LAMP_ON.head)).toBe(true);
    expect(v.visual.tail.every((l) => l.mesh.material === LAMP_ON.tailBrake)).toBe(true);
    v.braking = false;
    v.speed = -3;
    visualVeh(v, 0.016, 1);
    expect(v.visual.tail.every((l) => l.mesh.material === LAMP_ON.tailRun)).toBe(true);
    expect(v.visual.reverse.length).toBeGreaterThan(0);
    expect(v.visual.reverse.every((l) => l.mesh.material === LAMP_ON.reverse)).toBe(true);
    v.mode = "parked";
    visualVeh(v, 0.016, 1);
    expect(v.visual.head.every((l) => l.mesh.material === l.off)).toBe(true);
    expect(v.visual.reverse.every((l) => l.mesh.material === l.off)).toBe(true);
    expect(v.visual.settled).toBe(true);
  });

  it("tints the paint of normal cars but keeps liveries", () => {
    const scene = new THREE.Scene();
    const paintOf = (type: "sedan" | "taxi", color: number) => {
      const v = addVeh(scene, type, color, 0, 0, 0, "parked");
      const meshes: THREE.Mesh[] = [];
      v.body.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && o !== v.hitbox) meshes.push(o as THREE.Mesh);
      });
      return meshes.map((m) => (m.material as THREE.MeshLambertMaterial).color?.getHex());
    };
    expect(paintOf("sedan", 0xc0392b)).toContain(0xc0392b);
    expect(paintOf("taxi", 0xc0392b)).not.toContain(0xc0392b);
  });
});
