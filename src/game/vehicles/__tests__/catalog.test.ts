import { describe, expect, it } from "vitest";
import {
  PAINT_COLORS,
  VEHICLE_CATALOG,
  VEHICLE_TYPE_KEYS,
  colliderOffsets,
  pickTint,
  pickTrafficType,
  pickVehicleType,
  pushShare,
  resolveVehicleType,
  vehicleSpec,
} from "../catalog";
import { ENGINE_PROFILES } from "../../audio/engine";

/** The passenger cars (the public-transport vehicles have their own size rules). */
const CARS = ["sedan", "hatch", "suv", "sport", "coupe", "taxi", "police"] as const;

/** Deterministic stand-in for Math.random: replays the given values in a loop. */
function seq(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("vehicle catalogue", () => {
  it("lists every Quaternius car with a model file under /models/vehicles", () => {
    expect(VEHICLE_TYPE_KEYS).toEqual(["sedan", "hatch", "suv", "sport", "coupe", "taxi", "police", "bus", "school_bus", "ambulance"]);
    for (const k of VEHICLE_TYPE_KEYS) {
      expect(VEHICLE_CATALOG[k].key).toBe(k);
      expect(VEHICLE_CATALOG[k].model.file).toMatch(/^\/models\/vehicles\/[a-z0-9_]+\.glb$/);
    }
  });

  it("derives real-world dimensions from the measured model bounds and its scale", () => {
    const s = VEHICLE_CATALOG.sedan;
    const g = s.model.geometry;
    expect(s.L).toBeCloseTo((g.body.max[2] - g.body.min[2]) * s.model.scale, 5);
    expect(s.W).toBeCloseTo((g.body.max[0] - g.body.min[0]) * s.model.scale, 5);
    expect(s.wr).toBeCloseTo(g.wheelRadius * s.model.scale, 5);
    expect(s.wb).toBeCloseTo((g.frontAxleZ - g.rearAxleZ) * s.model.scale, 5);
    // Height is measured from the ground (wheel bottoms), not from the model origin.
    expect(s.H).toBeCloseTo((g.body.max[1] - g.wheelBottom) * s.model.scale, 5);
    expect(s.zc).toBeCloseTo(((g.body.max[2] + g.body.min[2]) / 2) * s.model.scale, 5);
  });

  it("keeps every car at a plausible real size", () => {
    for (const k of CARS) {
      const s = VEHICLE_CATALOG[k];
      expect(s.L, k).toBeGreaterThan(3.6);
      expect(s.L, k).toBeLessThan(4.8);
      expect(s.W, k).toBeGreaterThan(1.75);
      expect(s.W, k).toBeLessThan(2.25);
      expect(s.H, k).toBeGreaterThan(1.1);
      expect(s.H, k).toBeLessThan(1.7);
      expect(s.wr, k).toBeGreaterThan(0.25);
      expect(s.wr, k).toBeLessThan(0.4);
    }
  });

  it("keeps the old handling as the baseline and differentiates sports cars and SUVs", () => {
    const { sedan, sport, suv, hatch, police } = VEHICLE_CATALOG;
    expect(sedan.max).toBe(40);
    expect(sedan.acc).toBe(11);
    expect(sedan.brake).toBe(26);
    expect(sedan.steerLock).toBeCloseTo(0.62);
    expect(sport.max).toBeGreaterThan(sedan.max);
    expect(sport.acc).toBeGreaterThan(sedan.acc);
    expect(suv.mass).toBeGreaterThan(sedan.mass);
    expect(hatch.mass).toBeLessThan(sedan.mass);
    expect(police.max).toBeGreaterThan(sedan.max);
  });

  it("maps every type to an existing engine profile", () => {
    for (const k of VEHICLE_TYPE_KEYS) expect(Object.hasOwn(ENGINE_PROFILES, VEHICLE_CATALOG[k].engine), k).toBe(true);
    expect(VEHICLE_CATALOG.police.engine).toBe("police");
    expect(VEHICLE_CATALOG.taxi.engine).toBe("taxi");
  });

  it("gives only the police car and the ambulance a siren and keeps liveries untinted", () => {
    for (const k of VEHICLE_TYPE_KEYS) expect(VEHICLE_CATALOG[k].siren, k).toBe(k === "police" || k === "ambulance");
    expect(VEHICLE_CATALOG.taxi.tint).toBeNull();
    expect(VEHICLE_CATALOG.police.tint).toBeNull();
    expect(VEHICLE_CATALOG.sedan.tint).toBe(PAINT_COLORS);
  });

  it("puts the driver's door on the left (+x local) side", () => {
    for (const k of VEHICLE_TYPE_KEYS) expect(VEHICLE_CATALOG[k].door.side).toBe(1);
  });
});

describe("public transport", () => {
  const { bus, school_bus, ambulance, sedan } = VEHICLE_CATALOG;

  it("stretches the stubby low-poly bodies to real lengths (stretch applies to L, zc and the wheelbase)", () => {
    for (const s of [bus, school_bus, ambulance]) {
      const g = s.model.geometry;
      const k = s.model.stretch ?? 1;
      expect(k).toBeGreaterThan(1);
      expect(s.L).toBeCloseTo((g.body.max[2] - g.body.min[2]) * s.model.scale * k, 5);
      expect(s.wb).toBeCloseTo((g.frontAxleZ - g.rearAxleZ) * s.model.scale * k, 5);
      expect(s.W).toBeCloseTo((g.body.max[0] - g.body.min[0]) * s.model.scale, 5);
    }
  });

  it("has bus, school bus and ambulance at plausible sizes", () => {
    expect(bus.L).toBeGreaterThan(10.8);
    expect(bus.L).toBeLessThan(12.2);
    expect(school_bus.L).toBeGreaterThan(9.8);
    expect(school_bus.L).toBeLessThan(11.2);
    expect(ambulance.L).toBeGreaterThan(5.5);
    expect(ambulance.L).toBeLessThan(6.5);
    for (const s of [bus, school_bus, ambulance]) {
      expect(s.W, s.key).toBeGreaterThan(2.1);
      expect(s.W, s.key).toBeLessThan(2.7);
      expect(s.H, s.key).toBeGreaterThan(2.2);
      expect(s.H, s.key).toBeLessThan(3.3);
    }
  });

  it("uses the diesel profiles, more collision circles and a higher, farther chase camera", () => {
    expect(bus.engine).toBe("bus");
    expect(school_bus.engine).toBe("bus");
    expect(ambulance.engine).toBe("ambulance");
    expect(bus.offs.length).toBeGreaterThan(4);
    for (const s of [bus, school_bus, ambulance]) {
      expect(s.camera.height, s.key).toBeGreaterThan(sedan.camera.height);
      expect(s.camera.distance, s.key).toBeGreaterThan(sedan.camera.distance);
      expect(s.mass, s.key).toBeGreaterThan(sedan.mass);
      expect(s.max, s.key).toBeLessThan(sedan.max + 1);
    }
  });

  it("keeps buses on main roads, slower than cars, and never parks them", () => {
    for (const s of [bus, school_bus]) {
      expect(s.mainRoadsOnly, s.key).toBe(true);
      expect(s.aiSpeed, s.key).toBeLessThan(1);
      expect(s.spawn.parked, s.key).toBe(0);
      expect(s.spawn.traffic, s.key).toBeGreaterThan(0);
    }
    expect(sedan.mainRoadsOnly).toBe(false);
    expect(sedan.aiSpeed).toBe(1);
    expect(ambulance.spawn.traffic).toBeGreaterThan(0);
    expect(ambulance.spawn.traffic).toBeLessThan(VEHICLE_CATALOG.police.spawn.traffic + 1e-9);
  });

  it("scales the stretched vehicles' wheels up to a plausible radius (wr includes wheelScale)", () => {
    // Real buses run ~0.5 m wheels, vans/ambulances ~0.35-0.4 m.
    expect(bus.wr).toBeGreaterThan(0.42);
    expect(bus.wr).toBeLessThan(0.56);
    expect(school_bus.wr).toBeGreaterThan(0.4);
    expect(school_bus.wr).toBeLessThan(0.56);
    expect(ambulance.wr).toBeGreaterThan(0.32);
    expect(ambulance.wr).toBeLessThan(0.42);
    for (const s of [bus, school_bus, ambulance]) {
      const ws = s.model.wheelScale ?? 1;
      expect(ws, s.key).toBeGreaterThan(1);
      expect(s.wr, s.key).toBeCloseTo(s.model.geometry.wheelRadius * s.model.scale * ws, 5);
    }
    // Cars keep their measured wheels.
    expect(sedan.model.wheelScale ?? 1).toBe(1);
  });

  it("places the doors near the front of long vehicles", () => {
    expect(bus.door.z).toBeGreaterThan(bus.L / 4);
    expect(bus.door.z).toBeLessThan(bus.L / 2);
  });
});

describe("resolveVehicleType (network back-compat)", () => {
  it("passes catalogue keys through", () => {
    for (const k of VEHICLE_TYPE_KEYS) expect(resolveVehicleType(k)).toBe(k);
  });

  it("maps the legacy procedural van to the SUV and other aliases to their model", () => {
    expect(resolveVehicleType("van")).toBe("suv");
    expect(resolveVehicleType("cop")).toBe("police");
    expect(resolveVehicleType("sports")).toBe("sport");
  });

  it("falls back to the sedan for unknown or malformed types", () => {
    expect(resolveVehicleType("hovercraft")).toBe("sedan");
    expect(resolveVehicleType("")).toBe("sedan");
    expect(resolveVehicleType(undefined)).toBe("sedan");
    expect(resolveVehicleType(42)).toBe("sedan");
    expect(resolveVehicleType("__proto__")).toBe("sedan");
  });

  it("vehicleSpec resolves before looking up", () => {
    expect(vehicleSpec("van")).toBe(VEHICLE_CATALOG.suv);
    expect(vehicleSpec("taxi")).toBe(VEHICLE_CATALOG.taxi);
  });
});

describe("pickVehicleType (weighted spawns)", () => {
  it("makes police rare and taxis common-ish in traffic", () => {
    const w = (k: keyof typeof VEHICLE_CATALOG) => VEHICLE_CATALOG[k].spawn.traffic;
    expect(w("police")).toBeGreaterThan(0);
    for (const k of CARS) if (k !== "police") expect(w(k), k).toBeGreaterThan(w("police"));
    expect(w("taxi")).toBeGreaterThanOrEqual(3 * w("police"));
  });

  it("walks the cumulative weights in catalogue order", () => {
    const total = VEHICLE_TYPE_KEYS.reduce((a, k) => a + VEHICLE_CATALOG[k].spawn.traffic, 0);
    expect(pickVehicleType(seq(0), "traffic")).toBe("sedan");
    expect(pickVehicleType(seq(0.999999), "traffic")).toBe("ambulance");
    const sedanShare = VEHICLE_CATALOG.sedan.spawn.traffic / total;
    expect(pickVehicleType(seq(sedanShare - 1e-6), "traffic")).toBe("sedan");
    expect(pickVehicleType(seq(sedanShare + 1e-6), "traffic")).toBe("hatch");
  });

  it("uses the parked weights for parked cars", () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 1000; i++) {
      const k = pickVehicleType(seq(i / 1000), "parked");
      counts[k] = (counts[k] ?? 0) + 1;
    }
    const total = VEHICLE_TYPE_KEYS.reduce((a, k) => a + VEHICLE_CATALOG[k].spawn.parked, 0);
    for (const k of VEHICLE_TYPE_KEYS) expect((counts[k] ?? 0) / 1000, k).toBeCloseTo(VEHICLE_CATALOG[k].spawn.parked / total, 2);
  });
});

