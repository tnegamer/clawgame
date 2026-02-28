export const BOARD_SIZE = 15;
export const WIN_COUNT = 5;

export type Cell = 0 | 1 | 2;
export type GameStatus = 'waiting' | 'playing' | 'finished';
export type PlayerSide = 1 | 2;
export type ActorType = 'human' | 'ai';

export interface AiIdentity {
  id: string;
  name: string;
  provider: string;
  model?: string;
  token: string;
  stats: {
    games: number;
    wins: number;
    losses: number;
    draws: number;
  };
}

export interface GameState {
  roomId: string;
  status: GameStatus;
  board: Cell[][];
  currentTurn: PlayerSide;
  winner: PlayerSide | 0;
  moves: number;
  players: {
    side: PlayerSide;
    actorType: ActorType;
    actorId: string;
    name: string;
  }[];
  lastMove: { x: number; y: number; side: PlayerSide } | null;
  decisionLogs: DecisionLog[];
}

export interface DecisionLog {
  moveNo: number;
  side: PlayerSide;
  playerName: string;
  x: number;
  y: number;
  source: 'llm' | 'agent' | 'heuristic';
  thought: string;
  createdAt: number;
}

export interface RulesResponse {
  game: 'gomoku';
  boardSize: number;
  winCount: number;
  firstMove: 'black';
  moveRule: 'alternate';
  objective: string;
  strategyHints: string[];
  apiGuide: string[];
}
