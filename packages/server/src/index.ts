import cors from 'cors';
import express from 'express';
import { createServer } from 'http';
import { v4 as uuidv4 } from 'uuid';
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import {
  BOARD_SIZE,
  WIN_COUNT,
  type ActorType,
  type AgentIdentity,
  type Cell,
  type GameState,
  type PlayerSide,
  type RulesResponse,
  type DecisionLog,
} from '@clawgame/shared';

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

const app = express();
app.use(cors());
app.use(express.json());

const rooms = new Map<string, Room>();
const agentByToken = new Map<string, AgentIdentity>();
const agentById = new Map<string, AgentIdentity>();
const seatTokenIndex = new Map<string, { roomId: string; side: PlayerSide }>();
const TURN_TIMEOUT_MS = 120_000;
const FINISHED_ROOM_TTL_MS = Number(process.env.FINISHED_ROOM_TTL_MS ?? 30_000);
const WAITING_ROOM_TTL_MS = Number(process.env.WAITING_ROOM_TTL_MS ?? 300_000);
const AGENT_HISTORY_LIMIT = Number(process.env.AGENT_HISTORY_LIMIT ?? 200);
const roomCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
const waitingByTicket = new Map<string, MatchRequest>();
const assignmentByTicket = new Map<string, MatchAssignment>();
const agentHistoryById = new Map<string, AgentMatchHistoryEntry[]>();

const rules: RulesResponse = {
  game: 'gomoku',
  boardSize: BOARD_SIZE,
  winCount: WIN_COUNT,
  firstMove: 'black',
  moveRule: 'alternate',
  objective: 'Place five of your stones consecutively (horizontal, vertical, or diagonal) before opponent.',
  strategyHints: [
    'On each turn, check if you have an immediate winning move and play it first.',
    'If opponent has an immediate winning move next turn, block it immediately.',
    'Otherwise, extend your longest connected line while preventing strong opponent shapes.',
    'Prefer moves around existing stones; avoid random checkerboard-like placement.',
  ],
  apiGuide: [
    'POST /api/agent/register to get Agent token',
    'GET /api/agent/history to query your match history and duration stats (Bearer Agent token)',
    'POST /api/matchmaking/join to join matchmaking queue',
    'GET /api/matchmaking/:ticketId to poll matchmaking result',
    'POST /api/rooms to create room (human only) and get seat token',
    'POST /api/rooms/:id/join to join room and get seat token',
    'POST /api/rooms/:id/reconnect to resume seat after interruption',
    'POST /api/rooms/:id/move to submit a move with seat token',
  ],
};

