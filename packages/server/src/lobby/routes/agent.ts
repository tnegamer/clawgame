import type { LobbyContext } from '../context';
import { json, parseBody } from '../http';
import { persistAgent, persistAgentHistory } from '../persistence';
import { getAgentFromAuth } from '../rooms';
import { randomId } from '../http';
import { registerAgentSchema } from '../types';
import type { AgentMatchHistoryEntry } from '../types';

export async function handleAgentRoutes(ctx: LobbyContext, req: Request, pathname: string, url: URL): Promise<Response | null> {
  if (req.method === 'POST' && pathname === '/api/agent/register') {
    const parsed = registerAgentSchema.safeParse(await parseBody(req));
    if (!parsed.success) {
      return json({ error: parsed.error.flatten() }, 400);
    }

    const agent = {
      id: randomId(),
      name: parsed.data.name,
      provider: parsed.data.provider,
      model: parsed.data.model,
      token: randomId(),
      stats: { games: 0, wins: 0, losses: 0, draws: 0 },
    };

    ctx.agentByToken.set(agent.token, agent);
    ctx.agentById.set(agent.id, agent);
    ctx.agentHistoryById.set(agent.id, []);
    await persistAgent(ctx, agent);
    await persistAgentHistory(ctx, agent.id);
    return json({ token: agent.token, profile: agent }, 201);
  }

  if (req.method === 'GET' && pathname === '/api/agent/me') {
    const agent = getAgentFromAuth(ctx, req);
    if (!agent) {
      return json({ error: 'invalid agent token' }, 401);
    }
    return json(agent);
  }

  if (req.method === 'GET' && pathname === '/api/agent/history') {
    const agent = getAgentFromAuth(ctx, req);
    if (!agent) {
      return json({ error: 'invalid agent token' }, 401);
    }

    const limitRaw = Number(url.searchParams.get('limit') ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50;
    const fullHistory = ctx.agentHistoryById.get(agent.id) ?? [];
    const recent = [...fullHistory].reverse().slice(0, limit);

    const summarize = (items: AgentMatchHistoryEntry[]) => {
      const games = items.length;
      const wins = items.filter((h) => h.result === 'win').length;
      const losses = items.filter((h) => h.result === 'loss').length;
      const draws = items.filter((h) => h.result === 'draw').length;
      const totalDurationMs = items.reduce((sum, h) => sum + h.durationMs, 0);
      return {
        games,
        wins,
        losses,
        draws,
        winRate: games === 0 ? 0 : Number((wins / games).toFixed(3)),
        totalDurationMs,
        avgDurationMs: games === 0 ? 0 : Math.round(totalDurationMs / games),
        shortestDurationMs: games === 0 ? 0 : Math.min(...items.map((h) => h.durationMs)),
        longestDurationMs: games === 0 ? 0 : Math.max(...items.map((h) => h.durationMs)),
      };
    };

    const vsHuman = fullHistory.filter((h) => h.mode === 'human_vs_agent');
    const vsAgent = fullHistory.filter((h) => h.mode === 'agent_vs_agent');

    return json({
      profile: { id: agent.id, name: agent.name, provider: agent.provider, model: agent.model },
      summary: {
        overall: summarize(fullHistory),
        vsHuman: summarize(vsHuman),
        vsAgent: summarize(vsAgent),
      },
      history: recent,
    });
  }

  if (req.method === 'GET' && pathname === '/api/stats/agent') {
    const leaderboard = Array.from(ctx.agentById.values())
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

  return null;
}
