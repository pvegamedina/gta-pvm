// Vehicle type specs (dimensions, performance) — matches shared/protocol CarState.type.

export interface VehicleSpec {
  name: string;
  L: number;
  W: number;
  bh: number;
  by: number;
  cl: number;
  ch: number;
  cz: number;
  slope: number;
  max: number;
  acc: number;
  wb: number;
  wr: number;
  spoiler?: boolean;
  cargo?: { l: number; h: number };
  sign?: boolean;
  rad: number;
  offs: [number, number, number];
}

export type VehicleTypeKey = "sedan" | "hatch" | "suv" | "sport" | "van" | "taxi";

const RAW: Record<VehicleTypeKey, Omit<VehicleSpec, "rad" | "offs">> = {
  sedan: { name: "Sedán", L: 4.5, W: 1.85, bh: 0.62, by: 0.4, cl: 2.3, ch: 0.58, cz: -0.15, slope: 0.55, max: 40, acc: 11, wb: 2.7, wr: 0.36 },
  hatch: { name: "Utilitario", L: 3.8, W: 1.72, bh: 0.6, by: 0.4, cl: 2.1, ch: 0.62, cz: -0.3, slope: 0.35, max: 35, acc: 10, wb: 2.4, wr: 0.34 },
  suv: { name: "SUV", L: 4.7, W: 1.95, bh: 0.85, by: 0.5, cl: 2.9, ch: 0.68, cz: -0.4, slope: 0.35, max: 37, acc: 10, wb: 2.8, wr: 0.42 },
  sport: { name: "Deportivo", L: 4.4, W: 1.95, bh: 0.5, by: 0.34, cl: 1.7, ch: 0.48, cz: -0.2, slope: 0.8, max: 54, acc: 17, wb: 2.6, wr: 0.35, spoiler: true },
  van: { name: "Furgoneta", L: 5.2, W: 2.0, bh: 0.9, by: 0.45, cl: 1.5, ch: 0.75, cz: 1.5, slope: 0.4, max: 32, acc: 8, wb: 3.2, wr: 0.4, cargo: { l: 3.2, h: 1.15 } },
  taxi: { name: "Taxi", L: 4.5, W: 1.85, bh: 0.62, by: 0.4, cl: 2.3, ch: 0.58, cz: -0.15, slope: 0.55, max: 40, acc: 11, wb: 2.7, wr: 0.36, sign: true },
};

export const TYPES: Record<VehicleTypeKey, VehicleSpec> = Object.fromEntries(
  Object.entries(RAW).map(([k, s]) => {
    const rad = s.W / 2 + 0.03;
    const o = s.L / 2 - rad - 0.03;
    return [k, { ...s, rad, offs: [-o, 0, o] as [number, number, number] }];
  }),
) as Record<VehicleTypeKey, VehicleSpec>;

export const VEHICLE_TYPE_KEYS = Object.keys(TYPES) as VehicleTypeKey[];

export const CAR_COLORS = [0xc0392b, 0x2980b9, 0x27ae60, 0xecf0f1, 0x2c3e50, 0x7f8c8d, 0xe67e22, 0x8e44ad, 0x1a1a1a, 0xd0d0d0, 0x16a085, 0xb03060];

export function randType(): VehicleTypeKey {
  const r = Math.random();
  return r < 0.3 ? "sedan" : r < 0.55 ? "hatch" : r < 0.75 ? "suv" : r < 0.85 ? "sport" : r < 0.95 ? "van" : "taxi";
}
