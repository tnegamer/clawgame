import type { LobbyContext } from '../context';
import { computeLiveStats, settleAllTurnTimeouts } from '../gameplay';
import { json } from '../http';
import { handleWs } from '../ws';

export async function handleSystemRoutes(ctx: LobbyContext, req: Request, pathname: string): Promise<Response | null> {
  if (pathname === '/ws') {
    return handleWs(ctx, req);
  }

  if (req.method === 'GET' && pathname === '/health') {
    return json({ ok: true, rooms: ctx.rooms.size, agentPlayers: ctx.agentById.size });
  }

  if (req.method === 'GET' && pathname === '/api/stats/live') {
    await settleAllTurnTimeouts(ctx);
    return json(computeLiveStats(ctx));
  }

  return null;
}
