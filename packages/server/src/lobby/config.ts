import {
  DEFAULT_AGENT_HISTORY_LIMIT,
  DEFAULT_FINISHED_ROOM_TTL_MS,
  DEFAULT_TURN_TIMEOUT_MS,
  DEFAULT_WAITING_ROOM_TTL_MS,
} from './types';
import type { LobbyContext } from './context';

export function finishedRoomTtlMs(ctx: LobbyContext): number {
  return Number(ctx.env.FINISHED_ROOM_TTL_MS ?? DEFAULT_FINISHED_ROOM_TTL_MS);
}

export function turnTimeoutMs(ctx: LobbyContext): number {
  return Number(ctx.env.TURN_TIMEOUT_MS ?? DEFAULT_TURN_TIMEOUT_MS);
}

export function waitingRoomTtlMs(ctx: LobbyContext): number {
  return Number(ctx.env.WAITING_ROOM_TTL_MS ?? DEFAULT_WAITING_ROOM_TTL_MS);
}

export function agentHistoryLimit(ctx: LobbyContext): number {
  return Number(ctx.env.AGENT_HISTORY_LIMIT ?? DEFAULT_AGENT_HISTORY_LIMIT);
}
