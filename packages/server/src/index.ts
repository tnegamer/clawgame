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
  type AiIdentity,
  type Cell,
  type GameState,
  type PlayerSide,
  type RulesResponse,
} from '@clawgame/shared';

type PlayerSeat = {
  side: PlayerSide;
  actorType: ActorType;
  actorId: string;
  name: string;
  seatToken: string;
};

type Room = {
  id: string;
  board: Cell[][];
  status: 'waiting' | 'playing' | 'finished';
  currentTurn: PlayerSide;
  winner: PlayerSide | 0;
  moves: number;
  players: PlayerSeat[];
  lastMove: { x: number; y: number; side: PlayerSide } | null;
  createdAt: number;
};

const app = express();
app.use(cors());
app.use(express.json());

const rooms = new Map<string, Room>();
const aiByToken = new Map<string, AiIdentity>();
const aiById = new Map<string, AiIdentity>();
const seatTokenIndex = new Map<string, { roomId: string; side: PlayerSide }>();

const rules: RulesResponse = {
  game: 'gomoku',
  boardSize: BOARD_SIZE,
  winCount: WIN_COUNT,
  firstMove: 'black',
  moveRule: 'alternate',
  apiGuide: [
    'POST /api/ai/register 获取 AI token',
    'POST /api/rooms 创建房间，返回 seat token',
    'POST /api/rooms/:id/join 加入房间，返回 seat token',
    'POST /api/rooms/:id/move 使用 seat token 落子',
  ],
};

const registerAiSchema = z.object({
  name: z.string().min(1).max(50),
  provider: z.string().min(1).max(50),
  model: z.string().max(100).optional(),
});

const createRoomSchema = z.object({
  actorType: z.enum(['human', 'ai']),
  name: z.string().min(1).max(50),
});

const joinRoomSchema = z.object({
  actorType: z.enum(['human', 'ai']),
  name: z.string().min(1).max(50),
});

const moveSchema = z.object({
  x: z.number().int().min(0).max(BOARD_SIZE - 1),
  y: z.number().int().min(0).max(BOARD_SIZE - 1),
});

function boardEmpty(): Cell[][] {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => 0 as Cell),
  );
}

function roomToState(room: Room): GameState {
  return {
    roomId: room.id,
    status: room.status,
    board: room.board,
    currentTurn: room.currentTurn,
    winner: room.winner,
    moves: room.moves,
    players: room.players.map((p) => ({
      side: p.side,
      actorType: p.actorType,
      actorId: p.actorId,
      name: p.name,
    })),
    lastMove: room.lastMove,
  };
}

function createRoomWithPlayer(actorType: ActorType, actorId: string, name: string): { room: Room; seat: PlayerSeat } {
  const roomId = uuidv4();
  const seat: PlayerSeat = {
    side: 1,
    actorType,
    actorId,
    name,
    seatToken: uuidv4(),
  };

  const room: Room = {
    id: roomId,
    board: boardEmpty(),
    status: 'waiting',
    currentTurn: 1,
    winner: 0,
    moves: 0,
    players: [seat],
    lastMove: null,
    createdAt: Date.now(),
  };

  rooms.set(roomId, room);
  seatTokenIndex.set(seat.seatToken, { roomId, side: seat.side });
  return { room, seat };
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

function getAiFromAuth(req: express.Request): AiIdentity | null {
  const token = getBearerToken(req);
  if (!token) {
    return null;
  }
  return aiByToken.get(token) ?? null;
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

function settleAiStats(room: Room) {
  if (room.status !== 'finished') {
    return;
  }

  for (const player of room.players) {
    if (player.actorType !== 'ai') {
      continue;
    }

    const ai = aiById.get(player.actorId);
    if (!ai) {
      continue;
    }

    ai.stats.games += 1;
    if (room.winner === 0) {
      ai.stats.draws += 1;
    } else if (room.winner === player.side) {
      ai.stats.wins += 1;
    } else {
      ai.stats.losses += 1;
    }
  }
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, aiPlayers: aiById.size });
});

app.get('/api/rules', (_req, res) => {
  res.json(rules);
});

app.post('/api/ai/register', (req, res) => {
  const parsed = registerAiSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const ai: AiIdentity = {
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

  aiByToken.set(ai.token, ai);
  aiById.set(ai.id, ai);

  res.status(201).json({ token: ai.token, profile: ai });
});

app.get('/api/ai/me', (req, res) => {
  const ai = getAiFromAuth(req);
  if (!ai) {
    res.status(401).json({ error: 'invalid ai token' });
    return;
  }

  res.json(ai);
});

app.get('/api/stats/ai', (_req, res) => {
  const leaderboard = Array.from(aiById.values())
    .map((ai) => ({
      id: ai.id,
      name: ai.name,
      provider: ai.provider,
      model: ai.model,
      ...ai.stats,
      winRate: ai.stats.games === 0 ? 0 : Number((ai.stats.wins / ai.stats.games).toFixed(3)),
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
  if (parsed.data.actorType === 'ai') {
    const ai = getAiFromAuth(req);
    if (!ai) {
      res.status(401).json({ error: 'invalid ai token' });
      return;
    }
    actorId = ai.id;
  }

  const { room, seat } = createRoomWithPlayer(parsed.data.actorType, actorId, parsed.data.name);
  res.status(201).json({
    roomId: room.id,
    seatToken: seat.seatToken,
    side: seat.side,
    state: roomToState(room),
  });
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

  if (room.players.length >= 2) {
    res.status(409).json({ error: 'room full' });
    return;
  }

  let actorId = uuidv4();
  if (parsed.data.actorType === 'ai') {
    const ai = getAiFromAuth(req);
    if (!ai) {
      res.status(401).json({ error: 'invalid ai token' });
      return;
    }
    actorId = ai.id;
  }

  const newSeat: PlayerSeat = {
    side: 2,
    actorType: parsed.data.actorType,
    actorId,
    name: parsed.data.name,
    seatToken: uuidv4(),
  };

  room.players.push(newSeat);
  room.status = 'playing';
  seatTokenIndex.set(newSeat.seatToken, { roomId: room.id, side: newSeat.side });

  const state = roomToState(room);
  broadcastRoom(room.id, { type: 'state', state });
  res.status(201).json({ seatToken: newSeat.seatToken, side: newSeat.side, state });
});

app.get('/api/rooms/:roomId/state', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: 'room not found' });
    return;
  }

  res.json(roomToState(room));
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
  room.moves += 1;
  room.lastMove = { x, y, side: seat.side };

  if (checkWinner(room.board, x, y, seat.side)) {
    room.status = 'finished';
    room.winner = seat.side;
    settleAiStats(room);
  } else if (room.moves >= BOARD_SIZE * BOARD_SIZE) {
    room.status = 'finished';
    room.winner = 0;
    settleAiStats(room);
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
server.listen(port, () => {
  console.log(`clawgame server listening on :${port}`);
});