describe("pickTint", () => {
  it("picks a body colour from the type's palette", () => {
    expect(pickTint(VEHICLE_CATALOG.sedan, seq(0))).toBe(PAINT_COLORS[0]);
    expect(pickTint(VEHICLE_CATALOG.sedan, seq(0.9999))).toBe(PAINT_COLORS[PAINT_COLORS.length - 1]);
  });

  it("returns null (keep the livery) for taxis and police", () => {
    expect(pickTint(VEHICLE_CATALOG.taxi, seq(0.5))).toBeNull();
    expect(pickTint(VEHICLE_CATALOG.police, seq(0.5))).toBeNull();
  });
});

describe("colliderOffsets", () => {
  it("keeps three circles along a car, centred on the body", () => {
    const { rad, offs } = colliderOffsets(4.5, 1.9, 0.1);
    expect(rad).toBeCloseTo(0.98);
    expect(offs).toHaveLength(3);
    expect(offs[1]).toBeCloseTo(0.1);
    expect(offs[2] - offs[1]).toBeCloseTo(4.5 / 2 - 0.98 - 0.03);
    expect(offs[0] + offs[2]).toBeCloseTo(0.2);
  });

  it("adds circles for long vehicles so there are no gaps (buses)", () => {
    const { rad, offs } = colliderOffsets(12, 2.5, 0);
    expect(offs.length).toBeGreaterThan(3);
    for (let i = 1; i < offs.length; i++) expect(offs[i] - offs[i - 1]).toBeLessThanOrEqual(1.5 * rad + 1e-9);
    expect(offs[offs.length - 1]).toBeCloseTo(6 - rad - 0.03);
  });

  it("is what the catalogue uses", () => {
    const s = VEHICLE_CATALOG.suv;
    expect(colliderOffsets(s.L, s.W, s.zc)).toEqual({ rad: s.rad, offs: s.offs });
  });
});

describe("pushShare (car-vs-car separation)", () => {
  it("keeps the old 70/30 split between equal masses", () => {
    expect(pushShare(1400, 1400)).toBeCloseTo(0.7);
  });

  it("moves the lighter car more", () => {
    expect(pushShare(1100, 2100)).toBeGreaterThan(0.7);
    expect(pushShare(2100, 1100)).toBeLessThan(0.7);
  });

  it("stays within sane bounds", () => {
    expect(pushShare(1, 1e6)).toBeLessThanOrEqual(0.95);
    expect(pushShare(1e6, 1)).toBeGreaterThanOrEqual(0.3);
  });
});

describe("pickTrafficType (road-aware spawns)", () => {
  it("never puts buses on minor roads", () => {
    for (let i = 0; i < 200; i++) {
      const k = pickTrafficType(seq(i / 200), "residential");
      expect(VEHICLE_CATALOG[k].mainRoadsOnly, k).toBe(false);
    }
  });

  it("can spawn buses on main roads, with their traffic weight", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) seen.add(pickTrafficType(seq(i / 400), "secondary"));
    expect(seen.has("bus")).toBe(true);
    expect(seen.has("school_bus")).toBe(true);
    expect(seen.has("sedan")).toBe(true);
  });
});
