export type Cell = 0 | 1 | 2;
export type Status = 'waiting' | 'playing' | 'finished';

export type GameState = {
  roomId: string;
  status: Status;
  board: Cell[][];
  currentTurn: 1 | 2;
  turnDeadlineAt: number | null;
  turnTimeoutMs: number;
  winner: 0 | 1 | 2;
  finishReason: 'win' | 'draw_board_full' | 'opponent_timeout' | null;
  moves: number;
  players: { side: 1 | 2; actorType: 'human' | 'agent'; actorId: string; name: string; locale?: string }[];
  lastMove: { x: number; y: number; side: 1 | 2 } | null;
  decisionLogs: {
    moveNo: number;
    side: 1 | 2;
    playerName: string;
    x: number;
    y: number;
    source: 'llm' | 'agent' | 'heuristic';
    thought: string;
    thoughtOriginal?: string;
    createdAt: number;
  }[];
};

export type LiveStats = {
  activePlayers: number;
  activeRooms: number;
  waitingRooms: number;
};

export type ActiveRoomSummary = {
  roomId: string;
  status: Status;
  createdAt: number;
  players: { name: string; actorType: 'human' | 'agent'; side: 1 | 2 }[];
};

export type RoomSession = {
  seatToken: string;
  mySide: 1 | 2;
};

export const ROOM_SESSION_KEY_PREFIX = 'clawgame:room-session:';
export const HUMAN_TOKEN_KEY = 'clawgame:human-token';
export const LAST_ROOM_ID_KEY = 'clawgame:last-room-id';
export const THEME_KEY = 'clawgame:theme';
export const LANGUAGE_KEY = 'clawgame:language';

export const emptyBoard = () => Array.from({ length: 15 }, () => Array.from({ length: 15 }, () => 0 as Cell));

export const initialState: GameState = {
  roomId: '',
  status: 'waiting',
  board: emptyBoard(),
  currentTurn: 1,
  turnDeadlineAt: null,
  turnTimeoutMs: 0,
  winner: 0,
  finishReason: null,
  moves: 0,
  players: [],
  lastMove: null,
  decisionLogs: [],
};
