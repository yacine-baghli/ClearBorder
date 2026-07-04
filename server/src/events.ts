// server/src/events.ts
// WebSocket event bus — broadcasts case/agent events to all connected clients
// Used by console (transcripts, confirm gate), office (agent animations)

import type { WebSocket } from "ws";

const wsClients = new Set<WebSocket>();

export function addClient(ws: WebSocket): void {
  wsClients.add(ws);
  ws.on("close", () => wsClients.delete(ws));
}

export function removeClient(ws: WebSocket): void {
  wsClients.delete(ws);
}

export function broadcast(event: string, data: unknown): void {
  const msg = JSON.stringify({ event, data, at: new Date().toISOString() });
  for (const ws of wsClients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

export function getClientCount(): number {
  return wsClients.size;
}
