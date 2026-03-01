import type { LobbyContext } from '../context';
import { applyMove, settleAllTurnTimeouts, settleTurnTimeout } from '../gameplay';
import { getBearerToken, json, parseBody, randomId } from '../http';
import { persistRuntimeState } from '../persistence';
import {
  createRoomWithPlayer,
  recycleRoom,
  replaceSeatToken,
  roomToState,
} from '../rooms';
import { broadcastRoom } from '../sockets';
import { createRoomSchema, joinRoomSchema, moveSchema } from '../types';
import { getAgentFromAuth } from '../rooms';

export async function handleRoomRoutes(ctx: LobbyContext, req: Request, pathname: string): Promise<Response | null> {
  if (req.method === 'POST' && pathname === '/api/rooms') {
    const parsed = createRoomSchema.safeParse(await parseBody(req));
    if (!parsed.success) {
      return json({ error: parsed.error.flatten() }, 400);
    }

    let actorId = randomId();
    if (parsed.data.actorType === 'agent') {
      return json({ error: 'agent cannot create room directly; use matchmaking or join by room id' }, 403);
    }
    actorId = parsed.data.clientToken ?? actorId;

    for (const room of ctx.rooms.values()) {
      if (room.status !== 'waiting' && room.status !== 'playing') {
        continue;
      }
      const seat = room.players.find((p) => p.actorId === actorId);
      if (!seat) {
        continue;
      }
      if (parsed.data.actorType === 'human' && parsed.data.locale && seat.locale !== parsed.data.locale) {
        seat.locale = parsed.data.locale;
        await persistRuntimeState(ctx);
        broadcastRoom(ctx, room.id, { type: 'state', state: roomToState(ctx, room) });
      }
      return json({ roomId: room.id, seatToken: seat.seatToken, side: seat.side, state: roomToState(ctx, room), reused: true });
    }

    const { room, seat } = await createRoomWithPlayer(ctx, parsed.data.actorType, actorId, parsed.data.name);
    seat.locale = parsed.data.locale;
    await persistRuntimeState(ctx);
    return json({ roomId: room.id, seatToken: seat.seatToken, side: seat.side, state: roomToState(ctx, room) }, 201);
  }

  const joinMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/join$/);
  if (req.method === 'POST' && joinMatch) {
    const roomId = joinMatch[1];
    const parsed = joinRoomSchema.safeParse(await parseBody(req));
    if (!parsed.success) {
      return json({ error: parsed.error.flatten() }, 400);
    }

    const room = ctx.rooms.get(roomId);
    if (!room) {
      return json({ error: 'room not found' }, 404);
    }

    let actorId = randomId();
    if (parsed.data.actorType === 'agent') {
      const agent = getAgentFromAuth(ctx, req);
      if (!agent) {
        return json({ error: 'invalid agent token' }, 401);
      }
      actorId = agent.id;
    } else {
      actorId = parsed.data.clientToken ?? actorId;
    }

    const existingSeat = room.players.find((p) => p.actorType === parsed.data.actorType && p.actorId === actorId);
    if (existingSeat) {
      if (parsed.data.actorType === 'human' && parsed.data.locale && existingSeat.locale !== parsed.data.locale) {
        existingSeat.locale = parsed.data.locale;
        await persistRuntimeState(ctx);
        broadcastRoom(ctx, room.id, { type: 'state', state: roomToState(ctx, room) });
      }
      return json({ seatToken: existingSeat.seatToken, side: existingSeat.side, state: roomToState(ctx, room), reused: true });
    }

    if (room.players.length >= 2) {
      return json({ error: 'room full' }, 409);
    }

    const newSeat = {
      side: 2 as const,
      actorType: parsed.data.actorType,
      actorId,
      name: parsed.data.name,
      locale: parsed.data.locale,
      seatToken: randomId(),
    };

    const startedAt = Date.now();
    room.players.push(newSeat);
    room.status = 'playing';
    room.lastActiveAt[1] = startedAt;
    room.lastActiveAt[2] = startedAt;
    ctx.seatTokenIndex.set(newSeat.seatToken, { roomId: room.id, side: newSeat.side });
    await persistRuntimeState(ctx);

    const state = roomToState(ctx, room);
    broadcastRoom(ctx, room.id, { type: 'state', state });
    return json({ seatToken: newSeat.seatToken, side: newSeat.side, state }, 201);
  }

  const reconnectMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/reconnect$/);
  if (req.method === 'POST' && reconnectMatch) {
    const roomId = reconnectMatch[1];
    const agent = getAgentFromAuth(ctx, req);
    if (!agent) {
      return json({ error: 'invalid agent token' }, 401);
    }

    const room = ctx.rooms.get(roomId);
    if (!room) {
      return json({ error: 'room not found' }, 404);
    }

    const seat = room.players.find((p) => p.actorType === 'agent' && p.actorId === agent.id);
    if (!seat) {
      return json({ error: 'agent seat not found in room' }, 404);
    }

    const newSeatToken = randomId();
    seat.seatToken = newSeatToken;
    room.lastActiveAt[seat.side] = Date.now();
    replaceSeatToken(ctx, room.id, seat.side, newSeatToken);
    await persistRuntimeState(ctx);
    return json({ seatToken: newSeatToken, side: seat.side, state: roomToState(ctx, room) });
  }

  const leaveMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/leave$/);
  if (req.method === 'POST' && leaveMatch) {
    const roomId = leaveMatch[1];
    const seatToken = getBearerToken(req);
    if (!seatToken) {
      return json({ error: 'missing seat token' }, 401);
    }
    const seat = ctx.seatTokenIndex.get(seatToken);
    if (!seat || seat.roomId !== roomId) {
      return json({ error: 'invalid seat token' }, 401);
    }
    const room = ctx.rooms.get(roomId);
    if (!room) {
      return json({ error: 'room not found' }, 404);
    }

    const shouldCloseRoom = room.createdByRoomApi && seat.side === 1;
    if (!shouldCloseRoom) {
      return json({ closed: false });
    }

    broadcastRoom(ctx, room.id, { type: 'room_closed' });
    await recycleRoom(ctx, room.id);
    return json({ closed: true });
  }

  const stateMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/state$/);
  if (req.method === 'GET' && stateMatch) {
    const room = ctx.rooms.get(stateMatch[1]);
    if (!room) {
      return json({ error: 'room not found' }, 404);
    }
    await settleTurnTimeout(ctx, room);
    return json(roomToState(ctx, room));
  }

  const logsMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/logs$/);
  if (req.method === 'GET' && logsMatch) {
    const room = ctx.rooms.get(logsMatch[1]);
    if (!room) {
      return json({ error: 'room not found' }, 404);
    }
    return json({ roomId: room.id, logs: room.decisionLogs });
  }

  if (req.method === 'GET' && pathname === '/api/rooms/open') {
    const openRooms = Array.from(ctx.rooms.values())
      .filter((room) => room.status === 'waiting' && room.players.length === 1)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((room) => ({
        roomId: room.id,
        createdAt: room.createdAt,
        owner: { actorType: room.players[0].actorType, name: room.players[0].name },
      }));
    return json({ openRooms });
  }

  if (req.method === 'GET' && pathname === '/api/rooms/active') {
    await settleAllTurnTimeouts(ctx);
    const activeRooms = Array.from(ctx.rooms.values())
      .filter((room) => room.status === 'waiting' || room.status === 'playing')
      .map((room) => ({
        roomId: room.id,
        status: room.status,
        createdAt: room.createdAt,
        players: room.players.map((p) => ({ name: p.name, actorType: p.actorType, side: p.side })),
      }));
    return json({ activeRooms });
  }

  const moveMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/move$/);
  if (req.method === 'POST' && moveMatch) {
    const parsedMove = moveSchema.safeParse(await parseBody(req));
    if (!parsedMove.success) {
      return json({ error: parsedMove.error.flatten() }, 400);
    }
    const result = await applyMove(ctx, moveMatch[1], getBearerToken(req), parsedMove.data);
    return json(result.body, result.status);
  }

  return null;
}
