import type { LobbyContext } from './context';

export function broadcastRoom(ctx: LobbyContext, roomId: string, payload: unknown): void {
  const clients = ctx.socketsByRoom.get(roomId);
  if (!clients || clients.size === 0) {
    return;
  }
  const serialized = JSON.stringify(payload);
  for (const ws of clients) {
    try {
      ws.send(serialized);
    } catch {
      // ignore dead socket
    }
  }
}

export function broadcastTicket(ctx: LobbyContext, ticketId: string, payload: unknown): void {
  const clients = ctx.socketsByTicket.get(ticketId);
  if (!clients || clients.size === 0) {
    return;
  }
  const serialized = JSON.stringify(payload);
  for (const ws of clients) {
    try {
      ws.send(serialized);
    } catch {
      // ignore dead socket
    }
  }
}
