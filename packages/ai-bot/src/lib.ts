import { BOARD_SIZE, type Cell, type GameState, type PlayerSide } from '@clawgame/shared';

export type AiAuth = {
  token: string;
  name: string;
};

export type RoomSeat = {
  roomId: string;
  seatToken: string;
  side: PlayerSide;
  state: GameState;
};

type OpenRoom = {
  roomId: string;
  createdAt: number;
  owner: {
    actorType: 'human' | 'ai';
    name: string;
  };
};

export async function registerAi(baseUrl: string, name: string, provider = 'codex', model = 'gpt-5'): Promise<AiAuth> {
  const res = await fetch(`${baseUrl}/api/ai/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, provider, model }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const data = await res.json();
  return { token: data.token, name };
}

export async function createAiRoom(baseUrl: string, ai: AiAuth): Promise<RoomSeat> {
  const res = await fetch(`${baseUrl}/api/rooms`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${ai.token}`,
    },
    body: JSON.stringify({ actorType: 'ai', name: ai.name }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<RoomSeat>;
}

export async function joinAiRoom(baseUrl: string, ai: AiAuth, roomId: string): Promise<RoomSeat> {
  const res = await fetch(`${baseUrl}/api/rooms/${roomId}/join`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${ai.token}`,
    },
    body: JSON.stringify({ actorType: 'ai', name: ai.name }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const joined = await res.json() as { seatToken: string; side: PlayerSide; state: GameState };
  return {
    roomId,
    seatToken: joined.seatToken,
    side: joined.side,
    state: joined.state,
  };
}

export async function listOpenRooms(baseUrl: string): Promise<OpenRoom[]> {
  const res = await fetch(`${baseUrl}/api/rooms/open`);
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const data = await res.json() as { openRooms: OpenRoom[] };
  return data.openRooms;
}

export async function getState(baseUrl: string, roomId: string): Promise<GameState> {
  const res = await fetch(`${baseUrl}/api/rooms/${roomId}/state`);
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<GameState>;
}

export type MoveDecision = {
  source: 'llm' | 'agent' | 'heuristic';
  thought: string;
};

export async function move(
  baseUrl: string,
  roomId: string,
  seatToken: string,
  x: number,
  y: number,
  decision?: MoveDecision,
): Promise<GameState> {
  const res = await fetch(`${baseUrl}/api/rooms/${roomId}/move`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${seatToken}`,
    },
    body: JSON.stringify({ x, y, decision }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<GameState>;
}

export async function findOrCreateSeat(params: {
  baseUrl: string;
  ai: AiAuth;
  roomId?: string;
  allowCreate: boolean;
  joinWaitMs: number;
  pollMs: number;
}): Promise<RoomSeat> {
  const { baseUrl, ai, roomId, allowCreate, joinWaitMs, pollMs } = params;
  if (roomId) {
    return joinAiRoom(baseUrl, ai, roomId);
  }

  const deadline = Date.now() + joinWaitMs;
  while (Date.now() < deadline) {
    const openRooms = await listOpenRooms(baseUrl);
    if (openRooms.length > 0) {
      try {
        return await joinAiRoom(baseUrl, ai, openRooms[0].roomId);
      } catch (error) {
        // Another agent may have joined first. Keep polling.
        if (error instanceof Error && error.message.includes('room full')) {
          await new Promise((resolve) => setTimeout(resolve, pollMs));
          continue;
        }
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  if (!allowCreate) {
    throw new Error('no open room found within join window');
  }
  return createAiRoom(baseUrl, ai);
}

function checkWinner(board: Cell[][], x: number, y: number, side: PlayerSide): boolean {
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
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
    if (count >= 5) {
      return true;
    }
  }
  return false;
}

function emptyCells(board: Cell[][]): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (board[y][x] === 0) {
        cells.push({ x, y });
      }
    }
  }
  return cells;
}

export function chooseMove(state: GameState, mySide: PlayerSide): { x: number; y: number; thought: string } {
  const board = state.board.map((row) => [...row]);
  const opponent = mySide === 1 ? 2 : 1;
  const candidates = emptyCells(board);

  for (const c of candidates) {
    board[c.y][c.x] = mySide;
    if (checkWinner(board, c.x, c.y, mySide)) {
      board[c.y][c.x] = 0;
      return { ...c, thought: `I can win immediately by placing at (${c.x}, ${c.y}).` };
    }
    board[c.y][c.x] = 0;
  }

  for (const c of candidates) {
    board[c.y][c.x] = opponent;
    if (checkWinner(board, c.x, c.y, opponent)) {
      board[c.y][c.x] = 0;
      return { ...c, thought: `Blocking opponent threat at (${c.x}, ${c.y}).` };
    }
    board[c.y][c.x] = 0;
  }

  const centerFirst = candidates.find((c) => c.x === 7 && c.y === 7);
  if (centerFirst) {
    return { ...centerFirst, thought: 'Taking center control for better future connectivity.' };
  }

  const random = candidates[Math.floor(Math.random() * candidates.length)];
  return { ...random, thought: `No urgent line found; expanding board influence at (${random.x}, ${random.y}).` };
}
