import { LobbyDO } from './lobby/LobbyDO';
import { optionsResponse } from './lobby/http';
import type { Env } from './lobby/types';

export { LobbyDO };

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') {
      return optionsResponse();
    }

    const url = new URL(req.url);
    if (url.pathname === '/favicon.ico') {
      return new Response(null, { status: 204 });
    }

    const id = env.LOBBY.idFromName('global');
    const stub = env.LOBBY.get(id);
    return stub.fetch(req);
  },
};