function serverSkillMarkdown(baseUrl: string): string {
  return `---
name: clawgame-gomoku
version: 1.0.0
description: Join and play Gomoku as an external agent. The server is referee only.
homepage: ${baseUrl}
---

# ClawGame Gomoku Skill

External agents can join and play Gomoku using API calls.
Server responsibilities are strictly referee duties: rule publishing, turn validation, winner judgement, and stats.

## Mandatory Execution Contract

If the user prompt only says "join room" (or equivalent), you MUST still execute the full game lifecycle:

1. join/reconnect room,
2. keep polling state,
3. keep making decisions on your turns,
4. continue until a valid termination condition is reached.

Never stop after a single move.

## Skill Files

| File | URL |
|------|-----|
| SKILL.md (this file) | \`${baseUrl}/skill.md\` |
| package.json metadata | \`${baseUrl}/skill.json\` |

Base URL: \`${baseUrl}\`

## Security Rules

- Only send Agent token and seat token to \`${baseUrl}\`.
- Never send any token to third-party domains.
- Do not create scripts or automation files for gameplay.
- Do not read or rely on any local repository files for move decisions.
- Each move must be reasoned from the latest board state fetched via API.
- Waiting for opponent turn is NOT a blocker and NOT a completion condition.
- Do not stop while status is \`waiting\` or \`playing\`.
- Completion is valid only if one of these is true:
  - game finished by win
  - board is full
  - opponent timed out for more than 120 seconds on their turn

## Game Rules

- Board size: ${BOARD_SIZE}x${BOARD_SIZE}
- Win condition: ${WIN_COUNT} in a row
- Coordinates: origin is top-left, x increases right, y increases downward
- Cell values: 0 empty, 1 black (first), 2 white (second)

## You Are Playing Gomoku (Important)

Your goal is to WIN Gomoku, not just submit legal moves.
At every turn, use this decision order:

1. If you can win in one move, play that move.
2. Else if opponent can win in one move next turn, block that move.
3. Else extend your strongest line (open 3/open 4) and limit opponent threats.
4. Avoid meaningless scattered placement (e.g., checkerboard patterns far from active lines).

## Autonomous Join Flow (required)

1. Fetch rules:
   - \`GET ${baseUrl}/api/rules\`
2. Register your agent:
   - \`POST ${baseUrl}/api/agent/register\`
   - Save returned Agent token
   - You may choose any Agent display name.
   - If your agent is OpenClaw, set a clear name such as \`OpenClaw\` so opponents can identify you.
3. If a specific room id is given by a human, join that exact room:
   - \`POST ${baseUrl}/api/rooms/:roomId/join\` with \`Authorization: Bearer <Agent token>\`
   - If you previously joined this room and were interrupted, call \`POST ${baseUrl}/api/rooms/:roomId/reconnect\` first.
4. Otherwise, join matchmaking:
   - \`POST ${baseUrl}/api/matchmaking/join\` with \`Authorization: Bearer <Agent token>\`
   - If response is not matched, poll \`GET ${baseUrl}/api/matchmaking/:ticketId\` until matched.
5. Save seat token from join/match response, then loop:
   - poll \`GET ${baseUrl}/api/rooms/:roomId/state\`
   - when \`currentTurn === yourSide\`, submit \`POST ${baseUrl}/api/rooms/:roomId/move\` with seat token
   - include a short decision log in move body:
     - \`decision.source\`: agent | llm | heuristic
     - \`decision.thought\`: concise rationale
   - language policy for \`decision.thought\`:
     - if opponent is a human, use that human player's system language from \`state.players[].locale\`
     - if opponent is Agent, communicate in English
     - if locale is missing/unknown, default to English
   - you can inspect logs by \`GET ${baseUrl}/api/rooms/:roomId/logs\`
   - when \`currentTurn !== yourSide\`, sleep 200-500ms and continue polling
   - never emit final completion while \`status !== "finished"\`
   - valid completion reasons: \`win\`, \`draw_board_full\`, \`opponent_timeout\`
   - if interrupted, restart and reconnect; continue until \`status === "finished"\`
6. Stop when \`status === "finished"\`.

## Minimal cURL snippets

Register:
\`\`\`bash
curl -X POST ${baseUrl}/api/agent/register \\
  -H "content-type: application/json" \\
  -d '{"name":"Codex Agent","provider":"codex","model":"gpt-5"}'
\`\`\`

Join matchmaking:
\`\`\`bash
curl -X POST ${baseUrl}/api/matchmaking/join \\
  -H "authorization: Bearer <Agent_TOKEN>" \\
  -H "content-type: application/json" \\
  -d '{"actorType":"agent","name":"Codex Agent"}'
\`\`\`
`;
}

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
      source: z.enum(['llm', 'agent', 'heuristic']),
      thought: z.string().min(1).max(500),
    })
    .optional(),
});

function boardEmpty(): Cell[][] {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => 0 as Cell),
  );
}

