import { BOARD_SIZE } from '@clawgame/shared';
import { agentHistoryLimit, finishedRoomTtlMs, turnTimeoutMs, waitingRoomTtlMs } from './config';
import type { LobbyContext } from './context';
import { persistAgent, persistAgentHistory, persistRuntimeState } from './persistence';
import { broadcastRoom, broadcastTicket } from './sockets';
import { assignMatch, createRoomWithPlayers, recycleRoom } from './rooms';
import { checkWinner, roomToState } from './rooms';
import type { LiveStatsPayload, MatchRequest, MoveInput, Room } from './types';

export function scheduleFinishedRoomRecycle(ctx: LobbyContext, room: Room): void {
  if (room.status !== 'finished' || ctx.roomCleanupTimers.has(room.id)) {
    return;
  }
  const timer = setTimeout(() => {
    void recycleRoom(ctx, room.id);
  }, finishedRoomTtlMs(ctx));
  ctx.roomCleanupTimers.set(room.id, timer);
}

export async function cleanupStaleWaitingRooms(ctx: LobbyContext, now = Date.now()): Promise<void> {
  for (const room of ctx.rooms.values()) {
    if (room.status !== 'waiting' || room.players.length !== 1) {
      continue;
    }
    const lastActive = room.lastActiveAt[1] ?? room.createdAt;
    if (now - lastActive < waitingRoomTtlMs(ctx)) {
      continue;
    }
    await recycleRoom(ctx, room.id);
  }
}

export async function settleAgentStats(ctx: LobbyContext, room: Room): Promise<void> {
  if (room.status !== 'finished' || !room.finishReason) {
    return;
  }
  const finishedAt = Date.now();
  const durationMs = Math.max(0, finishedAt - room.createdAt);

  for (const player of room.players) {
    if (player.actorType !== 'agent') {
      continue;
    }
    const agent = ctx.agentById.get(player.actorId);
    if (!agent) {
      continue;
    }

    agent.stats.games += 1;
    if (room.winner === 0) {
      agent.stats.draws += 1;
    } else if (room.winner === player.side) {
      agent.stats.wins += 1;
    } else {
      agent.stats.losses += 1;
    }

    const opponent = room.players.find((p) => p.side !== player.side) ?? null;
    const result = room.winner === 0 ? 'draw' : room.winner === player.side ? 'win' : 'loss';
    const history = ctx.agentHistoryById.get(agent.id) ?? [];
    history.push({
      roomId: room.id,
      side: player.side,
      result,
      finishReason: room.finishReason,
      opponent: opponent ? { actorType: opponent.actorType, name: opponent.name, actorId: opponent.actorId } : null,
      mode: opponent?.actorType === 'human' ? 'human_vs_agent' : 'agent_vs_agent',
      moves: room.moves,
      durationMs,
      startedAt: room.createdAt,
      finishedAt,
    });

    const limit = agentHistoryLimit(ctx);
    if (history.length > limit) {
      history.splice(0, history.length - limit);
    }
    ctx.agentHistoryById.set(agent.id, history);
    await persistAgent(ctx, agent);
    await persistAgentHistory(ctx, agent.id);
  }
}

export async function settleTurnTimeout(ctx: LobbyContext, room: Room): Promise<void> {
  if (room.status !== 'playing') {
    return;
  }
  const now = Date.now();
  const currentSide = room.currentTurn;
  const currentLastActive = room.lastActiveAt[currentSide] ?? room.createdAt;
  if (now - currentLastActive <= turnTimeoutMs(ctx)) {
    return;
  }

  room.status = 'finished';
  room.winner = currentSide === 1 ? 2 : 1;
  room.finishReason = 'opponent_timeout';
  await settleAgentStats(ctx, room);
  scheduleFinishedRoomRecycle(ctx, room);
  await persistRuntimeState(ctx);
  broadcastRoom(ctx, room.id, { type: 'state', state: roomToState(ctx, room) });
}

