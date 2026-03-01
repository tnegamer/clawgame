import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const port = 19000 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;
let serverProc: ChildProcess | null = null;

async function waitForServerReady() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) {
        return;
      }
    } catch {
      // retry
    }
    await delay(200);
  }
  throw new Error('server did not become ready');
}

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<{ status: number; data: T }> {
  const res = await fetch(`${baseUrl}${path}`, init);
  const data = (await res.json()) as T;
  return { status: res.status, data };
}

beforeAll(async () => {
  serverProc = spawn('npx', [
    'wrangler',
    'dev',
    '--local',
    '--config',
    'wrangler.toml',
    '--port',
    String(port),
    '--var',
    'TURN_TIMEOUT_MS:5000',
  ], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: 'pipe',
  });
  await waitForServerReady();
}, 25_000);

afterAll(() => {
  if (serverProc) {
    serverProc.kill('SIGKILL');
    serverProc = null;
  }
});

describe.sequential('server api coverage', () => {
  it('covers core public endpoints', async () => {
    const health = await jsonRequest<{ ok: boolean; rooms: number; agentPlayers: number }>('/health');
    expect(health.status).toBe(200);
    expect(health.data.ok).toBe(true);
  });

  it('covers agent identity endpoints', async () => {
    const register = await jsonRequest<{ token: string; profile: { id: string; name: string } }>('/api/agent/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `agent-${Date.now()}`, provider: 'codex', model: 'gpt-5' }),
    });
    expect(register.status).toBe(201);
    const agentToken = register.data.token;

    const me = await jsonRequest<{ id: string; name: string }>('/api/agent/me', {
      headers: { authorization: `Bearer ${agentToken}` },
    });
    expect(me.status).toBe(200);
    expect(me.data.id).toBe(register.data.profile.id);

    const history = await jsonRequest<{ history: unknown[] }>('/api/agent/history', {
      headers: { authorization: `Bearer ${agentToken}` },
    });
    expect(history.status).toBe(200);
    expect(Array.isArray(history.data.history)).toBe(true);

    const agentStats = await jsonRequest<{ leaderboard: Array<{ id: string }> }>('/api/stats/agent');
    expect(agentStats.status).toBe(200);
    expect(agentStats.data.leaderboard.some((row) => row.id === register.data.profile.id)).toBe(true);
  });

  it('covers room create/join/state/move/logs/leave/open/active/live', async () => {
    const hostToken = `unit-host-${Date.now()}`;
    const guestToken = `unit-guest-${Date.now()}`;

    const create = await jsonRequest<{ roomId: string; seatToken: string; side: number }>('/api/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actorType: 'human', name: 'host', clientToken: hostToken }),
    });
    expect(create.status).toBe(201);
    const roomId = create.data.roomId;

    const openRooms = await jsonRequest<{ openRooms: Array<{ roomId: string }> }>('/api/rooms/open');
    expect(openRooms.status).toBe(200);
    expect(openRooms.data.openRooms.some((r) => r.roomId === roomId)).toBe(true);

    const activeRooms = await jsonRequest<{ activeRooms: Array<{ roomId: string }> }>('/api/rooms/active');
    expect(activeRooms.status).toBe(200);
    expect(activeRooms.data.activeRooms.some((r) => r.roomId === roomId)).toBe(true);

    const live = await jsonRequest<{ activePlayers: number; activeRooms: number; waitingRooms: number }>('/api/stats/live');
    expect(live.status).toBe(200);
    expect(live.data.activeRooms).toBeGreaterThanOrEqual(1);

    const join = await jsonRequest<{ seatToken: string; side: number; state: { status: string } }>(`/api/rooms/${roomId}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actorType: 'human', name: 'guest', clientToken: guestToken }),
    });
    expect(join.status).toBe(201);
    expect(join.data.state.status).toBe('playing');

    const state = await jsonRequest<{ status: string; players: unknown[] }>(`/api/rooms/${roomId}/state`);
    expect(state.status).toBe(200);
    expect(state.data.status).toBe('playing');
    expect(state.data.players.length).toBe(2);

    const hostMove = await jsonRequest<{ status: string }>(`/api/rooms/${roomId}/move`, {
      method: 'POST',
      headers: { authorization: `Bearer ${create.data.seatToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ x: 7, y: 7 }),
    });
    expect(hostMove.status).toBe(200);

    const guestMove = await jsonRequest<{ status: string }>(`/api/rooms/${roomId}/move`, {
      method: 'POST',
      headers: { authorization: `Bearer ${join.data.seatToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ x: 8, y: 7, decision: { thought: 'block line', thoughtOriginal: 'block line' } }),
    });
    expect(guestMove.status).toBe(200);

    const logs = await jsonRequest<{ logs: Array<{ thought: string }> }>(`/api/rooms/${roomId}/logs`);
    expect(logs.status).toBe(200);
    expect(logs.data.logs.length).toBe(1);
    expect(logs.data.logs[0].thought).toBe('block line');

    const guestLeave = await jsonRequest<{ closed: boolean }>(`/api/rooms/${roomId}/leave`, {
      method: 'POST',
      headers: { authorization: `Bearer ${join.data.seatToken}` },
    });
    expect(guestLeave.status).toBe(200);
    expect(guestLeave.data.closed).toBe(false);

    const creatorCloseRes = await jsonRequest<{ roomId: string; seatToken: string }>('/api/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actorType: 'human', name: 'closer', clientToken: `closer-${Date.now()}` }),
    });
    expect(creatorCloseRes.status).toBe(201);
    const closeLeave = await jsonRequest<{ closed: boolean }>(`/api/rooms/${creatorCloseRes.data.roomId}/leave`, {
      method: 'POST',
      headers: { authorization: `Bearer ${creatorCloseRes.data.seatToken}` },
    });
    expect(closeLeave.status).toBe(200);
    expect(closeLeave.data.closed).toBe(true);
  });

  it('covers reconnect and matchmaking endpoints', async () => {
    const register = await jsonRequest<{ token: string; profile: { name: string } }>('/api/agent/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `agent-reconnect-${Date.now()}`, provider: 'codex', model: 'gpt-5' }),
    });
    expect(register.status).toBe(201);

    const hostCreate = await jsonRequest<{ roomId: string }>('/api/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actorType: 'human', name: 'host-for-agent', clientToken: `host-agent-${Date.now()}` }),
    });
    expect(hostCreate.status).toBe(201);

    const agentJoin = await jsonRequest<{ seatToken: string; side: number }>(`/api/rooms/${hostCreate.data.roomId}/join`, {
      method: 'POST',
      headers: { authorization: `Bearer ${register.data.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ actorType: 'agent', name: register.data.profile.name }),
    });
    expect(agentJoin.status).toBe(201);

    const reconnect = await jsonRequest<{ seatToken: string; side: number }>(`/api/rooms/${hostCreate.data.roomId}/reconnect`, {
      method: 'POST',
      headers: { authorization: `Bearer ${register.data.token}` },
    });
    expect(reconnect.status).toBe(200);
    expect(reconnect.data.side).toBe(2);
    expect(reconnect.data.seatToken).not.toBe(agentJoin.data.seatToken);

    const leftAgent = await jsonRequest<{ token: string; profile: { name: string } }>('/api/agent/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `mm-left-${Date.now()}`, provider: 'codex', model: 'gpt-5' }),
    });
    const rightAgent = await jsonRequest<{ token: string; profile: { name: string } }>('/api/agent/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `mm-right-${Date.now()}`, provider: 'codex', model: 'gpt-5' }),
    });

    const leftJoin = await jsonRequest<{ matched: boolean; ticketId: string }>('/api/matchmaking/join', {
      method: 'POST',
      headers: { authorization: `Bearer ${leftAgent.data.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ actorType: 'agent', name: leftAgent.data.profile.name }),
    });
    expect([201, 202]).toContain(leftJoin.status);

    if (leftJoin.status === 202) {
      const rightJoin = await jsonRequest<{ matched: boolean; roomId?: string }>('/api/matchmaking/join', {
        method: 'POST',
        headers: { authorization: `Bearer ${rightAgent.data.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ actorType: 'agent', name: rightAgent.data.profile.name }),
      });
      expect(rightJoin.status).toBe(201);
      expect(rightJoin.data.matched).toBe(true);

      const leftPoll = await jsonRequest<{ matched: boolean; roomId?: string }>(`/api/matchmaking/${leftJoin.data.ticketId}`);
      expect(leftPoll.status).toBe(200);
      expect(leftPoll.data.matched).toBe(true);
    }
  });

  it('resets turn timer at game start and on each turn switch', async () => {
    const hostToken = `timer-host-${Date.now()}`;
    const guestToken = `timer-guest-${Date.now()}`;

    const create = await jsonRequest<{ roomId: string; seatToken: string }>('/api/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actorType: 'human', name: 'timer-host', clientToken: hostToken }),
    });
    expect(create.status).toBe(201);

    await delay(3000);

    const join = await jsonRequest<{ seatToken: string; side: number; state: { turnDeadlineAt: number | null; currentTurn: number } }>(
      `/api/rooms/${create.data.roomId}/join`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actorType: 'human', name: 'timer-guest', clientToken: guestToken }),
      },
    );
    expect(join.status).toBe(201);
    expect(join.data.state.currentTurn).toBe(1);
    expect(join.data.state.turnDeadlineAt).not.toBeNull();
    const timeoutMs = join.data.state.turnTimeoutMs;
    const startRemaining = (join.data.state.turnDeadlineAt as number) - Date.now();
    expect(startRemaining).toBeGreaterThan(timeoutMs - 1_000);

    await delay(2200);

    const hostMove = await jsonRequest<{ currentTurn: number; turnDeadlineAt: number | null; turnTimeoutMs: number }>(
      `/api/rooms/${create.data.roomId}/move`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${create.data.seatToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ x: 7, y: 7 }),
      },
    );
    expect(hostMove.status).toBe(200);
    expect(hostMove.data.currentTurn).toBe(2);
    expect(hostMove.data.turnDeadlineAt).not.toBeNull();
    const switchedRemaining = (hostMove.data.turnDeadlineAt as number) - Date.now();
    expect(switchedRemaining).toBeGreaterThan(timeoutMs - 1_000);
  }, 15_000);

  it('live stats should not count timed-out rooms as active', async () => {
    const hostToken = `live-host-${Date.now()}`;
    const guestToken = `live-guest-${Date.now()}`;

    const create = await jsonRequest<{ roomId: string; seatToken: string }>('/api/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actorType: 'human', name: 'live-host', clientToken: hostToken }),
    });
    expect(create.status).toBe(201);

    const join = await jsonRequest<{ seatToken: string; side: number }>(`/api/rooms/${create.data.roomId}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actorType: 'human', name: 'live-guest', clientToken: guestToken }),
    });
    expect(join.status).toBe(201);

    await delay(5_500);

    const live = await jsonRequest<{ activePlayers: number; activeRooms: number; waitingRooms: number }>('/api/stats/live');
    expect(live.status).toBe(200);

    const active = await jsonRequest<{ activeRooms: Array<{ roomId: string; status: string }> }>('/api/rooms/active');
    expect(active.status).toBe(200);
    expect(active.data.activeRooms.some((room) => room.roomId === create.data.roomId)).toBe(false);
  }, 15_000);
});