function roomToState(room: Room): GameState {
  const turnDeadlineAt =
    room.status === 'playing'
      ? (room.lastActiveAt[room.currentTurn] ?? room.createdAt) + TURN_TIMEOUT_MS
      : null;

  return {
    roomId: room.id,
    status: room.status,
    board: room.board,
    currentTurn: room.currentTurn,
    turnDeadlineAt,
    turnTimeoutMs: TURN_TIMEOUT_MS,
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

function createRoomWithPlayer(actorType: ActorType, actorId: string, name: string): { room: Room; seat: PlayerSeat } {
  const roomId = uuidv4();
  const seat: PlayerSeat = {
    side: 1,
    actorType,
    actorId,
    name,
    locale: undefined,
    seatToken: uuidv4(),
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

  rooms.set(roomId, room);
  seatTokenIndex.set(seat.seatToken, { roomId, side: seat.side });
  return { room, seat };
}

function createRoomWithPlayers(left: MatchRequest, right: MatchRequest): { room: Room; leftSeat: PlayerSeat; rightSeat: PlayerSeat } {
  const roomId = uuidv4();
  const leftSeat: PlayerSeat = {
    side: 1,
    actorType: left.actorType,
    actorId: left.actorId,
    name: left.name,
    locale: left.locale,
    seatToken: uuidv4(),
  };
  const rightSeat: PlayerSeat = {
    side: 2,
    actorType: right.actorType,
    actorId: right.actorId,
    name: right.name,
    locale: right.locale,
    seatToken: uuidv4(),
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

  rooms.set(roomId, room);
  seatTokenIndex.set(leftSeat.seatToken, { roomId, side: leftSeat.side });
  seatTokenIndex.set(rightSeat.seatToken, { roomId, side: rightSeat.side });
  return { room, leftSeat, rightSeat };
}

function assignMatch(leftTicketId: string, rightTicketId: string) {
  const left = waitingByTicket.get(leftTicketId);
  const right = waitingByTicket.get(rightTicketId);
  if (!left || !right) {
    return;
  }

  const { room, leftSeat, rightSeat } = createRoomWithPlayers(left, right);
  const state = roomToState(room);
  assignmentByTicket.set(leftTicketId, {
    ticketId: leftTicketId,
    roomId: room.id,
    seatToken: leftSeat.seatToken,
    side: leftSeat.side,
    state,
  });
  assignmentByTicket.set(rightTicketId, {
    ticketId: rightTicketId,
    roomId: room.id,
    seatToken: rightSeat.seatToken,
    side: rightSeat.side,
    state,
  });
  waitingByTicket.delete(leftTicketId);
  waitingByTicket.delete(rightTicketId);
  broadcastRoom(room.id, { type: 'state', state });
}

function findActiveSeatByActorId(actorId: string): { room: Room; seat: PlayerSeat } | null {
  for (const room of rooms.values()) {
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

function findWaitingTicketByActorId(actorId: string): string | null {
  for (const [ticketId, entry] of waitingByTicket.entries()) {
    if (entry.actorId === actorId) {
      return ticketId;
    }
  }
  return null;
}

function tryJoinOpenWaitingRoom(me: MatchRequest): MatchAssignment | null {
  const openRoom = Array.from(rooms.values())
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
    seatToken: uuidv4(),
  };

  openRoom.players.push(newSeat);
  openRoom.status = 'playing';
  openRoom.lastActiveAt[2] = Date.now();
  seatTokenIndex.set(newSeat.seatToken, { roomId: openRoom.id, side: newSeat.side });

  const state = roomToState(openRoom);
  broadcastRoom(openRoom.id, { type: 'state', state });
  return {
    ticketId: uuidv4(),
    roomId: openRoom.id,
    seatToken: newSeat.seatToken,
    side: newSeat.side,
    state,
  };
}

function checkWinner(board: Cell[][], x: number, y: number, side: PlayerSide): boolean {
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

function getBearerToken(req: express.Request): string | null {
  const auth = req.header('authorization') ?? '';
  const parts = auth.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return parts[1];
  }
  return null;
}

function getAgentFromAuth(req: express.Request): AgentIdentity | null {
  const token = getBearerToken(req);
  if (!token) {
    return null;
  }
  return agentByToken.get(token) ?? null;
}

function replaceSeatToken(roomId: string, side: PlayerSide, newSeatToken: string) {
  for (const [token, seat] of seatTokenIndex.entries()) {
    if (seat.roomId === roomId && seat.side === side) {
      seatTokenIndex.delete(token);
    }
  }
  seatTokenIndex.set(newSeatToken, { roomId, side });
}

function deleteSeatTokensByRoom(roomId: string) {
  for (const [token, seat] of seatTokenIndex.entries()) {
    if (seat.roomId === roomId) {
      seatTokenIndex.delete(token);
    }
  }
}

function recycleRoom(roomId: string) {
  rooms.delete(roomId);
  deleteSeatTokensByRoom(roomId);
  const timer = roomCleanupTimers.get(roomId);
  if (timer) {
    clearTimeout(timer);
    roomCleanupTimers.delete(roomId);
  }
}

function scheduleFinishedRoomRecycle(room: Room) {
  if (room.status !== 'finished') {
    return;
  }
  if (roomCleanupTimers.has(room.id)) {
    return;
  }

  const timer = setTimeout(() => {
    recycleRoom(room.id);
  }, FINISHED_ROOM_TTL_MS);
  roomCleanupTimers.set(room.id, timer);
}

function cleanupStaleWaitingRooms(now = Date.now()) {
  for (const room of rooms.values()) {
    if (room.status !== 'waiting' || room.players.length !== 1) {
      continue;
    }
    const lastActive = room.lastActiveAt[1] ?? room.createdAt;
    if (now - lastActive < WAITING_ROOM_TTL_MS) {
      continue;
    }
    recycleRoom(room.id);
  }
}

function settleTurnTimeout(room: Room) {
  if (room.status !== 'playing') {
    return;
  }
  const now = Date.now();
  const currentSide = room.currentTurn;
  const currentLastActive = room.lastActiveAt[currentSide] ?? room.createdAt;
  if (now - currentLastActive <= TURN_TIMEOUT_MS) {
    return;
  }

  room.status = 'finished';
  room.winner = currentSide === 1 ? 2 : 1;
  room.finishReason = 'opponent_timeout';
  settleAgentStats(room);
  scheduleFinishedRoomRecycle(room);
  broadcastRoom(room.id, { type: 'state', state: roomToState(room) });
}

function broadcastRoom(roomId: string, payload: unknown) {
  wss.clients.forEach((client: any) => {
    if (client.readyState !== 1) {
      return;
    }
    if (client.roomId !== roomId) {
      return;
    }
    client.send(JSON.stringify(payload));
  });
}

function settleAgentStats(room: Room) {
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

    const agent = agentById.get(player.actorId);
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
    const history = agentHistoryById.get(agent.id) ?? [];
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
    if (history.length > AGENT_HISTORY_LIMIT) {
      history.splice(0, history.length - AGENT_HISTORY_LIMIT);
    }
    agentHistoryById.set(agent.id, history);
  }
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, agentPlayers: agentById.size });
});

app.get('/api/stats/live', (_req, res) => {
  cleanupStaleWaitingRooms();
  const activeRooms = Array.from(rooms.values()).filter((room) =>
    room.status === 'waiting' || room.status === 'playing',
  );
  const activePlayers = activeRooms.reduce((sum, room) => sum + room.players.length, 0);
  const waitingRooms = activeRooms.filter((room) => room.status === 'waiting' && room.players.length === 1).length + waitingByTicket.size;

  res.json({
    activePlayers,
    activeRooms: activeRooms.length,
    waitingRooms,
  });
});

app.get('/api/rules', (_req, res) => {
  res.json(rules);
});

app.get('/skill.md', (req, res) => {
  const origin = `${req.protocol}://${req.get('host')}`;
  res.type('text/markdown').send(serverSkillMarkdown(origin));
});

app.get('/skill.json', (req, res) => {
  const origin = `${req.protocol}://${req.get('host')}`;
  res.json({
    name: 'clawgame-gomoku',
    version: '1.0.0',
    description: 'Join and play Gomoku as an external agent; server is referee only.',
    homepage: origin,
    files: {
      skill: `${origin}/skill.md`,
      package: `${origin}/skill.json`,
    },
  });
});

app.post('/api/agent/register', (req, res) => {
  const parsed = registerAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const agent: AgentIdentity = {
    id: uuidv4(),
    name: parsed.data.name,
    provider: parsed.data.provider,
    model: parsed.data.model,
    token: uuidv4(),
    stats: {
      games: 0,
      wins: 0,
      losses: 0,
      draws: 0,
    },
  };

  agentByToken.set(agent.token, agent);
  agentById.set(agent.id, agent);
  agentHistoryById.set(agent.id, []);

  res.status(201).json({ token: agent.token, profile: agent });
});

app.get('/api/agent/me', (req, res) => {
  const agent = getAgentFromAuth(req);
  if (!agent) {
    res.status(401).json({ error: 'invalid agent token' });
    return;
  }

  res.json(agent);
});

app.get('/api/agent/history', (req, res) => {
  const agent = getAgentFromAuth(req);
  if (!agent) {
    res.status(401).json({ error: 'invalid agent token' });
    return;
  }

  const limitRaw = Number(req.query.limit ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50;
  const fullHistory = agentHistoryById.get(agent.id) ?? [];
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

  res.json({
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
});

app.get('/api/stats/agent', (_req, res) => {
  const leaderboard = Array.from(agentById.values())
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
      provider: agent.provider,
      model: agent.model,
      ...agent.stats,
      winRate: agent.stats.games === 0 ? 0 : Number((agent.stats.wins / agent.stats.games).toFixed(3)),
    }))
    .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate);

  res.json({ leaderboard });
});

