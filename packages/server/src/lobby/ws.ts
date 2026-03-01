import type { LobbyContext } from './context';
import { json } from './http';
import { applyMove, computeLiveStats, settleAllTurnTimeouts } from './gameplay';
import { roomToState } from './rooms';
import { moveSchema } from './types';

export function handleWs(ctx: LobbyContext, req: Request): Response {
  const upgrade = req.headers.get('Upgrade');
  if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
    return json({ error: 'expected websocket upgrade' }, 426);
  }

  const url = new URL(req.url);
  const roomId = url.searchParams.get('roomId');
  const ticketId = url.searchParams.get('ticketId');
  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  server.accept();

  server.addEventListener('message', (event) => {
    void (async () => {
      try {
        const raw = typeof event.data === 'string' ? event.data : '';
        if (!raw) {
          return;
        }
        const payload = JSON.parse(raw) as Record<string, unknown>;
        const messageType = typeof payload.type === 'string' ? payload.type : '';

        if (messageType === 'live_request') {
          await settleAllTurnTimeouts(ctx);
          server.send(JSON.stringify({ type: 'live', ...computeLiveStats(ctx) }));
          return;
        }

        if (messageType !== 'move') {
          return;
        }

        const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
        const targetRoomIdRaw = typeof payload.roomId === 'string' ? payload.roomId : roomId;
        const targetRoomId = targetRoomIdRaw ?? '';
        const targetSeatToken = typeof payload.seatToken === 'string' ? payload.seatToken : '';

        if (!targetRoomId) {
          server.send(JSON.stringify({ type: 'move_result', requestId, ok: false, status: 400, error: 'missing room id' }));
          return;
        }
        if (!targetSeatToken) {
          server.send(JSON.stringify({ type: 'move_result', requestId, ok: false, status: 401, error: 'missing seat token' }));
          return;
        }

        const parsedMove = moveSchema.safeParse({ x: payload.x, y: payload.y, decision: payload.decision });
        if (!parsedMove.success) {
          server.send(JSON.stringify({ type: 'move_result', requestId, ok: false, status: 400, error: parsedMove.error.flatten() }));
          return;
        }

        const result = await applyMove(ctx, targetRoomId, targetSeatToken, parsedMove.data);
        if (result.status === 200) {
          server.send(JSON.stringify({ type: 'move_result', requestId, ok: true, state: result.body }));
          return;
        }
        server.send(JSON.stringify({
          type: 'move_result',
          requestId,
          ok: false,
          status: result.status,
          error: (result.body as { error?: unknown })?.error ?? 'move failed',
        }));
      } catch {
        // ignore malformed ws message
      }
    })();
  });

  if (roomId) {
    const set = ctx.socketsByRoom.get(roomId) ?? new Set<WebSocket>();
    set.add(server);
    ctx.socketsByRoom.set(roomId, set);

    const room = ctx.rooms.get(roomId);
    if (room) {
      server.send(JSON.stringify({ type: 'state', state: roomToState(ctx, room) }));
    }

    const cleanup = () => {
      const current = ctx.socketsByRoom.get(roomId);
      if (!current) {
        return;
      }
      current.delete(server);
      if (current.size === 0) {
        ctx.socketsByRoom.delete(roomId);
      }
    };
    server.addEventListener('close', cleanup);
    server.addEventListener('error', cleanup);
  }

  if (ticketId) {
    const set = ctx.socketsByTicket.get(ticketId) ?? new Set<WebSocket>();
    set.add(server);
    ctx.socketsByTicket.set(ticketId, set);

    const assignment = ctx.assignmentByTicket.get(ticketId);
    if (assignment) {
      server.send(JSON.stringify({
        type: 'matchmaking',
        matched: true,
        ticketId: assignment.ticketId,
        roomId: assignment.roomId,
        seatToken: assignment.seatToken,
        side: assignment.side,
        state: assignment.state,
      }));
    } else if (ctx.waitingByTicket.has(ticketId)) {
      server.send(JSON.stringify({ type: 'matchmaking', matched: false, ticketId }));
    }

    const cleanup = () => {
      const current = ctx.socketsByTicket.get(ticketId);
      if (!current) {
        return;
      }
      current.delete(server);
      if (current.size === 0) {
        ctx.socketsByTicket.delete(ticketId);
      }
    };
    server.addEventListener('close', cleanup);
    server.addEventListener('error', cleanup);
  }

  return new Response(null, { status: 101, webSocket: client });
}
