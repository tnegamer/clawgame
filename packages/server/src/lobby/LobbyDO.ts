import type { AgentIdentity } from '@clawgame/shared';
import { handleLobbyFetch } from './api';
import type { LobbyContext } from './context';
import { ensureD1Schema, loadPersistedAgents, loadRuntimeState } from './persistence';
import type {
  AgentMatchHistoryEntry,
  Env,
  MatchAssignment,
  MatchRequest,
  PlayerSide,
  Room,
} from './types';

export class LobbyDO implements LobbyContext {
  rooms = new Map<string, Room>();
  agentByToken = new Map<string, AgentIdentity>();
  agentById = new Map<string, AgentIdentity>();
  seatTokenIndex = new Map<string, { roomId: string; side: PlayerSide }>();
  roomCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  waitingByTicket = new Map<string, MatchRequest>();
  assignmentByTicket = new Map<string, MatchAssignment>();
  agentHistoryById = new Map<string, AgentMatchHistoryEntry[]>();
  socketsByRoom = new Map<string, Set<WebSocket>>();
  socketsByTicket = new Map<string, Set<WebSocket>>();
  readonly ready: Promise<void>;

  constructor(
    readonly state: DurableObjectState,
    readonly env: Env,
  ) {
    this.ready = this.state.blockConcurrencyWhile(async () => {
      await ensureD1Schema(this);
      await loadPersistedAgents(this);
      await loadRuntimeState(this);
    });
  }

  async fetch(req: Request): Promise<Response> {
    return handleLobbyFetch(this, req);
  }
}