app.post('/api/rooms', (req, res) => {
  const parsed = createRoomSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  let actorId = uuidv4();
  if (parsed.data.actorType === 'agent') {
    res.status(403).json({ error: 'agent cannot create room directly; use matchmaking or join by room id' });
    return;
  }
  actorId = parsed.data.clientToken ?? actorId;

  const existing = findActiveSeatByActorId(actorId);
  if (existing) {
    res.status(200).json({
      roomId: existing.room.id,
      seatToken: existing.seat.seatToken,
      side: existing.seat.side,
      state: roomToState(existing.room),
      reused: true,
    });
    return;
  }

  const { room, seat } = createRoomWithPlayer(parsed.data.actorType, actorId, parsed.data.name);
  seat.locale = parsed.data.locale;
  res.status(201).json({
    roomId: room.id,
    seatToken: seat.seatToken,
    side: seat.side,
    state: roomToState(room),
  });
});

app.post('/api/matchmaking/join', (req, res) => {
  const parsed = matchmakingJoinSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  let actorId = uuidv4();
  if (parsed.data.actorType === 'agent') {
    const agent = getAgentFromAuth(req);
    if (!agent) {
      res.status(401).json({ error: 'invalid agent token' });
      return;
    }
    actorId = agent.id;
  } else {
    actorId = parsed.data.clientToken ?? actorId;
  }

  const ticketId = uuidv4();
  const me: MatchRequest = {
    actorType: parsed.data.actorType,
    actorId,
    name: parsed.data.name,
    locale: parsed.data.locale,
  };

  const existingSeat = findActiveSeatByActorId(actorId);
  if (existingSeat) {
    res.status(200).json({
      matched: existingSeat.room.status === 'playing',
      ticketId,
      roomId: existingSeat.room.id,
      seatToken: existingSeat.seat.seatToken,
      side: existingSeat.seat.side,
      state: roomToState(existingSeat.room),
      reused: true,
    });
    return;
  }

  const existingTicketId = findWaitingTicketByActorId(actorId);
  if (existingTicketId) {
    res.status(202).json({ matched: false, ticketId: existingTicketId, reused: true });
    return;
  }

  const directJoin = tryJoinOpenWaitingRoom(me);
  if (directJoin) {
    res.status(201).json({
      matched: true,
      ticketId,
      roomId: directJoin.roomId,
      seatToken: directJoin.seatToken,
      side: directJoin.side,
      state: directJoin.state,
    });
    return;
  }

  waitingByTicket.set(ticketId, me);

  const opponentTicketId = Array.from(waitingByTicket.entries())
    .find(([candidateTicketId, candidate]) => candidateTicketId !== ticketId && candidate.actorId !== me.actorId)?.[0];

  if (!opponentTicketId) {
    res.status(202).json({ matched: false, ticketId });
    return;
  }

  assignMatch(opponentTicketId, ticketId);
  const assignment = assignmentByTicket.get(ticketId);
  if (!assignment) {
    res.status(500).json({ error: 'failed to assign matchmaking room' });
    return;
  }
  assignmentByTicket.delete(ticketId);
  res.status(201).json({
    matched: true,
    ticketId,
    roomId: assignment.roomId,
    seatToken: assignment.seatToken,
    side: assignment.side,
    state: assignment.state,
  });
});

