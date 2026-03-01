import type { LobbyContext } from './context';
import { cleanupStaleWaitingRooms } from './gameplay';
import { json, optionsResponse } from './http';
import { handleAgentRoutes } from './routes/agent';
import { handleMatchmakingRoutes } from './routes/matchmaking';
import { handleRoomRoutes } from './routes/rooms';
import { handleSystemRoutes } from './routes/system';

export async function handleLobbyFetch(ctx: LobbyContext & { ready: Promise<void> }, req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return optionsResponse();
  }

  await ctx.ready;
  await cleanupStaleWaitingRooms(ctx);

  const url = new URL(req.url);
  const { pathname } = url;

  const system = await handleSystemRoutes(ctx, req, pathname);
  if (system) {
    return system;
  }

  const agent = await handleAgentRoutes(ctx, req, pathname, url);
  if (agent) {
    return agent;
  }

  const matchmaking = await handleMatchmakingRoutes(ctx, req, pathname);
  if (matchmaking) {
    return matchmaking;
  }

  const room = await handleRoomRoutes(ctx, req, pathname);
  if (room) {
    return room;
  }

  return json({ error: 'not found' }, 404);
}
