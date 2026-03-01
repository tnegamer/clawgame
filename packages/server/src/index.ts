import { z } from 'zod';
import {
  BOARD_SIZE,
  WIN_COUNT,
  type ActorType,
  type AgentIdentity,
  type Cell,
  type DecisionLog,
  type GameState,
  type PlayerSide,
} from '@clawgame/shared';

type Env = {
  LOBBY: DurableObjectNamespace;
  TURN_TIMEOUT_MS?: string;
  FINISHED_ROOM_TTL_MS?: string;
  WAITING_ROOM_TTL_MS?: string;
  AGENT_HISTORY_LIMIT?: string;
};

type PlayerSeat = {
  side: PlayerSide;
  actorType: ActorType;
  actorId: string;
  name: string;
  locale?: string;
  seatToken: string;
};

type Room = {
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

type MatchRequest = {
  actorType: ActorType;
  actorId: string;
  name: string;
  locale?: string;
};

type MatchAssignment = {
  ticketId: string;
  roomId: string;
  seatToken: string;
  side: PlayerSide;
  state: GameState;
};

type AgentMatchHistoryEntry = {
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

type LiveStatsPayload = {
  activePlayers: number;
  activeRooms: number;
  waitingRooms: number;
};

const DEFAULT_TURN_TIMEOUT_MS = 120_000;
const DEFAULT_FINISHED_ROOM_TTL_MS = 30_000;
const DEFAULT_WAITING_ROOM_TTL_MS = 300_000;
const DEFAULT_AGENT_HISTORY_LIMIT = 200;
const AGENT_ID_KEY_PREFIX = 'agent:id:';
const AGENT_HISTORY_KEY_PREFIX = 'agent:history:';

const registerAgentSchema = z.object({
  name: z.string().min(1).max(50),
  provider: z.string().min(1).max(50),
  model: z.string().max(100).optional(),
});

const createRoomSchema = z.object({
  actorType: z.enum(['human', 'agent']),
  name: z.string().min(1).max(50),
  locale: z.string().min(2).max(20).optional(),
  clientToken: z.string().min(1).max(100).optional(),
});

const joinRoomSchema = z.object({
  actorType: z.enum(['human', 'agent']),
  name: z.string().min(1).max(50),
  locale: z.string().min(2).max(20).optional(),
  clientToken: z.string().min(1).max(100).optional(),
});

const matchmakingJoinSchema = z.object({
  actorType: z.enum(['human', 'agent']),
  name: z.string().min(1).max(50),
  locale: z.string().min(2).max(20).optional(),
  clientToken: z.string().min(1).max(100).optional(),
});

const moveSchema = z.object({
  x: z.number().int().min(0).max(BOARD_SIZE - 1),
  y: z.number().int().min(0).max(BOARD_SIZE - 1),
  decision: z
    .object({
      thought: z.string().min(1).max(500),
      thoughtOriginal: z.string().min(1).max(500).optional(),
    })
    .optional(),
});

function randomId(): string {
  return crypto.randomUUID();
}

function boardEmpty(): Cell[][] {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => 0 as Cell),
  );
}

function getBearerToken(req: Request): string | null {
  const auth = req.headers.get('authorization') ?? '';
  const parts = auth.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return parts[1];
  }
  return null;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type,authorization',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    },
  });
}

