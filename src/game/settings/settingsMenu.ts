// Settings panel (opened from the pause menu): binds the controls rendered by
// Game.tsx to a Settings object. Every change is clamped, reflected in the
// labels and handed to `onChange` (the game applies it live and persists it).

import { clampSettings, isPreset, type Settings } from "./settings";

const $ = (id: string) => document.getElementById(id);

type SliderKey = "mouseSensitivity" | "masterVolume" | "sfxVolume" | "ambienceVolume";

/** Slider id, settings key, and how the value is shown / mapped from the 0..100 (or raw) input. */
const SLIDERS: { id: string; key: SliderKey; percent: boolean }[] = [
  { id: "setSens", key: "mouseSensitivity", percent: false },
  { id: "setMaster", key: "masterVolume", percent: true },
  { id: "setSfx", key: "sfxVolume", percent: true },
  { id: "setAmbience", key: "ambienceVolume", percent: true },
];

export class SettingsMenu {
  private readonly overlay = $("settings");
  private readonly handlers: [EventTarget, string, EventListener][] = [];
  private s: Settings;

  constructor(
    initial: Settings,
    private readonly onChange: (s: Settings) => void,
    private readonly onClose: () => void,
  ) {
    this.s = { ...initial };
    for (const sl of SLIDERS) {
      const input = $(sl.id);
      if (!(input instanceof HTMLInputElement)) continue;
      this.listen(input, "input", () => {
        const raw = Number(input.value);
        this.update({ [sl.key]: sl.percent ? raw / 100 : raw } as Partial<Settings>);
      });
    }
    for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>("#setPreset button[data-preset]"))) {
      this.listen(btn, "click", () => {
        const p = btn.dataset.preset;
        if (isPreset(p)) this.update({ preset: p });
      });
    }
    const perf = $("setPerf");
    if (perf instanceof HTMLInputElement) this.listen(perf, "change", () => this.update({ showPerf: perf.checked }));
    const back = $("btnSettingsBack");
    if (back) this.listen(back, "click", () => this.close());
    this.sync();
  }

  isOpen(): boolean {
    return !!this.overlay && !this.overlay.classList.contains("hidden");
  }

  open(): void {
    this.sync();
    this.overlay?.classList.remove("hidden");
  }

  close(): void {
    if (!this.isOpen()) return;
    this.overlay?.classList.add("hidden");
    this.onClose();
  }

  /** Replaces the shown settings (e.g. F3 toggled the perf HUD) without firing onChange. */
  set(s: Settings): void {
    this.s = { ...s };
    this.sync();
  }

  dispose(): void {
    for (const [el, ev, fn] of this.handlers) el.removeEventListener(ev, fn);
    this.handlers.length = 0;
  }

  private update(patch: Partial<Settings>): void {
    this.s = clampSettings({ ...this.s, ...patch });
    this.sync();
    this.onChange({ ...this.s });
  }

  /** Writes the current values into the controls and their labels. */
  private sync(): void {
    for (const sl of SLIDERS) {
      const v = this.s[sl.key];
      const input = $(sl.id);
      if (input instanceof HTMLInputElement) input.value = String(sl.percent ? Math.round(v * 100) : v);
      const label = $(`${sl.id}Val`);
      if (label) label.textContent = sl.percent ? `${Math.round(v * 100)}%` : `${v.toFixed(2)}×`;
    }
    for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>("#setPreset button[data-preset]"))) {
      btn.classList.toggle("active", btn.dataset.preset === this.s.preset);
      btn.setAttribute("aria-pressed", String(btn.dataset.preset === this.s.preset));
    }
    const perf = $("setPerf");
    if (perf instanceof HTMLInputElement) perf.checked = this.s.showPerf;
  }

  private listen(el: EventTarget, ev: string, fn: EventListener): void {
    el.addEventListener(ev, fn);
    this.handlers.push([el, ev, fn]);
  }
}
