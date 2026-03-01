import type { AgentIdentity } from '@clawgame/shared';
import type { LobbyContext } from './context';
import type { AgentHistoryRow, AgentRow, RuntimeSnapshot } from './types';
import { DO_RUNTIME_STATE_KEY } from './types';

export async function ensureD1Schema(ctx: LobbyContext): Promise<void> {
  await ctx.env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT,
      token TEXT NOT NULL UNIQUE,
      games INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      draws INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `).run();
  await ctx.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_agents_token ON agents(token)`).run();
  await ctx.env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS agent_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      side INTEGER NOT NULL,
      result TEXT NOT NULL,
      finish_reason TEXT NOT NULL,
      opponent_actor_type TEXT,
      opponent_name TEXT,
      opponent_actor_id TEXT,
      mode TEXT NOT NULL,
      moves INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER NOT NULL
    )
  `).run();
  await ctx.env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_agent_history_agent_finished
    ON agent_history(agent_id, finished_at DESC)
  `).run();
}

export async function loadPersistedAgents(ctx: LobbyContext): Promise<void> {
  ctx.agentById.clear();
  ctx.agentByToken.clear();
  const rows = await ctx.env.DB.prepare(`
    SELECT id, name, provider, model, token, games, wins, losses, draws
    FROM agents
  `).all<AgentRow>();

  for (const row of rows.results) {
    const agent: AgentIdentity = {
      id: row.id,
      name: row.name,
      provider: row.provider,
      model: row.model ?? undefined,
      token: row.token,
      stats: {
        games: row.games,
        wins: row.wins,
        losses: row.losses,
        draws: row.draws,
      },
    };
    ctx.agentById.set(agent.id, agent);
    ctx.agentByToken.set(agent.token, agent);
  }

  ctx.agentHistoryById.clear();
  const historyRows = await ctx.env.DB.prepare(`
    SELECT agent_id, room_id, side, result, finish_reason, opponent_actor_type, opponent_name, opponent_actor_id, mode, moves, duration_ms, started_at, finished_at
    FROM agent_history
    ORDER BY finished_at ASC
  `).all<AgentHistoryRow>();

  for (const row of historyRows.results) {
    const list = ctx.agentHistoryById.get(row.agent_id) ?? [];
    list.push({
      roomId: row.room_id,
      side: row.side as 1 | 2,
      result: row.result,
      finishReason: row.finish_reason,
      opponent: row.opponent_actor_id
        ? {
          actorType: row.opponent_actor_type as 'human' | 'agent',
          name: row.opponent_name ?? '',
          actorId: row.opponent_actor_id,
        }
        : null,
      mode: row.mode,
      moves: row.moves,
      durationMs: row.duration_ms,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    });
    ctx.agentHistoryById.set(row.agent_id, list);
  }

  for (const agentId of ctx.agentById.keys()) {
    if (!ctx.agentHistoryById.has(agentId)) {
      ctx.agentHistoryById.set(agentId, []);
    }
  }
}

export async function persistAgent(ctx: LobbyContext, agent: AgentIdentity): Promise<void> {
  await ctx.env.DB.prepare(`
    INSERT INTO agents (id, name, provider, model, token, games, wins, losses, draws, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      provider=excluded.provider,
      model=excluded.model,
      token=excluded.token,
      games=excluded.games,
      wins=excluded.wins,
      losses=excluded.losses,
      draws=excluded.draws
  `).bind(
    agent.id,
    agent.name,
    agent.provider,
    agent.model ?? null,
    agent.token,
    agent.stats.games,
    agent.stats.wins,
    agent.stats.losses,
    agent.stats.draws,
    Date.now(),
  ).run();
}

export async function persistAgentHistory(ctx: LobbyContext, agentId: string): Promise<void> {
  const history = ctx.agentHistoryById.get(agentId) ?? [];
  await ctx.env.DB.prepare(`DELETE FROM agent_history WHERE agent_id = ?1`).bind(agentId).run();
  if (history.length === 0) {
    return;
  }
  const statements = history.map((entry) =>
    ctx.env.DB.prepare(`
      INSERT INTO agent_history (
        agent_id, room_id, side, result, finish_reason, opponent_actor_type, opponent_name, opponent_actor_id, mode, moves, duration_ms, started_at, finished_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
    `).bind(
      agentId,
      entry.roomId,
      entry.side,
      entry.result,
      entry.finishReason,
      entry.opponent?.actorType ?? null,
      entry.opponent?.name ?? null,
      entry.opponent?.actorId ?? null,
      entry.mode,
      entry.moves,
      entry.durationMs,
      entry.startedAt,
      entry.finishedAt,
    ),
  );
  await ctx.env.DB.batch(statements);
}

export async function loadRuntimeState(ctx: LobbyContext): Promise<void> {
  const snapshot = await ctx.state.storage.get<RuntimeSnapshot>(DO_RUNTIME_STATE_KEY);
  if (!snapshot) {
    return;
  }
  ctx.rooms = new Map(Object.entries(snapshot.rooms ?? {}));
  ctx.seatTokenIndex = new Map(Object.entries(snapshot.seatTokenIndex ?? {}));
  ctx.waitingByTicket = new Map(Object.entries(snapshot.waitingByTicket ?? {}));
  ctx.assignmentByTicket = new Map(Object.entries(snapshot.assignmentByTicket ?? {}));
}

export async function persistRuntimeState(ctx: LobbyContext): Promise<void> {
  const snapshot: RuntimeSnapshot = {
    rooms: Object.fromEntries(ctx.rooms.entries()),
    seatTokenIndex: Object.fromEntries(ctx.seatTokenIndex.entries()),
    waitingByTicket: Object.fromEntries(ctx.waitingByTicket.entries()),
    assignmentByTicket: Object.fromEntries(ctx.assignmentByTicket.entries()),
  };
  await ctx.state.storage.put(DO_RUNTIME_STATE_KEY, snapshot);
}
