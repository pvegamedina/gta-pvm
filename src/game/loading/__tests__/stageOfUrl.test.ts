import { describe, expect, it } from "vitest";
import { BOOT_STAGES, stageOfUrl } from "../loadingScreen";

describe("stageOfUrl", () => {
  it("classifies model URLs into their boot stage", () => {
    expect(stageOfUrl("/models/characters/worker.glb")).toBe("characters");
    expect(stageOfUrl("/models/weapons/pistol.glb")).toBe("characters");
    expect(stageOfUrl("/models/vehicles/bus.glb")).toBe("vehicles");
    expect(stageOfUrl("/models/nature/palm_1.glb")).toBe("nature");
    expect(stageOfUrl("/models/buildings/megakit.glb")).toBe("megakit");
    expect(stageOfUrl("http://host:3000/models/props/traffic_cone.glb")).toBe("props");
    expect(stageOfUrl("/maps/campus-el-carmen.json")).toBeNull();
  });

  it("declares every boot stage once with a Spanish label and a positive weight", () => {
    const ids = BOOT_STAGES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of BOOT_STAGES) {
      expect(s.weight).toBeGreaterThan(0);
      expect(s.label.endsWith("…")).toBe(true);
    }
  });
});
