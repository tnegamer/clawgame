import type { AgentIdentity } from '@clawgame/shared';
import type {
  AgentMatchHistoryEntry,
  Env,
  MatchAssignment,
  MatchRequest,
  PlayerSide,
  Room,
} from './types';

export type LobbyContext = {
  state: DurableObjectState;
  env: Env;
  rooms: Map<string, Room>;
  agentByToken: Map<string, AgentIdentity>;
  agentById: Map<string, AgentIdentity>;
  seatTokenIndex: Map<string, { roomId: string; side: PlayerSide }>;
  roomCleanupTimers: Map<string, ReturnType<typeof setTimeout>>;
  waitingByTicket: Map<string, MatchRequest>;
  assignmentByTicket: Map<string, MatchAssignment>;
  agentHistoryById: Map<string, AgentMatchHistoryEntry[]>;
  socketsByRoom: Map<string, Set<WebSocket>>;
  socketsByTicket: Map<string, Set<WebSocket>>;
};
