// DOM HUD controller: queries the markup rendered by Game.tsx by id and pushes
// updates directly (legacy-style), avoiding a React re-render per frame.

import type { WeaponId } from "@shared/protocol";
import { WEAPONS } from "@shared/protocol";
import { healthColor } from "../combat/health";

const $ = (id: string) => document.getElementById(id);

export interface KillFeedEntry {
  killer: string;
  victim: string;
  weapon: string;
}

export class Hud {
  private lastMode = "";
  private lastPrompt = "";
  private toastT = 0;
  private hitMarkerT = 0;
  private vignetteT = 0;
  private killFeedEl = $("killFeed");
  private scoreboardVisible = false;
  private crosshairGap = -1;

  setHudVisible(v: boolean): void {
    $("hud")?.classList.toggle("hidden", !v);
  }

  setClock(hh: number, mm: number): void {
    const el = $("clock");
    if (el) el.textContent = `${hh < 10 ? "0" : ""}${hh}:${mm < 10 ? "0" : ""}${mm}`;
  }

  setMode(text: string, showSpeedo: boolean): void {
    if (text !== this.lastMode) {
      const t = $("modeTxt");
      if (t) t.textContent = text;
      this.lastMode = text;
      const sp = $("speedo") as HTMLElement | null;
      if (sp) sp.style.display = showSpeedo ? "block" : "none";
    }
  }

  setPrompt(text: string): void {
    if (text !== this.lastPrompt) {
      const p = $("prompt") as HTMLElement | null;
      if (p) {
        p.textContent = text;
        p.style.display = text ? "block" : "none";
      }
      this.lastPrompt = text;
    }
  }

  toast(msg: string): void {
    const t = $("toast");
    if (t) {
      t.textContent = msg;
      t.classList.add("show");
    }
    this.toastT = 2;
  }

  setSpeedo(kmh: number, pct: number): void {
    const n = $("spdNum");
    if (n) n.textContent = String(Math.round(kmh));
    const f = $("spdFill") as HTMLElement | null;
    if (f) f.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }

  setHealth(health: number, max: number): void {
    const n = $("healthNum");
    if (n) n.textContent = String(Math.round(health));
    const f = $("healthBarFill") as HTMLElement | null;
    if (f) {
      f.style.width = `${Math.max(0, Math.min(100, (health / max) * 100))}%`;
      f.style.backgroundColor = healthColor(health);
    }
  }

  flashDamage(): void {
    this.vignetteT = 0.5;
  }

  setWeaponHud(weapon: WeaponId, mag: number, reserve: number, reloading: boolean, armed: boolean): void {
    const box = $("ammoBox") as HTMLElement | null;
    const cross = $("crosshair") as HTMLElement | null;
    if (box) box.style.display = armed ? "block" : "none";
    if (cross) cross.style.display = armed ? "block" : "none";
    const nameEl = $("weaponName");
    if (nameEl) nameEl.textContent = WEAPONS[weapon].name;
    const countEl = $("ammoCount");
    if (countEl) countEl.textContent = weapon === "fists" ? "—" : `${mag} / ${reserve}`;
    const reloadEl = $("reloadIndicator") as HTMLElement | null;
    if (reloadEl) reloadEl.style.display = reloading ? "block" : "none";
  }

  /** Distance (px) of the crosshair arms from the centre: blooms with the weapon's spread. */
  setCrosshairGap(px: number): void {
    if (Math.abs(px - this.crosshairGap) < 0.25) return;
    this.crosshairGap = px;
    ($("crosshair") as HTMLElement | null)?.style.setProperty("--gap", `${px.toFixed(1)}px`);
  }

  hitMarker(): void {
    const el = $("hitMarker") as HTMLElement | null;
    if (el) el.style.opacity = "1";
    this.hitMarkerT = 0.2;
  }

  pushKillFeed(entry: KillFeedEntry): void {
    if (!this.killFeedEl) this.killFeedEl = $("killFeed");
    if (!this.killFeedEl) return;
    const div = document.createElement("div");
    div.className = "killFeedItem";
    div.textContent = `${entry.killer} ☠ ${entry.victim} (${entry.weapon})`;
    this.killFeedEl.appendChild(div);
    setTimeout(() => {
      div.style.opacity = "0";
      setTimeout(() => div.remove(), 500);
    }, 4000);
  }

  setScoreboardVisible(v: boolean): void {
    this.scoreboardVisible = v;
    const el = $("scoreboard") as HTMLElement | null;
    if (el) el.style.display = v ? "block" : "none";
  }

  isScoreboardVisible(): boolean {
    return this.scoreboardVisible;
  }

  updateScoreboard(rows: { name: string; kills: number; deaths: number; ping: number }[]): void {
    const body = $("scoreboardBody");
    if (!body) return;
    body.innerHTML = rows
      .map((r) => `<tr><td>${escapeHtml(r.name)}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${r.ping}</td></tr>`)
      .join("");
  }

  showDeathOverlay(killer: string | null, respawnSecondsLeft: number): void {
    const el = $("deathOverlay") as HTMLElement | null;
    if (el) el.style.display = "flex";
    const k = $("killerText");
    if (k) k.textContent = killer ? `Eliminado por ${killer}` : "Has muerto";
    const c = $("respawnCountdown");
    if (c) c.textContent = `Reapareciendo en ${Math.ceil(respawnSecondsLeft)}s`;
  }

  hideDeathOverlay(): void {
    const el = $("deathOverlay") as HTMLElement | null;
    if (el) el.style.display = "none";
  }

  setServerStatus(text: string, cls: "online" | "offline" | ""): void {
    const el = $("serverStatus") as HTMLElement | null;
    if (el) {
      el.textContent = text;
      el.className = "serverStatus" + (cls ? " " + cls : "");
    }
  }

  tick(dt: number): void {
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) $("toast")?.classList.remove("show");
    }
    if (this.hitMarkerT > 0) {
      this.hitMarkerT -= dt;
      if (this.hitMarkerT <= 0) {
        const el = $("hitMarker") as HTMLElement | null;
        if (el) el.style.opacity = "0";
      }
    }
    if (this.vignetteT > 0) {
      this.vignetteT -= dt;
      const el = $("damageVignette") as HTMLElement | null;
      if (el) el.style.opacity = String(Math.max(0, this.vignetteT / 0.5) * 0.8);
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
