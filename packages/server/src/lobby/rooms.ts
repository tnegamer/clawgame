import { BOARD_SIZE, WIN_COUNT } from '@clawgame/shared';
import type { AgentIdentity } from '@clawgame/shared';
import { agentHistoryLimit, finishedRoomTtlMs, turnTimeoutMs, waitingRoomTtlMs } from './config';
import type { LobbyContext } from './context';
import { randomId } from './http';
import { persistAgent, persistAgentHistory, persistRuntimeState } from './persistence';
import { broadcastRoom } from './sockets';
import type { LiveStatsPayload, MatchAssignment, MatchRequest, MoveInput, PlayerSeat, Room } from './types';

export function boardEmpty(): (0 | 1 | 2)[][] {
  return Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => 0 as 0 | 1 | 2));
}

export function roomToState(ctx: LobbyContext, room: Room) {
  const timeoutMs = turnTimeoutMs(ctx);
  const turnDeadlineAt = room.status === 'playing' ? (room.lastActiveAt[room.currentTurn] ?? room.createdAt) + timeoutMs : null;
  return {
    roomId: room.id,
    status: room.status,
    board: room.board,
    currentTurn: room.currentTurn,
    turnDeadlineAt,
    turnTimeoutMs: timeoutMs,
    winner: room.winner,
    finishReason: room.finishReason,
    moves: room.moves,
    players: room.players.map((p) => ({
      side: p.side,
      actorType: p.actorType,
      actorId: p.actorId,
      name: p.name,
      locale: p.locale,
    })),
    lastMove: room.lastMove,
    decisionLogs: room.decisionLogs,
  };
}

export function checkWinner(board: (0 | 1 | 2)[][], x: number, y: number, side: 1 | 2): boolean {
  const dirs: Array<[number, number]> = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (const [dx, dy] of dirs) {
    let count = 1;
    let nx = x + dx;
    let ny = y + dy;
    while (nx >= 0 && ny >= 0 && nx < BOARD_SIZE && ny < BOARD_SIZE && board[ny][nx] === side) {
      count += 1;
      nx += dx;
      ny += dy;
    }
    nx = x - dx;
    ny = y - dy;
    while (nx >= 0 && ny >= 0 && nx < BOARD_SIZE && ny < BOARD_SIZE && board[ny][nx] === side) {
      count += 1;
      nx -= dx;
      ny -= dy;
    }
    if (count >= WIN_COUNT) {
      return true;
    }
  }
  return false;
}

export function getAgentFromAuth(ctx: LobbyContext, req: Request): AgentIdentity | null {
  const auth = req.headers.get('authorization') ?? '';
  const parts = auth.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return ctx.agentByToken.get(parts[1]) ?? null;
  }
  return null;
}

export function findActiveSeatByActorId(ctx: LobbyContext, actorId: string): { room: Room; seat: PlayerSeat } | null {
  for (const room of ctx.rooms.values()) {
    if (room.status !== 'waiting' && room.status !== 'playing') {
      continue;
    }
    const seat = room.players.find((p) => p.actorId === actorId);
    if (seat) {
      return { room, seat };
    }
  }
  return null;
}

export function findWaitingTicketByActorId(ctx: LobbyContext, actorId: string): string | null {
  for (const [ticketId, entry] of ctx.waitingByTicket.entries()) {
    if (entry.actorId === actorId) {
      return ticketId;
    }
  }
  return null;
}

export async function createRoomWithPlayer(
  ctx: LobbyContext,
  actorType: 'human' | 'agent',
  actorId: string,
  name: string,
): Promise<{ room: Room; seat: PlayerSeat }> {
  const roomId = randomId();
  const seat: PlayerSeat = { side: 1, actorType, actorId, name, locale: undefined, seatToken: randomId() };
  const now = Date.now();
  const room: Room = {
    id: roomId,
    createdByRoomApi: true,
    board: boardEmpty(),
    status: 'waiting',
    currentTurn: 1,
    winner: 0,
    finishReason: null,
    moves: 0,
    players: [seat],
    lastMove: null,
    decisionLogs: [],
    lastActiveAt: { 1: now, 2: now },
    createdAt: now,
  };
  ctx.rooms.set(roomId, room);
  ctx.seatTokenIndex.set(seat.seatToken, { roomId, side: seat.side });
  await persistRuntimeState(ctx);
  return { room, seat };
}