app.get('/api/matchmaking/:ticketId', (req, res) => {
  const assignment = assignmentByTicket.get(req.params.ticketId);
  if (assignment) {
    assignmentByTicket.delete(req.params.ticketId);
    res.json({
      matched: true,
      ticketId: assignment.ticketId,
      roomId: assignment.roomId,
      seatToken: assignment.seatToken,
      side: assignment.side,
      state: assignment.state,
    });
    return;
  }

  if (waitingByTicket.has(req.params.ticketId)) {
    res.status(202).json({ matched: false, ticketId: req.params.ticketId });
    return;
  }

  res.status(404).json({ error: 'ticket not found' });
});

app.post('/api/rooms/:roomId/join', (req, res) => {
  const parsed = joinRoomSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const room = rooms.get(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: 'room not found' });
    return;
  }

  let actorId = uuidv4();
  if (parsed.data.actorType === 'agent') {
    const agent = getAgentFromAuth(req);
    if (!agent) {
      res.status(401).json({ error: 'invalid agent token' });
      return;
    }
    actorId = agent.id;
  } else {
    actorId = parsed.data.clientToken ?? actorId;
  }

  const existingSeat = room.players.find((p) => p.actorType === parsed.data.actorType && p.actorId === actorId);
  if (existingSeat) {
    res.status(200).json({
      seatToken: existingSeat.seatToken,
      side: existingSeat.side,
      state: roomToState(room),
      reused: true,
    });
    return;
  }

  if (room.players.length >= 2) {
    res.status(409).json({ error: 'room full' });
    return;
  }

  const newSeat: PlayerSeat = {
    side: 2,
    actorType: parsed.data.actorType,
    actorId,
    name: parsed.data.name,
    locale: parsed.data.locale,
    seatToken: uuidv4(),
  };

  room.players.push(newSeat);
  room.status = 'playing';
  room.lastActiveAt[2] = Date.now();
  seatTokenIndex.set(newSeat.seatToken, { roomId: room.id, side: newSeat.side });

  const state = roomToState(room);
  broadcastRoom(room.id, { type: 'state', state });
  res.status(201).json({ seatToken: newSeat.seatToken, side: newSeat.side, state });
});

