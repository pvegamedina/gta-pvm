// F3 performance overlay: fps, average / 99th-percentile frame time with a
// sparkline of the last FRAMES frames, and the renderer's per-frame draw
// calls and triangles plus the geometries / textures alive on the GPU
// (renderer.info, read right after the frame's render). Text refreshes a few
// times per second; the graph every frame while visible. DOM from Game.tsx.

import { FrameStats } from "./frameStats";

const FRAMES = 120;
/** Seconds between text refreshes (the numbers are unreadable at 60 Hz). */
const TEXT_EVERY = 0.25;
/** Graph scale (ms at the top) and the 60 / 30 fps guide lines. */
const GRAPH_MAX_MS = 50;

export interface RenderInfoLike {
  render: { calls: number; triangles: number };
  memory: { geometries: number; textures: number };
}

export class PerfHud {
  private readonly stats = new FrameStats(FRAMES);
  private readonly root = document.getElementById("perfHud");
  private readonly text = document.getElementById("perfText");
  private readonly canvas = document.getElementById("perfGraph") as HTMLCanvasElement | null;
  private readonly ctx = this.canvas?.getContext("2d") ?? null;
  private visible = false;
  private textT = 0;

  isVisible(): boolean {
    return this.visible;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.root?.classList.toggle("hidden", !v);
  }

  /** Call once per frame after rendering with the real frame time (ms). */
  update(frameMs: number, dt: number, info: RenderInfoLike, extra = ""): void {
    this.stats.push(frameMs);
    if (!this.visible) return;
    this.textT -= dt;
    if (this.textT <= 0 && this.text) {
      this.textT = TEXT_EVERY;
      const s = this.stats;
      this.text.textContent =
        `${Math.round(s.fps())} FPS · ${s.averageMs().toFixed(1)} ms (p99 ${s.percentileMs(0.99).toFixed(1)})\n` +
        `Draw calls ${info.render.calls} · Triángulos ${formatCount(info.render.triangles)}\n` +
        `Geometrías ${info.memory.geometries} · Texturas ${info.memory.textures}` +
        (extra ? `\n${extra}` : "");
    }
    this.drawGraph();
  }

  private drawGraph(): void {
    const c = this.ctx;
    const cv = this.canvas;
    if (!c || !cv) return;
    const w = cv.width;
    const h = cv.height;
    c.clearRect(0, 0, w, h);
    c.fillStyle = "rgba(0,0,0,0.35)";
    c.fillRect(0, 0, w, h);
    // 16.7 ms (60 fps) and 33.3 ms (30 fps) guides.
    c.strokeStyle = "rgba(255,255,255,0.25)";
    c.lineWidth = 1;
    for (const ms of [1000 / 60, 1000 / 30]) {
      const y = Math.round(h - (ms / GRAPH_MAX_MS) * h) + 0.5;
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(w, y);
      c.stroke();
    }
    const bw = w / FRAMES;
    const offset = FRAMES - this.stats.count;
    this.stats.forEach((ms, i) => {
      const bh = Math.min(h, (ms / GRAPH_MAX_MS) * h);
      c.fillStyle = ms <= 1000 / 55 ? "#5ad17a" : ms <= 1000 / 30 ? "#f0c050" : "#f05a4a";
      c.fillRect((offset + i) * bw, h - bh, Math.max(1, bw - 0.5), bh);
    });
  }
}

/** 1234567 -> "1.23 M", 45600 -> "45.6 k". */
export function formatCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} k`;
  return String(n);
}
