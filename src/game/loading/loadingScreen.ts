// Start-screen loading bar: the boot stages (map download, GLB packs, Rapier,
// the world build) feed a LoadProgress (loadProgress.ts) and this shows its
// aggregate as a bar + percentage + the current stage label, then hides once
// everything settled. GLB packs report per-file progress through the shared
// loading manager (assets/gltf.ts onAssetLoad), classified by URL.

import { onAssetLoad } from "../assets/gltf";
import { LoadProgress, type LoadStage } from "./loadProgress";

export type BootStage = "map" | "characters" | "vehicles" | "nature" | "megakit" | "props" | "physics" | "world";

/** Declaration order = the order labels are shown in. Weights ~ relative wait. */
export const BOOT_STAGES: readonly (LoadStage & { id: BootStage })[] = [
  { id: "map", label: "Cargando mapa…", weight: 3 },
  { id: "characters", label: "Cargando personajes…", weight: 2 },
  { id: "vehicles", label: "Cargando vehículos…", weight: 2 },
  { id: "nature", label: "Cargando vegetación…", weight: 1 },
  { id: "megakit", label: "Cargando fachadas…", weight: 2 },
  { id: "props", label: "Cargando mobiliario urbano…", weight: 1 },
  { id: "physics", label: "Iniciando física…", weight: 1 },
  { id: "world", label: "Construyendo el campus…", weight: 3 },
];

/** Which boot stage a model URL belongs to (null: not tracked). */
export function stageOfUrl(url: string): BootStage | null {
  if (/\/models\/(characters|weapons)\//.test(url)) return "characters";
  if (url.includes("/models/vehicles/")) return "vehicles";
  if (url.includes("/models/nature/")) return "nature";
  if (url.includes("/models/buildings/")) return "megakit";
  if (url.includes("/models/props/")) return "props";
  return null;
}

export class LoadingScreen {
  readonly progress = new LoadProgress(BOOT_STAGES);
  private readonly box = document.getElementById("loadBox");
  private readonly fill = document.getElementById("loadFill");
  private readonly label = document.getElementById("loadLabel");
  private readonly pct = document.getElementById("loadPct");
  private readonly files = new Map<BootStage, { started: number; ended: number }>();
  private readonly unsubscribe: () => void;

  constructor() {
    this.progress.onChange((v, l) => this.render(v, l));
    this.unsubscribe = onAssetLoad((url, event) => {
      const stage = stageOfUrl(url);
      if (!stage || event === "error") return;
      let f = this.files.get(stage);
      if (!f) this.files.set(stage, (f = { started: 0, ended: 0 }));
      if (event === "start") f.started++;
      else f.ended++;
      this.progress.progress(stage, f.ended / Math.max(1, f.started));
    });
    this.box?.classList.remove("hidden");
    this.render(0, this.progress.label());
  }

  /** Marks `stage` done/failed when `p` settles (the result passes through). */
  track<T>(stage: BootStage, p: Promise<T>): Promise<T> {
    return this.progress.track(stage, p);
  }

  /** Shows `stage`'s label now (before a blocking step such as the world build). */
  announce(stage: BootStage): void {
    const st = BOOT_STAGES.find((x) => x.id === stage);
    if (st && this.label) this.label.textContent = st.label;
  }

  /** Overrides the label (e.g. a fatal error) and keeps the box visible. */
  showError(text: string): void {
    if (this.label) this.label.textContent = text;
    this.box?.classList.add("error");
  }

  /** Hides the bar (everything loaded). */
  finish(): void {
    this.render(1, "");
    this.box?.classList.add("hidden");
    this.unsubscribe();
  }

  dispose(): void {
    this.unsubscribe();
  }

  private render(v: number, label: string): void {
    const p = Math.round(v * 100);
    if (this.fill) this.fill.style.width = `${p}%`;
    if (this.pct) this.pct.textContent = `${p}%`;
    if (this.label && label) this.label.textContent = label;
  }
}
