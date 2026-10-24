// WebSocket client: connect/auto-reconnect with backoff, send PlayerMotion at
// TICK_RATE_HZ, ping every 2s, dispatch typed ServerMessage events. The game
// must stay fully playable offline, so every send is a no-op when disconnected.

import { SERVER_PORT, TICK_RATE_HZ, type ClientMessage, type ServerMessage, type PlayerMotion } from "@shared/protocol";

export type ConnectionStatus = "connecting" | "online" | "offline";

export interface NetClientEvents {
  onStatus?: (status: ConnectionStatus, playerCount: number) => void;
  onMessage?: (msg: ServerMessage) => void;
}

export function defaultServerUrl(): string {
  const env = process.env.NEXT_PUBLIC_WS_URL;
  if (env) return env;
  const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
  return `ws://${host}:${SERVER_PORT}`;
}

export class NetClient {
  private ws: WebSocket | null = null;
  private url: string;
  private events: NetClientEvents;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stateTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private name: string;
  private sessionId: string;
  private getMotion: (() => PlayerMotion) | null = null;
  /** Chosen character sent with every hello (null = let the server pick from our colour). */
  private character: string | null = null;
  private playerCount = 0;
  public status: ConnectionStatus = "connecting";

  constructor(url: string, name: string, sessionId: string, events: NetClientEvents) {
    this.url = url;
    this.name = name;
    this.sessionId = sessionId;
    this.events = events;
  }

  connect(): void {
    this.closed = false;
    this.openSocket();
  }

  private openSocket(): void {
    this.setStatus("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      this.send({ t: "hello", name: this.name, sessionId: this.sessionId, ...(this.character ? { character: this.character } : {}) });
      this.pingTimer = setInterval(() => this.send({ t: "ping", ts: Date.now() }), 2000);
      this.stateTimer = setInterval(() => {
        if (this.getMotion) this.send({ t: "state", motion: this.getMotion() });
      }, 1000 / TICK_RATE_HZ);
    });
    ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as ServerMessage;
        if (msg.t === "welcome") {
          this.playerCount = msg.players.length + 1;
          this.setStatus("online");
        } else if (msg.t === "playerJoined") {
          this.playerCount += 1;
          this.setStatus("online");
        } else if (msg.t === "playerLeft") {
          this.playerCount = Math.max(1, this.playerCount - 1);
          this.setStatus("online");
        }
        this.events.onMessage?.(msg);
      } catch {
        // ignore malformed frames
      }
    });
    ws.addEventListener("close", () => {
      this.clearTimers();
      if (!this.closed) {
        this.setStatus("offline");
        this.scheduleReconnect();
      }
    });
    ws.addEventListener("error", () => {
      // close event follows; nothing extra to do here
    });
  }

  private setStatus(s: ConnectionStatus): void {
    this.status = s;
    this.events.onStatus?.(s, this.playerCount);
  }

  private clearTimers(): void {
    if (this.stateTimer) clearInterval(this.stateTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.stateTimer = null;
    this.pingTimer = null;
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    this.reconnectAttempt += 1;
    const delay = Math.min(10000, 500 * 2 ** Math.min(5, this.reconnectAttempt));
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
  }

  /** Sets the character announced in hello; when already connected also tells the server now. */
  setCharacter(character: string, announce: boolean): void {
    this.character = character;
    if (announce) this.send({ t: "setCharacter", character });
  }

  setMotionSource(fn: () => PlayerMotion): void {
    this.getMotion = fn;
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  isOnline(): boolean {
    return this.status === "online";
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.clearTimers();
    this.ws?.close();
    this.ws = null;
    this.setStatus("offline");
  }
}