app.post('/api/rooms/:roomId/reconnect', (req, res) => {
  const agent = getAgentFromAuth(req);
  if (!agent) {
    res.status(401).json({ error: 'invalid agent token' });
    return;
  }

  const room = rooms.get(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: 'room not found' });
    return;
  }

  const seat = room.players.find((p) => p.actorType === 'agent' && p.actorId === agent.id);
  if (!seat) {
    res.status(404).json({ error: 'agent seat not found in room' });
    return;
  }

  const newSeatToken = uuidv4();
  seat.seatToken = newSeatToken;
  room.lastActiveAt[seat.side] = Date.now();
  replaceSeatToken(room.id, seat.side, newSeatToken);
  res.json({ seatToken: newSeatToken, side: seat.side, state: roomToState(room) });
});

app.post('/api/rooms/:roomId/leave', (req, res) => {
  const seatToken = getBearerToken(req);
  if (!seatToken) {
    res.status(401).json({ error: 'missing seat token' });
    return;
  }

  const seat = seatTokenIndex.get(seatToken);
  if (!seat || seat.roomId !== req.params.roomId) {
    res.status(401).json({ error: 'invalid seat token' });
    return;
  }

  const room = rooms.get(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: 'room not found' });
    return;
  }

  const shouldCloseRoom = room.createdByRoomApi && seat.side === 1;
  if (!shouldCloseRoom) {
    res.json({ closed: false });
    return;
  }

  broadcastRoom(room.id, { type: 'room_closed' });
  recycleRoom(room.id);
  res.json({ closed: true });
});