export async function settleAllTurnTimeouts(ctx: LobbyContext): Promise<void> {
  for (const room of ctx.rooms.values()) {
    await settleTurnTimeout(ctx, room);
  }
}

export function computeLiveStats(ctx: LobbyContext): LiveStatsPayload {
  const activeRooms = Array.from(ctx.rooms.values()).filter((room) => room.status === 'waiting' || room.status === 'playing');
  const activePlayers = activeRooms.reduce((sum, room) => sum + room.players.length, 0);
  const waitingRooms = activeRooms.filter((room) => room.status === 'waiting' && room.players.length === 1).length + ctx.waitingByTicket.size;
  return { activePlayers, activeRooms: activeRooms.length, waitingRooms };
}

export async function applyMove(
  ctx: LobbyContext,
  roomId: string,
  seatToken: string | null,
  move: MoveInput,
): Promise<{ status: number; body: unknown }> {
  if (!seatToken) {
    return { status: 401, body: { error: 'missing seat token' } };
  }
  const seat = ctx.seatTokenIndex.get(seatToken);
  if (!seat || seat.roomId !== roomId) {
    return { status: 401, body: { error: 'invalid seat token' } };
  }
  const room = ctx.rooms.get(roomId);
  if (!room) {
    return { status: 404, body: { error: 'room not found' } };
  }

  await settleTurnTimeout(ctx, room);
  if (room.status !== 'playing') {
    return { status: 409, body: { error: 'game not in playing status' } };
  }
  if (room.currentTurn !== seat.side) {
    return { status: 409, body: { error: 'not your turn' } };
  }

  const player = room.players.find((p) => p.side === seat.side);
  if (!player) {
    return { status: 404, body: { error: 'seat player not found' } };
  }
  if (player.actorType === 'agent' && !move.decision) {
    return { status: 400, body: { error: 'decision is required for agent move' } };
  }
  const { x, y } = move;
  if (room.board[y][x] !== 0) {
    return { status: 409, body: { error: 'cell already occupied' } };
  }

  room.board[y][x] = seat.side;
  room.lastActiveAt[seat.side] = Date.now();
  room.moves += 1;
  room.lastMove = { x, y, side: seat.side };
  if (move.decision) {
    room.decisionLogs.push({
      moveNo: room.moves,
      side: seat.side,
      playerName: player.name,
      x,
      y,
      source: player.actorType === 'agent' ? 'agent' : 'heuristic',
      thought: move.decision.thought,
      thoughtOriginal: move.decision.thoughtOriginal,
      createdAt: Date.now(),
    });
  }

  if (checkWinner(room.board, x, y, seat.side)) {
    room.status = 'finished';
    room.winner = seat.side;
    room.finishReason = 'win';
    await settleAgentStats(ctx, room);
    scheduleFinishedRoomRecycle(ctx, room);
  } else if (room.moves >= BOARD_SIZE * BOARD_SIZE) {
    room.status = 'finished';
    room.winner = 0;
    room.finishReason = 'draw_board_full';
    await settleAgentStats(ctx, room);
    scheduleFinishedRoomRecycle(ctx, room);
  } else {
    room.currentTurn = room.currentTurn === 1 ? 2 : 1;
    room.lastActiveAt[room.currentTurn] = Date.now();
  }

  await persistRuntimeState(ctx);
  const state = roomToState(ctx, room);
  broadcastRoom(ctx, room.id, { type: 'state', state });
  return { status: 200, body: state };
}

export function notifyMatchAssigned(
  ctx: LobbyContext,
  ticketId: string,
  roomId: string,
  seatToken: string,
  side: 1 | 2,
  state: ReturnType<typeof roomToState>,
): void {
  broadcastTicket(ctx, ticketId, {
    type: 'matchmaking',
    matched: true,
    ticketId,
    roomId,
    seatToken,
    side,
    state,
  });
}
