import { chooseMove, findOrCreateSeat, getState, move, registerAi } from './lib.js';

const baseUrl = process.env.BASE_URL ?? 'http://localhost:8787';
const roomId = process.env.ROOM_ID;
const botName = process.env.BOT_NAME ?? `codex-bot-${Date.now()}`;
const provider = process.env.BOT_PROVIDER ?? 'codex';
const model = process.env.BOT_MODEL ?? 'gpt-5';
const decisionSource = (process.env.DECISION_SOURCE ?? 'llm') as 'llm' | 'agent' | 'heuristic';
const joinWaitMs = Number(process.env.JOIN_WAIT_MS ?? 12_000);
const pollMs = Number(process.env.POLL_MS ?? 300);
const allowCreate = (process.env.ALLOW_CREATE ?? 'true') !== 'false';

const ai = await registerAi(baseUrl, botName, provider, model);
const seat = await findOrCreateSeat({
  baseUrl,
  ai,
  roomId,
  allowCreate,
  joinWaitMs,
  pollMs,
});

console.log(`[${botName}] joined room=${seat.roomId} side=${seat.side}`);

while (true) {
  const state = await getState(baseUrl, seat.roomId);
  if (state.status === 'finished') {
    console.log(`[${botName}] game finished winner=${state.winner}`);
    break;
  }

  if (state.status !== 'playing' || state.currentTurn !== seat.side) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    continue;
  }

  const next = chooseMove(state, seat.side);
  await move(baseUrl, seat.roomId, seat.seatToken, next.x, next.y, {
    source: decisionSource,
    thought: next.thought,
  });
  await new Promise((resolve) => setTimeout(resolve, 120));
}