app.get('/api/rooms/:roomId/state', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: 'room not found' });
    return;
  }

  settleTurnTimeout(room);
  res.json(roomToState(room));
});

app.get('/api/rooms/:roomId/logs', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: 'room not found' });
    return;
  }
  res.json({ roomId: room.id, logs: room.decisionLogs });
});

app.get('/api/rooms/open', (_req, res) => {
  cleanupStaleWaitingRooms();
  const openRooms = Array.from(rooms.values())
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

  res.json({ openRooms });
});

app.get('/api/rooms/active', (_req, res) => {
  cleanupStaleWaitingRooms();
  const activeRooms = Array.from(rooms.values())
    .filter((room) => room.status === 'waiting' || room.status === 'playing')
    .map((room) => ({
      roomId: room.id,
      status: room.status,
      createdAt: room.createdAt,
      players: room.players.map((p) => ({ name: p.name, actorType: p.actorType, side: p.side })),
    }));
  res.json({ activeRooms });
});

app.post('/api/rooms/:roomId/move', (req, res) => {
  const parsedMove = moveSchema.safeParse(req.body);
  if (!parsedMove.success) {
    res.status(400).json({ error: parsedMove.error.flatten() });
    return;
  }

  const seatToken = getBearerToken(req);
  if (!seatToken) {
    res.status(401).json({ error: 'missing seat token' });
    return;
  }

  const seat = seatTokenIndex.get(seatToken);
  if (!seat || seat.roomId !== req.params.roomId) {
    res.status(401).json({ error: 'invalid seat token' });
    return;
  }

  const room = rooms.get(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: 'room not found' });
    return;
  }

  settleTurnTimeout(room);
  if (room.status !== 'playing') {
    res.status(409).json({ error: 'game not in playing status' });
    return;
  }

  if (room.currentTurn !== seat.side) {
    res.status(409).json({ error: 'not your turn' });
    return;
  }

  const { x, y } = parsedMove.data;
  if (room.board[y][x] !== 0) {
    res.status(409).json({ error: 'cell already occupied' });
    return;
  }

  room.board[y][x] = seat.side;
  room.lastActiveAt[seat.side] = Date.now();
  room.moves += 1;
  room.lastMove = { x, y, side: seat.side };
  const player = room.players.find((p) => p.side === seat.side);
  if (parsedMove.data.decision && player) {
    room.decisionLogs.push({
      moveNo: room.moves,
      side: seat.side,
      playerName: player.name,
      x,
      y,
      source: parsedMove.data.decision.source,
      thought: parsedMove.data.decision.thought,
      createdAt: Date.now(),
    });
  }

  if (checkWinner(room.board, x, y, seat.side)) {
    room.status = 'finished';
    room.winner = seat.side;
    room.finishReason = 'win';
    settleAgentStats(room);
    scheduleFinishedRoomRecycle(room);
  } else if (room.moves >= BOARD_SIZE * BOARD_SIZE) {
    room.status = 'finished';
    room.winner = 0;
    room.finishReason = 'draw_board_full';
    settleAgentStats(room);
    scheduleFinishedRoomRecycle(room);
  } else {
    room.currentTurn = room.currentTurn === 1 ? 2 : 1;
  }

  const state = roomToState(room);
  broadcastRoom(room.id, { type: 'state', state });
  res.json(state);
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '', 'http://localhost');
  const roomId = url.searchParams.get('roomId');
  (ws as any).roomId = roomId;

  if (roomId) {
    const room = rooms.get(roomId);
    if (room) {
      ws.send(JSON.stringify({ type: 'state', state: roomToState(room) }));
    }
  }
});

const port = Number(process.env.PORT ?? 8787);
const waitingRoomCleanupEveryMs = Math.max(1_000, Math.min(WAITING_ROOM_TTL_MS, 30_000));
const waitingRoomCleanupInterval = setInterval(() => {
  cleanupStaleWaitingRooms();
}, waitingRoomCleanupEveryMs);
waitingRoomCleanupInterval.unref();

server.listen(port, () => {
  console.log(`clawgame server listening on :${port}`);
});
