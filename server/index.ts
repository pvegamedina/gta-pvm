import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import {
  SERVER_PORT,
  TICK_RATE_HZ,
  WS_PATH,
  encode,
  type ClientMessage,
  type ServerMessage,
} from "../shared/protocol";
import { GameRoom } from "./room";
import { isRecord } from "./validation";

// PORT is the convention used by hosting platforms (Render, Railway, Heroku…)
// that assign it dynamically; WS_PORT is an explicit override for local/manual
// setups, and SERVER_PORT is the shared default for local dev.
const PORT = Number(process.env.PORT) || Number(process.env.WS_PORT) || SERVER_PORT;
const MAX_PAYLOAD_BYTES = 16 * 1024;
const HEARTBEAT_MS = 10_000;
const CLIENT_TYPES = new Set(["hello", "state", "shoot", "ram", "selfDamage", "ping", "setCharacter"]);

const sockets = new Map<string, WebSocket>();
const alive = new WeakSet<WebSocket>();

function sendTo(socket: WebSocket | undefined, msg: ServerMessage): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(encode(msg));
}

const room = new GameRoom({
  now: Date.now,
  random: Math.random,
  schedule: (fn, ms) => { setTimeout(fn, ms); },
  send: (id, msg) => sendTo(sockets.get(id), msg),
  broadcast: (msg, exceptId) => {
    const data = encode(msg);
    for (const [id, socket] of sockets) {
      if (id !== exceptId && socket.readyState === WebSocket.OPEN) socket.send(data);
    }
  },
  disconnect: (id) => {
    const socket = sockets.get(id);
    // Close (not terminate) so the queued "error" send above actually
    // reaches the client before the connection drops.
    if (socket?.readyState === WebSocket.OPEN) socket.close();
  },
});

function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed.t !== "string" || !CLIENT_TYPES.has(parsed.t)) return null;
    return parsed as unknown as ClientMessage;
  } catch {
    return null;
  }
}

const wss = new WebSocketServer({
  host: "0.0.0.0",
  port: PORT,
  path: WS_PATH,
  maxPayload: MAX_PAYLOAD_BYTES,
});

wss.on("listening", () => console.log(`[ws] listening on 0.0.0.0:${PORT}`));

wss.on("connection", (socket) => {
  const id = randomUUID();
  sockets.set(id, socket);
  alive.add(socket);
  room.join(id);
  console.log(`[ws] + ${id.slice(0, 8)} (${sockets.size} connected)`);

  socket.on("pong", () => alive.add(socket));
  socket.on("message", (data, isBinary) => {
    if (isBinary) return;
    const msg = parseClientMessage(data.toString());
    if (msg) room.handle(id, msg);
  });
  socket.on("error", () => socket.terminate());
  socket.on("close", () => {
    sockets.delete(id);
    room.leave(id);
    console.log(`[ws] - ${id.slice(0, 8)} (${sockets.size} connected)`);
  });
});

wss.on("error", (err) => {
  console.error("[ws] server error:", err.message);
  process.exit(1);
});

const tickTimer = setInterval(() => room.tick(), 1000 / TICK_RATE_HZ);

const heartbeatTimer = setInterval(() => {
  for (const socket of sockets.values()) {
    if (!alive.has(socket)) {
      socket.terminate();
      continue;
    }
    alive.delete(socket);
    socket.ping();
  }
}, HEARTBEAT_MS);

function shutdown(): void {
  console.log("[ws] shutting down");
  clearInterval(tickTimer);
  clearInterval(heartbeatTimer);
  for (const socket of sockets.values()) socket.terminate();
  wss.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
