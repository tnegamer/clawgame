import { z } from 'zod';
import type {
  ActorType,
  AgentIdentity,
  Cell,
  DecisionLog,
  GameState,
  PlayerSide,
} from '@clawgame/shared';
import { BOARD_SIZE } from '@clawgame/shared';

export type Env = {
  LOBBY: DurableObjectNamespace;
  DB: D1Database;
  TURN_TIMEOUT_MS?: string;
  FINISHED_ROOM_TTL_MS?: string;
  WAITING_ROOM_TTL_MS?: string;
  AGENT_HISTORY_LIMIT?: string;
};

export type PlayerSeat = {
  side: PlayerSide;
  actorType: ActorType;
  actorId: string;
  name: string;
  locale?: string;
  seatToken: string;
};

export type Room = {
  id: string;
  createdByRoomApi: boolean;
  board: Cell[][];
  status: 'waiting' | 'playing' | 'finished';
  currentTurn: PlayerSide;
  winner: PlayerSide | 0;
  finishReason: 'win' | 'draw_board_full' | 'opponent_timeout' | null;
  moves: number;
  players: PlayerSeat[];
  lastMove: { x: number; y: number; side: PlayerSide } | null;
  decisionLogs: DecisionLog[];
  lastActiveAt: Record<number, number>;
  createdAt: number;
};

export type MatchRequest = {
  actorType: ActorType;
  actorId: string;
  name: string;
  locale?: string;
};

export type MatchAssignment = {
  ticketId: string;
  roomId: string;
  seatToken: string;
  side: PlayerSide;
  state: GameState;
};

export type AgentMatchHistoryEntry = {
  roomId: string;
  side: PlayerSide;
  result: 'win' | 'loss' | 'draw';
  finishReason: 'win' | 'draw_board_full' | 'opponent_timeout';
  opponent: {
    actorType: ActorType;
    name: string;
    actorId: string;
  } | null;
  mode: 'agent_vs_agent' | 'human_vs_agent';
  moves: number;
  durationMs: number;
  startedAt: number;
  finishedAt: number;
};

export type LiveStatsPayload = {
  activePlayers: number;
  activeRooms: number;
  waitingRooms: number;
};

export type RuntimeSnapshot = {
  rooms: Record<string, Room>;
  seatTokenIndex: Record<string, { roomId: string; side: PlayerSide }>;
  waitingByTicket: Record<string, MatchRequest>;
  assignmentByTicket: Record<string, MatchAssignment>;
};

export type AgentRow = {
  id: string;
  name: string;
  provider: string;
  model: string | null;
  token: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
};

export type AgentHistoryRow = {
  agent_id: string;
  room_id: string;
  side: number;
  result: AgentMatchHistoryEntry['result'];
  finish_reason: AgentMatchHistoryEntry['finishReason'];
  opponent_actor_type: ActorType | null;
  opponent_name: string | null;
  opponent_actor_id: string | null;
  mode: AgentMatchHistoryEntry['mode'];
  moves: number;
  duration_ms: number;
  started_at: number;
  finished_at: number;
};

export const DEFAULT_TURN_TIMEOUT_MS = 120_000;
export const DEFAULT_FINISHED_ROOM_TTL_MS = 30_000;
export const DEFAULT_WAITING_ROOM_TTL_MS = 300_000;
export const DEFAULT_AGENT_HISTORY_LIMIT = 200;
export const DO_RUNTIME_STATE_KEY = 'runtime:v1';

export const registerAgentSchema = z.object({
  name: z.string().min(1).max(50),
  provider: z.string().min(1).max(50),
  model: z.string().max(100).optional(),
});

export const createRoomSchema = z.object({
  actorType: z.enum(['human', 'agent']),
  name: z.string().min(1).max(50),
  locale: z.string().min(2).max(20).optional(),
  clientToken: z.string().min(1).max(100).optional(),
});

export const joinRoomSchema = z.object({
  actorType: z.enum(['human', 'agent']),
  name: z.string().min(1).max(50),
  locale: z.string().min(2).max(20).optional(),
  clientToken: z.string().min(1).max(100).optional(),
});

export const matchmakingJoinSchema = z.object({
  actorType: z.enum(['human', 'agent']),
  name: z.string().min(1).max(50),
  locale: z.string().min(2).max(20).optional(),
  clientToken: z.string().min(1).max(100).optional(),
});

export const moveSchema = z.object({
  x: z.number().int().min(0).max(BOARD_SIZE - 1),
  y: z.number().int().min(0).max(BOARD_SIZE - 1),
  decision: z
    .object({
      thought: z.string().min(1).max(500),
      thoughtOriginal: z.string().min(1).max(500).optional(),
    })
    .optional(),
});

export type MoveInput = z.infer<typeof moveSchema>;
export type { AgentIdentity, ActorType, GameState, PlayerSide, Cell };