export async function createRoomWithPlayers(
  ctx: LobbyContext,
  left: MatchRequest,
  right: MatchRequest,
): Promise<{ room: Room; leftSeat: PlayerSeat; rightSeat: PlayerSeat }> {
  const roomId = randomId();
  const leftSeat: PlayerSeat = { side: 1, actorType: left.actorType, actorId: left.actorId, name: left.name, locale: left.locale, seatToken: randomId() };
  const rightSeat: PlayerSeat = { side: 2, actorType: right.actorType, actorId: right.actorId, name: right.name, locale: right.locale, seatToken: randomId() };
  const now = Date.now();
  const room: Room = {
    id: roomId,
    createdByRoomApi: false,
    board: boardEmpty(),
    status: 'playing',
    currentTurn: 1,
    winner: 0,
    finishReason: null,
    moves: 0,
    players: [leftSeat, rightSeat],
    lastMove: null,
    decisionLogs: [],
    lastActiveAt: { 1: now, 2: now },
    createdAt: now,
  };
  ctx.rooms.set(roomId, room);
  ctx.seatTokenIndex.set(leftSeat.seatToken, { roomId, side: leftSeat.side });
  ctx.seatTokenIndex.set(rightSeat.seatToken, { roomId, side: rightSeat.side });
  await persistRuntimeState(ctx);
  return { room, leftSeat, rightSeat };
}

export async function assignMatch(ctx: LobbyContext, leftTicketId: string, rightTicketId: string): Promise<void> {
  const left = ctx.waitingByTicket.get(leftTicketId);
  const right = ctx.waitingByTicket.get(rightTicketId);
  if (!left || !right) {
    return;
  }
  const { room, leftSeat, rightSeat } = await createRoomWithPlayers(ctx, left, right);
  const state = roomToState(ctx, room);
  const leftAssign: MatchAssignment = { ticketId: leftTicketId, roomId: room.id, seatToken: leftSeat.seatToken, side: leftSeat.side, state };
  const rightAssign: MatchAssignment = { ticketId: rightTicketId, roomId: room.id, seatToken: rightSeat.seatToken, side: rightSeat.side, state };
  ctx.assignmentByTicket.set(leftTicketId, leftAssign);
  ctx.assignmentByTicket.set(rightTicketId, rightAssign);
  broadcastRoom(ctx, room.id, { type: 'state', state });
  ctx.waitingByTicket.delete(leftTicketId);
  ctx.waitingByTicket.delete(rightTicketId);
  await persistRuntimeState(ctx);
}

export async function tryJoinOpenWaitingRoom(ctx: LobbyContext, me: MatchRequest): Promise<MatchAssignment | null> {
  const openRoom = Array.from(ctx.rooms.values())
    .filter((room) => room.status === 'waiting' && room.players.length === 1)
    .sort((a, b) => b.createdAt - a.createdAt)
    .find((room) => room.players[0].actorId !== me.actorId);
  if (!openRoom) {
    return null;
  }
  const newSeat: PlayerSeat = { side: 2, actorType: me.actorType, actorId: me.actorId, name: me.name, locale: me.locale, seatToken: randomId() };
  const startedAt = Date.now();
  openRoom.players.push(newSeat);
  openRoom.status = 'playing';
  openRoom.lastActiveAt[1] = startedAt;
  openRoom.lastActiveAt[2] = startedAt;
  ctx.seatTokenIndex.set(newSeat.seatToken, { roomId: openRoom.id, side: newSeat.side });
  await persistRuntimeState(ctx);
  const state = roomToState(ctx, openRoom);
  broadcastRoom(ctx, openRoom.id, { type: 'state', state });
  return { ticketId: randomId(), roomId: openRoom.id, seatToken: newSeat.seatToken, side: newSeat.side, state };
}

export function replaceSeatToken(ctx: LobbyContext, roomId: string, side: 1 | 2, newSeatToken: string): void {
  for (const [token, seat] of ctx.seatTokenIndex.entries()) {
    if (seat.roomId === roomId && seat.side === side) {
      ctx.seatTokenIndex.delete(token);
    }
  }
  ctx.seatTokenIndex.set(newSeatToken, { roomId, side });
}

export function deleteSeatTokensByRoom(ctx: LobbyContext, roomId: string): void {
  for (const [token, seat] of ctx.seatTokenIndex.entries()) {
    if (seat.roomId === roomId) {
      ctx.seatTokenIndex.delete(token);
    }
  }
}

export async function recycleRoom(ctx: LobbyContext, roomId: string): Promise<void> {
  ctx.rooms.delete(roomId);
  deleteSeatTokensByRoom(ctx, roomId);
  const timer = ctx.roomCleanupTimers.get(roomId);
  if (timer) {
    clearTimeout(timer);
    ctx.roomCleanupTimers.delete(roomId);
  }
  await persistRuntimeState(ctx);
}