function text(body: string, contentType: string): Response {
  return new Response(body, {
    headers: {
      'content-type': contentType,
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type,authorization',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    },
  });
}

function optionsResponse(): Response {
  return new Response(null, {
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type,authorization',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    },
  });
}

async function parseBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export class LobbyDO {
  private rooms = new Map<string, Room>();
  private agentByToken = new Map<string, AgentIdentity>();
  private agentById = new Map<string, AgentIdentity>();
  private seatTokenIndex = new Map<string, { roomId: string; side: PlayerSide }>();
  private roomCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private waitingByTicket = new Map<string, MatchRequest>();
  private assignmentByTicket = new Map<string, MatchAssignment>();
  private agentHistoryById = new Map<string, AgentMatchHistoryEntry[]>();
  private socketsByRoom = new Map<string, Set<WebSocket>>();
  private socketsByTicket = new Map<string, Set<WebSocket>>();
  private readonly ready: Promise<void>;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {
    this.ready = this.state.blockConcurrencyWhile(async () => {
      await this.loadPersistedAgents();
    });
  }

  private agentIdentityKey(agentId: string): string {
    return `${AGENT_ID_KEY_PREFIX}${agentId}`;
  }

  private agentHistoryKey(agentId: string): string {
    return `${AGENT_HISTORY_KEY_PREFIX}${agentId}`;
  }

  private async loadPersistedAgents(): Promise<void> {
    const persistedAgents = await this.state.storage.list<AgentIdentity>({ prefix: AGENT_ID_KEY_PREFIX });
    this.agentById.clear();
    this.agentByToken.clear();
    for (const agent of persistedAgents.values()) {
      this.agentById.set(agent.id, agent);
      this.agentByToken.set(agent.token, agent);
    }

    const persistedHistories = await this.state.storage.list<AgentMatchHistoryEntry[]>({ prefix: AGENT_HISTORY_KEY_PREFIX });
    this.agentHistoryById.clear();
    for (const [key, history] of persistedHistories.entries()) {
      const agentId = key.slice(AGENT_HISTORY_KEY_PREFIX.length);
      this.agentHistoryById.set(agentId, history);
    }

    for (const agentId of this.agentById.keys()) {
      if (!this.agentHistoryById.has(agentId)) {
        this.agentHistoryById.set(agentId, []);
      }
    }
  }

  private async persistAgent(agent: AgentIdentity): Promise<void> {
    await this.state.storage.put(this.agentIdentityKey(agent.id), agent);
  }

  private async persistAgentHistory(agentId: string): Promise<void> {
    const history = this.agentHistoryById.get(agentId) ?? [];
    await this.state.storage.put(this.agentHistoryKey(agentId), history);
  }

  private finishedRoomTtlMs(): number {
    return Number(this.env.FINISHED_ROOM_TTL_MS ?? DEFAULT_FINISHED_ROOM_TTL_MS);
  }

  private turnTimeoutMs(): number {
    return Number(this.env.TURN_TIMEOUT_MS ?? DEFAULT_TURN_TIMEOUT_MS);
  }

  private waitingRoomTtlMs(): number {
    return Number(this.env.WAITING_ROOM_TTL_MS ?? DEFAULT_WAITING_ROOM_TTL_MS);
  }

  private agentHistoryLimit(): number {
    return Number(this.env.AGENT_HISTORY_LIMIT ?? DEFAULT_AGENT_HISTORY_LIMIT);
  }

  private roomToState(room: Room): GameState {
    const turnTimeoutMs = this.turnTimeoutMs();
    const turnDeadlineAt =
      room.status === 'playing'
        ? (room.lastActiveAt[room.currentTurn] ?? room.createdAt) + turnTimeoutMs
        : null;

    return {
      roomId: room.id,
      status: room.status,
      board: room.board,
      currentTurn: room.currentTurn,
      turnDeadlineAt,
      turnTimeoutMs,
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

  private createRoomWithPlayer(actorType: ActorType, actorId: string, name: string): { room: Room; seat: PlayerSeat } {
    const roomId = randomId();
    const seat: PlayerSeat = {
      side: 1,
      actorType,
      actorId,
      name,
      locale: undefined,
      seatToken: randomId(),
    };

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
      lastActiveAt: { 1: Date.now(), 2: Date.now() },
      createdAt: Date.now(),
    };

    this.rooms.set(roomId, room);
    this.seatTokenIndex.set(seat.seatToken, { roomId, side: seat.side });
    return { room, seat };
  }

  private createRoomWithPlayers(left: MatchRequest, right: MatchRequest): { room: Room; leftSeat: PlayerSeat; rightSeat: PlayerSeat } {
    const roomId = randomId();
    const leftSeat: PlayerSeat = {
      side: 1,
      actorType: left.actorType,
      actorId: left.actorId,
      name: left.name,
      locale: left.locale,
      seatToken: randomId(),
    };
    const rightSeat: PlayerSeat = {
      side: 2,
      actorType: right.actorType,
      actorId: right.actorId,
      name: right.name,
      locale: right.locale,
      seatToken: randomId(),
    };

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
      lastActiveAt: { 1: Date.now(), 2: Date.now() },
      createdAt: Date.now(),
    };

    this.rooms.set(roomId, room);
    this.seatTokenIndex.set(leftSeat.seatToken, { roomId, side: leftSeat.side });
    this.seatTokenIndex.set(rightSeat.seatToken, { roomId, side: rightSeat.side });
    return { room, leftSeat, rightSeat };
  }

  private assignMatch(leftTicketId: string, rightTicketId: string): void {
    const left = this.waitingByTicket.get(leftTicketId);
    const right = this.waitingByTicket.get(rightTicketId);
    if (!left || !right) {
      return;
    }

    const { room, leftSeat, rightSeat } = this.createRoomWithPlayers(left, right);
    const state = this.roomToState(room);
    this.assignmentByTicket.set(leftTicketId, {
      ticketId: leftTicketId,
      roomId: room.id,
      seatToken: leftSeat.seatToken,
      side: leftSeat.side,
      state,
    });
    this.assignmentByTicket.set(rightTicketId, {
      ticketId: rightTicketId,
      roomId: room.id,
      seatToken: rightSeat.seatToken,
      side: rightSeat.side,
      state,
    });
    this.broadcastTicket(leftTicketId, {
      type: 'matchmaking',
      matched: true,
      ticketId: leftTicketId,
      roomId: room.id,
      seatToken: leftSeat.seatToken,
      side: leftSeat.side,
      state,
    });
    this.broadcastTicket(rightTicketId, {
      type: 'matchmaking',
      matched: true,
      ticketId: rightTicketId,
      roomId: room.id,
      seatToken: rightSeat.seatToken,
      side: rightSeat.side,
      state,
    });
    this.waitingByTicket.delete(leftTicketId);
    this.waitingByTicket.delete(rightTicketId);
    this.broadcastRoom(room.id, { type: 'state', state });
  }

  private findActiveSeatByActorId(actorId: string): { room: Room; seat: PlayerSeat } | null {
    for (const room of this.rooms.values()) {
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

  private findWaitingTicketByActorId(actorId: string): string | null {
    for (const [ticketId, entry] of this.waitingByTicket.entries()) {
      if (entry.actorId === actorId) {
        return ticketId;
      }
    }
    return null;
  }

  private tryJoinOpenWaitingRoom(me: MatchRequest): MatchAssignment | null {
    const openRoom = Array.from(this.rooms.values())
      .filter((room) => room.status === 'waiting' && room.players.length === 1)
      .sort((a, b) => b.createdAt - a.createdAt)
      .find((room) => room.players[0].actorId !== me.actorId);

    if (!openRoom) {
      return null;
    }

    const newSeat: PlayerSeat = {
      side: 2,
      actorType: me.actorType,
      actorId: me.actorId,
      name: me.name,
      locale: me.locale,
      seatToken: randomId(),
    };

    const startedAt = Date.now();
    openRoom.players.push(newSeat);
    openRoom.status = 'playing';
    openRoom.lastActiveAt[1] = startedAt;
    openRoom.lastActiveAt[2] = startedAt;
    this.seatTokenIndex.set(newSeat.seatToken, { roomId: openRoom.id, side: newSeat.side });

    const state = this.roomToState(openRoom);
    this.broadcastRoom(openRoom.id, { type: 'state', state });
    return {
      ticketId: randomId(),
      roomId: openRoom.id,
      seatToken: newSeat.seatToken,
      side: newSeat.side,
      state,
    };
  }

  private checkWinner(board: Cell[][], x: number, y: number, side: PlayerSide): boolean {
    const dirs = [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1],
    ];

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

  private getAgentFromAuth(req: Request): AgentIdentity | null {
    const token = getBearerToken(req);
    if (!token) {
      return null;
    }
    return this.agentByToken.get(token) ?? null;
  }

  private replaceSeatToken(roomId: string, side: PlayerSide, newSeatToken: string): void {
    for (const [token, seat] of this.seatTokenIndex.entries()) {
      if (seat.roomId === roomId && seat.side === side) {
        this.seatTokenIndex.delete(token);
      }
    }
    this.seatTokenIndex.set(newSeatToken, { roomId, side });
  }

  private deleteSeatTokensByRoom(roomId: string): void {
    for (const [token, seat] of this.seatTokenIndex.entries()) {
      if (seat.roomId === roomId) {
        this.seatTokenIndex.delete(token);
      }
    }
  }

  private recycleRoom(roomId: string): void {
    this.rooms.delete(roomId);
    this.deleteSeatTokensByRoom(roomId);
    const timer = this.roomCleanupTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.roomCleanupTimers.delete(roomId);
    }
  }

  private scheduleFinishedRoomRecycle(room: Room): void {
    if (room.status !== 'finished') {
      return;
    }
    if (this.roomCleanupTimers.has(room.id)) {
      return;
    }

    const timer = setTimeout(() => {
      this.recycleRoom(room.id);
    }, this.finishedRoomTtlMs());
    this.roomCleanupTimers.set(room.id, timer);
  }

  private cleanupStaleWaitingRooms(now = Date.now()): void {
    for (const room of this.rooms.values()) {
      if (room.status !== 'waiting' || room.players.length !== 1) {
        continue;
      }
      const lastActive = room.lastActiveAt[1] ?? room.createdAt;
      if (now - lastActive < this.waitingRoomTtlMs()) {
        continue;
      }
      this.recycleRoom(room.id);
    }
  }

  private async settleTurnTimeout(room: Room): Promise<void> {
    if (room.status !== 'playing') {
      return;
    }
    const now = Date.now();
    const currentSide = room.currentTurn;
    const currentLastActive = room.lastActiveAt[currentSide] ?? room.createdAt;
    if (now - currentLastActive <= this.turnTimeoutMs()) {
      return;
    }

    room.status = 'finished';
    room.winner = currentSide === 1 ? 2 : 1;
    room.finishReason = 'opponent_timeout';
    await this.settleAgentStats(room);
    this.scheduleFinishedRoomRecycle(room);
    this.broadcastRoom(room.id, { type: 'state', state: this.roomToState(room) });
  }

  private async settleAllTurnTimeouts(): Promise<void> {
    for (const room of this.rooms.values()) {
      await this.settleTurnTimeout(room);
    }
  }

  private computeLiveStats(): LiveStatsPayload {
    const activeRooms = Array.from(this.rooms.values()).filter((room) =>
      room.status === 'waiting' || room.status === 'playing',
    );
    const activePlayers = activeRooms.reduce((sum, room) => sum + room.players.length, 0);
    const waitingRooms =
      activeRooms.filter((room) => room.status === 'waiting' && room.players.length === 1).length +
      this.waitingByTicket.size;
    return { activePlayers, activeRooms: activeRooms.length, waitingRooms };
  }

  private broadcastRoom(roomId: string, payload: unknown): void {
    const clients = this.socketsByRoom.get(roomId);
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

  private broadcastTicket(ticketId: string, payload: unknown): void {
    const clients = this.socketsByTicket.get(ticketId);
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

  private async settleAgentStats(room: Room): Promise<void> {
    if (room.status !== 'finished') {
      return;
    }
    if (!room.finishReason) {
      return;
    }

    const finishedAt = Date.now();
    const durationMs = Math.max(0, finishedAt - room.createdAt);

    for (const player of room.players) {
      if (player.actorType !== 'agent') {
        continue;
      }

      const agent = this.agentById.get(player.actorId);
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
      const result: AgentMatchHistoryEntry['result'] =
        room.winner === 0 ? 'draw' : room.winner === player.side ? 'win' : 'loss';
      const history = this.agentHistoryById.get(agent.id) ?? [];
      history.push({
        roomId: room.id,
        side: player.side,
        result,
        finishReason: room.finishReason,
        opponent: opponent
          ? { actorType: opponent.actorType, name: opponent.name, actorId: opponent.actorId }
          : null,
        mode: opponent?.actorType === 'human' ? 'human_vs_agent' : 'agent_vs_agent',
        moves: room.moves,
        durationMs,
        startedAt: room.createdAt,
        finishedAt,
      });
      if (history.length > this.agentHistoryLimit()) {
        history.splice(0, history.length - this.agentHistoryLimit());
      }
      this.agentHistoryById.set(agent.id, history);
      await this.persistAgent(agent);
      await this.persistAgentHistory(agent.id);
    }
  }

  private async applyMove(
    roomId: string,
    seatToken: string | null,
    move: z.infer<typeof moveSchema>,
  ): Promise<{ status: number; body: unknown }> {
    if (!seatToken) {
      return { status: 401, body: { error: 'missing seat token' } };
    }

    const seat = this.seatTokenIndex.get(seatToken);
    if (!seat || seat.roomId !== roomId) {
      return { status: 401, body: { error: 'invalid seat token' } };
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return { status: 404, body: { error: 'room not found' } };
    }

    await this.settleTurnTimeout(room);
    if (room.status !== 'playing') {
      return { status: 409, body: { error: 'game not in playing status' } };
    }

    if (room.currentTurn !== seat.side) {
      return { status: 409, body: { error: 'not your turn' } };
    }

    const { x, y } = move;
    if (room.board[y][x] !== 0) {
      return { status: 409, body: { error: 'cell already occupied' } };
    }

    room.board[y][x] = seat.side;
    room.lastActiveAt[seat.side] = Date.now();
    room.moves += 1;
    room.lastMove = { x, y, side: seat.side };
    const player = room.players.find((p) => p.side === seat.side);
    if (move.decision && player) {
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

    if (this.checkWinner(room.board, x, y, seat.side)) {
      room.status = 'finished';
      room.winner = seat.side;
      room.finishReason = 'win';
      await this.settleAgentStats(room);
      this.scheduleFinishedRoomRecycle(room);
    } else if (room.moves >= BOARD_SIZE * BOARD_SIZE) {
      room.status = 'finished';
      room.winner = 0;
      room.finishReason = 'draw_board_full';
      await this.settleAgentStats(room);
      this.scheduleFinishedRoomRecycle(room);
    } else {
      room.currentTurn = room.currentTurn === 1 ? 2 : 1;
      room.lastActiveAt[room.currentTurn] = Date.now();
    }

    const state = this.roomToState(room);
    this.broadcastRoom(room.id, { type: 'state', state });
    return { status: 200, body: state };
  }

  private handleWs(req: Request): Response {
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
            await this.settleAllTurnTimeouts();
            server.send(JSON.stringify({ type: 'live', ...this.computeLiveStats() }));
            return;
          }

          if (messageType === 'move') {
            const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
            const targetRoomIdRaw = typeof payload.roomId === 'string' ? payload.roomId : roomId;
            const targetRoomId = targetRoomIdRaw ?? '';
            const targetSeatToken = typeof payload.seatToken === 'string' ? payload.seatToken : '';
            if (!targetRoomId) {
              server.send(JSON.stringify({
                type: 'move_result',
                requestId,
                ok: false,
                status: 400,
                error: 'missing room id',
              }));
              return;
            }
            if (!targetSeatToken) {
              server.send(JSON.stringify({
                type: 'move_result',
                requestId,
                ok: false,
                status: 401,
                error: 'missing seat token',
              }));
              return;
            }
            const parsedMove = moveSchema.safeParse({
              x: payload.x,
              y: payload.y,
              decision: payload.decision,
            });
            if (!parsedMove.success) {
              server.send(JSON.stringify({
                type: 'move_result',
                requestId,
                ok: false,
                status: 400,
                error: parsedMove.error.flatten(),
              }));
              return;
            }

            const result = await this.applyMove(targetRoomId, targetSeatToken, parsedMove.data);
            if (result.status === 200) {
              server.send(JSON.stringify({
                type: 'move_result',
                requestId,
                ok: true,
                state: result.body,
              }));
            } else {
              server.send(JSON.stringify({
                type: 'move_result',
                requestId,
                ok: false,
                status: result.status,
                error: (result.body as { error?: unknown })?.error ?? 'move failed',
              }));
            }
          }
        } catch {
          // ignore malformed ws message
        }
      })();
    });

    if (roomId) {
      const set = this.socketsByRoom.get(roomId) ?? new Set<WebSocket>();
      set.add(server);
      this.socketsByRoom.set(roomId, set);

      const room = this.rooms.get(roomId);
      if (room) {
        server.send(JSON.stringify({ type: 'state', state: this.roomToState(room) }));
      }

      const cleanup = () => {
        const current = this.socketsByRoom.get(roomId);
        if (!current) {
          return;
        }
        current.delete(server);
        if (current.size === 0) {
          this.socketsByRoom.delete(roomId);
        }
      };

      server.addEventListener('close', cleanup);
      server.addEventListener('error', cleanup);
    }

    if (ticketId) {
      const set = this.socketsByTicket.get(ticketId) ?? new Set<WebSocket>();
      set.add(server);
      this.socketsByTicket.set(ticketId, set);

      const assignment = this.assignmentByTicket.get(ticketId);
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
      } else if (this.waitingByTicket.has(ticketId)) {
        server.send(JSON.stringify({ type: 'matchmaking', matched: false, ticketId }));
      }

      const cleanup = () => {
        const current = this.socketsByTicket.get(ticketId);
        if (!current) {
          return;
        }
        current.delete(server);
        if (current.size === 0) {
          this.socketsByTicket.delete(ticketId);
        }
      };
      server.addEventListener('close', cleanup);
      server.addEventListener('error', cleanup);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async fetch(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') {
      return optionsResponse();
    }
    await this.ready;

    this.cleanupStaleWaitingRooms();

    const url = new URL(req.url);
    const { pathname } = url;

    if (pathname === '/ws') {
      return this.handleWs(req);
    }

    if (req.method === 'GET' && pathname === '/health') {
      return json({ ok: true, rooms: this.rooms.size, agentPlayers: this.agentById.size });
    }

    if (req.method === 'GET' && pathname === '/api/stats/live') {
      await this.settleAllTurnTimeouts();
      return json(this.computeLiveStats());
    }

    if (req.method === 'POST' && pathname === '/api/agent/register') {
      const parsed = registerAgentSchema.safeParse(await parseBody(req));
      if (!parsed.success) {
        return json({ error: parsed.error.flatten() }, 400);
      }

      const agent: AgentIdentity = {
        id: randomId(),
        name: parsed.data.name,
        provider: parsed.data.provider,
        model: parsed.data.model,
        token: randomId(),
        stats: {
          games: 0,
          wins: 0,
          losses: 0,
          draws: 0,
        },
      };

      this.agentByToken.set(agent.token, agent);
      this.agentById.set(agent.id, agent);
      this.agentHistoryById.set(agent.id, []);
      await this.persistAgent(agent);
      await this.persistAgentHistory(agent.id);

      return json({ token: agent.token, profile: agent }, 201);
    }

    if (req.method === 'GET' && pathname === '/api/agent/me') {
      const agent = this.getAgentFromAuth(req);
      if (!agent) {
        return json({ error: 'invalid agent token' }, 401);
      }
      return json(agent);
    }

    if (req.method === 'GET' && pathname === '/api/agent/history') {
      const agent = this.getAgentFromAuth(req);
      if (!agent) {
        return json({ error: 'invalid agent token' }, 401);
      }

      const limitRaw = Number(url.searchParams.get('limit') ?? 50);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50;
      const fullHistory = this.agentHistoryById.get(agent.id) ?? [];
      const recent = [...fullHistory].reverse().slice(0, limit);

      const summarize = (items: AgentMatchHistoryEntry[]) => {
        const games = items.length;
        const wins = items.filter((h) => h.result === 'win').length;
        const losses = items.filter((h) => h.result === 'loss').length;
        const draws = items.filter((h) => h.result === 'draw').length;
        const totalDurationMs = items.reduce((sum, h) => sum + h.durationMs, 0);
        const avgDurationMs = games === 0 ? 0 : Math.round(totalDurationMs / games);
        const shortestDurationMs = games === 0 ? 0 : Math.min(...items.map((h) => h.durationMs));
        const longestDurationMs = games === 0 ? 0 : Math.max(...items.map((h) => h.durationMs));
        return {
          games,
          wins,
          losses,
          draws,
          winRate: games === 0 ? 0 : Number((wins / games).toFixed(3)),
          totalDurationMs,
          avgDurationMs,
          shortestDurationMs,
          longestDurationMs,
        };
      };

      const vsHuman = fullHistory.filter((h) => h.mode === 'human_vs_agent');
      const vsAgent = fullHistory.filter((h) => h.mode === 'agent_vs_agent');

      return json({
        profile: {
          id: agent.id,
          name: agent.name,
          provider: agent.provider,
          model: agent.model,
        },
        summary: {
          overall: summarize(fullHistory),
          vsHuman: summarize(vsHuman),
          vsAgent: summarize(vsAgent),
        },
        history: recent,
      });
    }

    if (req.method === 'GET' && pathname === '/api/stats/agent') {
      const leaderboard = Array.from(this.agentById.values())
        .map((agent) => ({
          id: agent.id,
          name: agent.name,
          provider: agent.provider,
          model: agent.model,
          ...agent.stats,
          winRate: agent.stats.games === 0 ? 0 : Number((agent.stats.wins / agent.stats.games).toFixed(3)),
        }))
        .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate);

      return json({ leaderboard });
    }

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

      const existing = this.findActiveSeatByActorId(actorId);
      if (existing) {
        return json({
          roomId: existing.room.id,
          seatToken: existing.seat.seatToken,
          side: existing.seat.side,
          state: this.roomToState(existing.room),
          reused: true,
        });
      }

      const { room, seat } = this.createRoomWithPlayer(parsed.data.actorType, actorId, parsed.data.name);
      seat.locale = parsed.data.locale;
      return json({
        roomId: room.id,
        seatToken: seat.seatToken,
        side: seat.side,
        state: this.roomToState(room),
      }, 201);
    }

    if (req.method === 'POST' && pathname === '/api/matchmaking/join') {
      const parsed = matchmakingJoinSchema.safeParse(await parseBody(req));
      if (!parsed.success) {
        return json({ error: parsed.error.flatten() }, 400);
      }

      let actorId = randomId();
      if (parsed.data.actorType === 'agent') {
        const agent = this.getAgentFromAuth(req);
        if (!agent) {
          return json({ error: 'invalid agent token' }, 401);
        }
        actorId = agent.id;
      } else {
        actorId = parsed.data.clientToken ?? actorId;
      }

      const ticketId = randomId();
      const me: MatchRequest = {
        actorType: parsed.data.actorType,
        actorId,
        name: parsed.data.name,
        locale: parsed.data.locale,
      };

      const existingSeat = this.findActiveSeatByActorId(actorId);
      if (existingSeat) {
        return json({
          matched: existingSeat.room.status === 'playing',
          ticketId,
          roomId: existingSeat.room.id,
          seatToken: existingSeat.seat.seatToken,
          side: existingSeat.seat.side,
          state: this.roomToState(existingSeat.room),
          reused: true,
        });
      }

      const existingTicketId = this.findWaitingTicketByActorId(actorId);
      if (existingTicketId) {
        return json({ matched: false, ticketId: existingTicketId, reused: true }, 202);
      }

      const directJoin = this.tryJoinOpenWaitingRoom(me);
      if (directJoin) {
        return json({
          matched: true,
          ticketId,
          roomId: directJoin.roomId,
          seatToken: directJoin.seatToken,
          side: directJoin.side,
          state: directJoin.state,
        }, 201);
      }

      this.waitingByTicket.set(ticketId, me);

      const opponentTicketId = Array.from(this.waitingByTicket.entries())
        .find(([candidateTicketId, candidate]) => candidateTicketId !== ticketId && candidate.actorId !== me.actorId)?.[0];

      if (!opponentTicketId) {
        return json({ matched: false, ticketId }, 202);
      }

      this.assignMatch(opponentTicketId, ticketId);
      const assignment = this.assignmentByTicket.get(ticketId);
      if (!assignment) {
        return json({ error: 'failed to assign matchmaking room' }, 500);
      }
      this.assignmentByTicket.delete(ticketId);
      return json({
        matched: true,
        ticketId,
        roomId: assignment.roomId,
        seatToken: assignment.seatToken,
        side: assignment.side,
        state: assignment.state,
      }, 201);
    }

    const matchmakingMatch = pathname.match(/^\/api\/matchmaking\/([^/]+)$/);
    if (req.method === 'GET' && matchmakingMatch) {
      const ticketId = matchmakingMatch[1];
      const assignment = this.assignmentByTicket.get(ticketId);
      if (assignment) {
        this.assignmentByTicket.delete(ticketId);
        return json({
          matched: true,
          ticketId: assignment.ticketId,
          roomId: assignment.roomId,
          seatToken: assignment.seatToken,
          side: assignment.side,
          state: assignment.state,
        });
      }

      if (this.waitingByTicket.has(ticketId)) {
        return json({ matched: false, ticketId }, 202);
      }

      return json({ error: 'ticket not found' }, 404);
    }

    const joinMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/join$/);
    if (req.method === 'POST' && joinMatch) {
      const roomId = joinMatch[1];
      const parsed = joinRoomSchema.safeParse(await parseBody(req));
      if (!parsed.success) {
        return json({ error: parsed.error.flatten() }, 400);
      }

      const room = this.rooms.get(roomId);
      if (!room) {
        return json({ error: 'room not found' }, 404);
      }

      let actorId = randomId();
      if (parsed.data.actorType === 'agent') {
        const agent = this.getAgentFromAuth(req);
        if (!agent) {
          return json({ error: 'invalid agent token' }, 401);
        }
        actorId = agent.id;
      } else {
        actorId = parsed.data.clientToken ?? actorId;
      }

      const existingSeat = room.players.find((p) => p.actorType === parsed.data.actorType && p.actorId === actorId);
      if (existingSeat) {
        return json({
          seatToken: existingSeat.seatToken,
          side: existingSeat.side,
          state: this.roomToState(room),
          reused: true,
        });
      }

      if (room.players.length >= 2) {
        return json({ error: 'room full' }, 409);
      }

      const newSeat: PlayerSeat = {
        side: 2,
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
      this.seatTokenIndex.set(newSeat.seatToken, { roomId: room.id, side: newSeat.side });

      const state = this.roomToState(room);
      this.broadcastRoom(room.id, { type: 'state', state });
      return json({ seatToken: newSeat.seatToken, side: newSeat.side, state }, 201);
    }

    const reconnectMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/reconnect$/);
    if (req.method === 'POST' && reconnectMatch) {
      const roomId = reconnectMatch[1];
      const agent = this.getAgentFromAuth(req);
      if (!agent) {
        return json({ error: 'invalid agent token' }, 401);
      }

      const room = this.rooms.get(roomId);
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
      this.replaceSeatToken(room.id, seat.side, newSeatToken);
      return json({ seatToken: newSeatToken, side: seat.side, state: this.roomToState(room) });
    }

    const leaveMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/leave$/);
    if (req.method === 'POST' && leaveMatch) {
      const roomId = leaveMatch[1];
      const seatToken = getBearerToken(req);
      if (!seatToken) {
        return json({ error: 'missing seat token' }, 401);
      }

      const seat = this.seatTokenIndex.get(seatToken);
      if (!seat || seat.roomId !== roomId) {
        return json({ error: 'invalid seat token' }, 401);
      }

      const room = this.rooms.get(roomId);
      if (!room) {
        return json({ error: 'room not found' }, 404);
      }

      const shouldCloseRoom = room.createdByRoomApi && seat.side === 1;
      if (!shouldCloseRoom) {
        return json({ closed: false });
      }

      this.broadcastRoom(room.id, { type: 'room_closed' });
      this.recycleRoom(room.id);
      return json({ closed: true });
    }

    const stateMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/state$/);
    if (req.method === 'GET' && stateMatch) {
      const roomId = stateMatch[1];
      const room = this.rooms.get(roomId);
      if (!room) {
        return json({ error: 'room not found' }, 404);
      }

      await this.settleTurnTimeout(room);
      return json(this.roomToState(room));
    }

    const logsMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/logs$/);
    if (req.method === 'GET' && logsMatch) {
      const roomId = logsMatch[1];
      const room = this.rooms.get(roomId);
      if (!room) {
        return json({ error: 'room not found' }, 404);
      }
      return json({ roomId: room.id, logs: room.decisionLogs });
    }

    if (req.method === 'GET' && pathname === '/api/rooms/open') {
      const openRooms = Array.from(this.rooms.values())
        .filter((room) => room.status === 'waiting' && room.players.length === 1)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((room) => ({
          roomId: room.id,
          createdAt: room.createdAt,
          owner: {
            actorType: room.players[0].actorType,
            name: room.players[0].name,
          },
        }));

      return json({ openRooms });
    }

    if (req.method === 'GET' && pathname === '/api/rooms/active') {
      await this.settleAllTurnTimeouts();
      const activeRooms = Array.from(this.rooms.values())
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
      const roomId = moveMatch[1];
      const parsedMove = moveSchema.safeParse(await parseBody(req));
      if (!parsedMove.success) {
        return json({ error: parsedMove.error.flatten() }, 400);
      }
      const result = await this.applyMove(roomId, getBearerToken(req), parsedMove.data);
      return json(result.body, result.status);
    }

    return json({ error: 'not found' }, 404);
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') {
      return optionsResponse();
    }

    const url = new URL(req.url);
    if (url.pathname === '/favicon.ico') {
      return new Response(null, { status: 204 });
    }

    const id = env.LOBBY.idFromName('global');
    const stub = env.LOBBY.get(id);
    return stub.fetch(req);
  },
};
