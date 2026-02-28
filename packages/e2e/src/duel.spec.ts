import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const runRealCodexDuel = process.env.RUN_REAL_CODEX_DUEL === '1';
const realCodexTest = runRealCodexDuel ? test : test.skip;

function parseResultJson(raw: string): { roomId: string; winner: number; status: string } {
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error(`cannot parse codex result json: ${raw}`);
    }
    return JSON.parse(match[0]);
  }
}

test('human can create room and Agent can join by room id', async ({ request }) => {
  const rules = await request.get('http://127.0.0.1:8787/api/rules');
  expect(rules.ok()).toBeTruthy();

  const rightRes = await request.post('http://127.0.0.1:8787/api/agent/register', {
    data: { name: `claude-e2e-${Date.now()}`, provider: 'claude', model: 'sonnet' },
  });
  expect(rightRes.ok()).toBeTruthy();

  const right = await rightRes.json();

  const createRes = await request.post('http://127.0.0.1:8787/api/rooms', {
    data: { actorType: 'human', name: `human-host-${Date.now()}` },
  });
  expect(createRes.ok()).toBeTruthy();
  const created = await createRes.json();

  const joinRes = await request.post(`http://127.0.0.1:8787/api/rooms/${created.roomId}/join`, {
    headers: { authorization: `Bearer ${right.token}` },
    data: { actorType: 'agent', name: right.profile.name },
  });
  expect(joinRes.ok()).toBeTruthy();
  const joined = await joinRes.json();

  const bySide = new Map<number, string>();
  bySide.set(1, created.seatToken);
  bySide.set(2, joined.seatToken);

  let done = false;
  for (let step = 0; step < 240; step += 1) {
    const stateRes = await request.get(`http://127.0.0.1:8787/api/rooms/${created.roomId}/state`);
    expect(stateRes.ok()).toBeTruthy();
    const state = await stateRes.json();

    if (state.status === 'finished') {
      done = true;
      break;
    }

    const board = state.board as number[][];
    let action: { x: number; y: number } | null = null;
    for (let y = 0; y < board.length && !action; y += 1) {
      for (let x = 0; x < board[y].length; x += 1) {
        if (board[y][x] === 0) {
          action = { x, y };
          break;
        }
      }
    }

    expect(action).not.toBeNull();

    const token = bySide.get(state.currentTurn);
    expect(token).toBeTruthy();

    const moveRes = await request.post(`http://127.0.0.1:8787/api/rooms/${created.roomId}/move`, {
      headers: { authorization: `Bearer ${token}` },
      data: action!,
    });
    expect(moveRes.ok()).toBeTruthy();
  }

  expect(done).toBeTruthy();

  const statsRes = await request.get('http://127.0.0.1:8787/api/stats/agent');
  expect(statsRes.ok()).toBeTruthy();
  const stats = await statsRes.json();
  expect(stats.leaderboard.length).toBeGreaterThanOrEqual(1);
});

test('human matchmaking can auto-join an existing waiting room', async ({ request }) => {
  const createRes = await request.post('http://127.0.0.1:8787/api/rooms', {
    data: { actorType: 'human', name: `human-a-${Date.now()}` },
  });
  expect(createRes.ok()).toBeTruthy();
  const created = await createRes.json();

  const mmJoinRes = await request.post('http://127.0.0.1:8787/api/matchmaking/join', {
    data: { actorType: 'human', name: `human-b-${Date.now()}` },
  });
  expect(mmJoinRes.ok()).toBeTruthy();
  const mmJoined = await mmJoinRes.json();

  expect(mmJoined.matched).toBeTruthy();
  expect(mmJoined.roomId).toBe(created.roomId);
  expect(mmJoined.side).toBe(2);
  expect(mmJoined.state.status).toBe('playing');
  expect((mmJoined.state.players as Array<unknown>).length).toBe(2);

  const stateRes = await request.get(`http://127.0.0.1:8787/api/rooms/${created.roomId}/state`);
  expect(stateRes.ok()).toBeTruthy();
  const state = await stateRes.json();
  expect(state.status).toBe('playing');
  expect((state.players as Array<unknown>).length).toBe(2);
});

test('agent matchmaking can auto-join an existing waiting room', async ({ request }) => {
  const createRes = await request.post('http://127.0.0.1:8787/api/rooms', {
    data: { actorType: 'human', name: `human-a-${Date.now()}` },
  });
  expect(createRes.ok()).toBeTruthy();
  const created = await createRes.json();

  const registerRes = await request.post('http://127.0.0.1:8787/api/agent/register', {
    data: { name: `agent-b-${Date.now()}`, provider: 'codex', model: 'gpt-5' },
  });
  expect(registerRes.ok()).toBeTruthy();
  const registered = await registerRes.json();

  const mmJoinRes = await request.post('http://127.0.0.1:8787/api/matchmaking/join', {
    headers: { authorization: `Bearer ${registered.token}` },
    data: { actorType: 'agent', name: registered.profile.name },
  });
  expect(mmJoinRes.ok()).toBeTruthy();
  const mmJoined = await mmJoinRes.json();

  expect(mmJoined.matched).toBeTruthy();
  expect(mmJoined.roomId).toBe(created.roomId);
  expect(mmJoined.side).toBe(2);
  expect(mmJoined.state.status).toBe('playing');
  expect((mmJoined.state.players as Array<unknown>).length).toBe(2);
});

test('agents should be paired by matchmaking when no waiting room exists', async ({ request }) => {
  const leftRegisterRes = await request.post('http://127.0.0.1:8787/api/agent/register', {
    data: { name: `agent-left-${Date.now()}`, provider: 'codex', model: 'gpt-5' },
  });
  expect(leftRegisterRes.ok()).toBeTruthy();
  const left = await leftRegisterRes.json();

  const rightRegisterRes = await request.post('http://127.0.0.1:8787/api/agent/register', {
    data: { name: `agent-right-${Date.now()}`, provider: 'claude', model: 'sonnet' },
  });
  expect(rightRegisterRes.ok()).toBeTruthy();
  const right = await rightRegisterRes.json();

  const leftJoinRes = await request.post('http://127.0.0.1:8787/api/matchmaking/join', {
    headers: { authorization: `Bearer ${left.token}` },
    data: { actorType: 'agent', name: left.profile.name },
  });
  expect([201, 202]).toContain(leftJoinRes.status());
  const leftJoin = await leftJoinRes.json();
  if (leftJoinRes.status() === 201) {
    expect(leftJoin.matched).toBeTruthy();
    expect(leftJoin.roomId).toBeTruthy();
    return;
  }
  expect(leftJoin.matched).toBeFalsy();
  expect(leftJoin.ticketId).toBeTruthy();

  const rightJoinRes = await request.post('http://127.0.0.1:8787/api/matchmaking/join', {
    headers: { authorization: `Bearer ${right.token}` },
    data: { actorType: 'agent', name: right.profile.name },
  });
  expect(rightJoinRes.status()).toBe(201);
  const rightJoin = await rightJoinRes.json();
  expect(rightJoin.matched).toBeTruthy();
  expect(rightJoin.roomId).toBeTruthy();
  expect(rightJoin.state.status).toBe('playing');
  expect((rightJoin.state.players as Array<unknown>).length).toBe(2);

  const leftPollRes = await request.get(`http://127.0.0.1:8787/api/matchmaking/${leftJoin.ticketId}`);
  expect(leftPollRes.ok()).toBeTruthy();
  const leftPoll = await leftPollRes.json();
  expect(leftPoll.matched).toBeTruthy();
  expect(leftPoll.roomId).toBe(rightJoin.roomId);
  expect(leftPoll.state.status).toBe('playing');
  expect((leftPoll.state.players as Array<unknown>).length).toBe(2);
});

test('creator leaving room should close that room', async ({ request }) => {
  const createRes = await request.post('http://127.0.0.1:8787/api/rooms', {
    data: { actorType: 'human', name: `host-${Date.now()}` },
  });
  expect(createRes.ok()).toBeTruthy();
  const created = await createRes.json();

  const leaveRes = await request.post(`http://127.0.0.1:8787/api/rooms/${created.roomId}/leave`, {
    headers: { authorization: `Bearer ${created.seatToken}` },
  });
  expect(leaveRes.ok()).toBeTruthy();
  const leavePayload = await leaveRes.json();
  expect(leavePayload.closed).toBeTruthy();

  const stateRes = await request.get(`http://127.0.0.1:8787/api/rooms/${created.roomId}/state`);
  expect(stateRes.status()).toBe(404);
});

test('non-creator leaving room should not close that room', async ({ request }) => {
  const createRes = await request.post('http://127.0.0.1:8787/api/rooms', {
    data: { actorType: 'human', name: `host-${Date.now()}` },
  });
  expect(createRes.ok()).toBeTruthy();
  const created = await createRes.json();

  const joinRes = await request.post(`http://127.0.0.1:8787/api/rooms/${created.roomId}/join`, {
    data: { actorType: 'human', name: `guest-${Date.now()}` },
  });
  expect(joinRes.ok()).toBeTruthy();
  const joined = await joinRes.json();

  const leaveRes = await request.post(`http://127.0.0.1:8787/api/rooms/${created.roomId}/leave`, {
    headers: { authorization: `Bearer ${joined.seatToken}` },
  });
  expect(leaveRes.ok()).toBeTruthy();
  const leavePayload = await leaveRes.json();
  expect(leavePayload.closed).toBeFalsy();

  const stateRes = await request.get(`http://127.0.0.1:8787/api/rooms/${created.roomId}/state`);
  expect(stateRes.ok()).toBeTruthy();
  const state = await stateRes.json();
  expect(state.status).toBe('playing');
});

test('human matchmaking should be idempotent for same client token', async ({ request }) => {
  const clientToken = `human-token-${Date.now()}`;

  const firstJoinRes = await request.post('http://127.0.0.1:8787/api/matchmaking/join', {
    data: { actorType: 'human', name: 'human-1', clientToken },
  });
  expect([201, 202]).toContain(firstJoinRes.status());
  const firstJoin = await firstJoinRes.json();
  if (firstJoinRes.status() === 202) {
    expect(firstJoin.matched).toBeFalsy();
    expect(firstJoin.ticketId).toBeTruthy();
  } else {
    expect(firstJoin.matched).toBeTruthy();
    expect(firstJoin.roomId).toBeTruthy();
  }

  const secondJoinRes = await request.post('http://127.0.0.1:8787/api/matchmaking/join', {
    data: { actorType: 'human', name: 'human-1', clientToken },
  });
  expect([200, 202]).toContain(secondJoinRes.status());
  const secondJoin = await secondJoinRes.json();
  expect(secondJoin.reused).toBeTruthy();
  if (firstJoinRes.status() === 202) {
    expect(secondJoin.ticketId).toBe(firstJoin.ticketId);
  } else {
    expect(secondJoin.roomId).toBe(firstJoin.roomId);
  }
});

test('human create room should be idempotent for same client token', async ({ request }) => {
  const clientToken = `human-create-${Date.now()}`;

  const firstCreateRes = await request.post('http://127.0.0.1:8787/api/rooms', {
    data: { actorType: 'human', name: 'host-1', clientToken },
  });
  expect(firstCreateRes.status()).toBe(201);
  const firstCreate = await firstCreateRes.json();

  const secondCreateRes = await request.post('http://127.0.0.1:8787/api/rooms', {
    data: { actorType: 'human', name: 'host-1', clientToken },
  });
  expect(secondCreateRes.status()).toBe(200);
  const secondCreate = await secondCreateRes.json();
  expect(secondCreate.reused).toBeTruthy();
  expect(secondCreate.roomId).toBe(firstCreate.roomId);
  expect(secondCreate.seatToken).toBe(firstCreate.seatToken);
});

test('human rejoin by room id should succeed with same client token when room is full', async ({ request }) => {
  const hostToken = `host-token-${Date.now()}`;
  const guestToken = `guest-token-${Date.now()}`;

  const createRes = await request.post('http://127.0.0.1:8787/api/rooms', {
    data: { actorType: 'human', name: 'host', clientToken: hostToken },
  });
  expect(createRes.ok()).toBeTruthy();
  const created = await createRes.json();

  const firstJoinRes = await request.post(`http://127.0.0.1:8787/api/rooms/${created.roomId}/join`, {
    data: { actorType: 'human', name: 'guest', clientToken: guestToken },
  });
  expect(firstJoinRes.status()).toBe(201);
  const firstJoin = await firstJoinRes.json();
  expect(firstJoin.side).toBe(2);

  const secondJoinRes = await request.post(`http://127.0.0.1:8787/api/rooms/${created.roomId}/join`, {
    data: { actorType: 'human', name: 'guest', clientToken: guestToken },
  });
  expect(secondJoinRes.status()).toBe(200);
  const secondJoin = await secondJoinRes.json();
  expect(secondJoin.reused).toBeTruthy();
  expect(secondJoin.side).toBe(2);
  expect(secondJoin.seatToken).toBe(firstJoin.seatToken);
});

test('waiting room should be joinable by room id for human visitor', async ({ request }) => {
  const createRes = await request.post('http://127.0.0.1:8787/api/rooms', {
    data: { actorType: 'human', name: `host-link-${Date.now()}` },
  });
  expect(createRes.ok()).toBeTruthy();
  const created = await createRes.json();

  const visitorToken = `visitor-${Date.now()}`;
  const joinRes = await request.post(`http://127.0.0.1:8787/api/rooms/${created.roomId}/join`, {
    data: { actorType: 'human', name: 'visitor', clientToken: visitorToken },
  });
  expect(joinRes.status()).toBe(201);
  const joined = await joinRes.json();
  expect(joined.side).toBe(2);
  expect(joined.state.status).toBe('playing');
  expect((joined.state.players as Array<unknown>).length).toBe(2);
});

test('waiting room should remain waiting before a second player joins', async ({ request }) => {
  const createRes = await request.post('http://127.0.0.1:8787/api/rooms', {
    data: { actorType: 'human', name: `host-link-${Date.now()}` },
  });
  expect(createRes.ok()).toBeTruthy();
  const created = await createRes.json();

  const stateRes = await request.get(`http://127.0.0.1:8787/api/rooms/${created.roomId}/state`);
  expect(stateRes.ok()).toBeTruthy();
  const state = await stateRes.json();
  expect(state.status).toBe('waiting');
  expect((state.players as Array<unknown>).length).toBe(1);
});

test('stale waiting room should be auto cleaned', async ({ request }) => {
  const createRes = await request.post('http://127.0.0.1:8787/api/rooms', {
    data: { actorType: 'human', name: `stale-host-${Date.now()}` },
  });
  expect(createRes.ok()).toBeTruthy();
  const created = await createRes.json();

  const initialLiveRes = await request.get('http://127.0.0.1:8787/api/stats/live');
  expect(initialLiveRes.ok()).toBeTruthy();
  const initialLive = await initialLiveRes.json();
  expect(initialLive.activeRooms).toBeGreaterThanOrEqual(1);

  await new Promise((resolve) => setTimeout(resolve, 5_500));

  const openRes = await request.get('http://127.0.0.1:8787/api/rooms/open');
  expect(openRes.ok()).toBeTruthy();
  const openPayload = await openRes.json();
  expect((openPayload.openRooms as Array<{ roomId: string }>).some((room) => room.roomId === created.roomId)).toBeFalsy();

  const stateRes = await request.get(`http://127.0.0.1:8787/api/rooms/${created.roomId}/state`);
  expect(stateRes.status()).toBe(404);
});

test('direct room link should show join modal component and join with entered name', async ({ request, page }) => {
  try {
    await request.get('http://127.0.0.1:5173');
  } catch {
    test.skip(true, 'web dev server is not reachable on 5173 in this environment');
  }

  const createRes = await request.post('http://127.0.0.1:8787/api/rooms', {
    data: { actorType: 'human', name: `host-ui-${Date.now()}` },
  });
  expect(createRes.ok()).toBeTruthy();
  const created = await createRes.json();

  await page.goto(`http://127.0.0.1:5173/?roomId=${created.roomId}`);

  await expect(page.locator('.modal-overlay')).toBeVisible();
  await expect(page.getByText(/加入房间|Join Room/i).first()).toBeVisible();

  const visitorName = `visitor-ui-${Date.now()}`;
  await page.getByPlaceholder(/我的昵称|Your name/i).fill(visitorName);
  await page.getByRole('button', { name: /加入房间|Join Room/i }).last().click();

  await expect(page.locator('.modal-overlay')).toHaveCount(0);

  const stateRes = await request.get(`http://127.0.0.1:8787/api/rooms/${created.roomId}/state`);
  expect(stateRes.ok()).toBeTruthy();
  const state = await stateRes.json();
  expect(state.status).toBe('playing');
  expect((state.players as Array<{ name: string }>).some((p) => p.name === visitorName)).toBeTruthy();
});

test('agent matchmaking should be idempotent for same agent token', async ({ request }) => {
  const registerRes = await request.post('http://127.0.0.1:8787/api/agent/register', {
    data: { name: `agent-idem-${Date.now()}`, provider: 'codex', model: 'gpt-5' },
  });
  expect(registerRes.ok()).toBeTruthy();
  const registered = await registerRes.json();

  const firstJoinRes = await request.post('http://127.0.0.1:8787/api/matchmaking/join', {
    headers: { authorization: `Bearer ${registered.token}` },
    data: { actorType: 'agent', name: registered.profile.name },
  });
  expect([201, 202]).toContain(firstJoinRes.status());
  const firstJoin = await firstJoinRes.json();
  if (firstJoinRes.status() === 202) {
    expect(firstJoin.matched).toBeFalsy();
    expect(firstJoin.ticketId).toBeTruthy();
  } else {
    expect(firstJoin.matched).toBeTruthy();
    expect(firstJoin.roomId).toBeTruthy();
  }

  const secondJoinRes = await request.post('http://127.0.0.1:8787/api/matchmaking/join', {
    headers: { authorization: `Bearer ${registered.token}` },
    data: { actorType: 'agent', name: registered.profile.name },
  });
  expect([200, 202]).toContain(secondJoinRes.status());
  const secondJoin = await secondJoinRes.json();
  expect(secondJoin.reused).toBeTruthy();
  if (firstJoinRes.status() === 202) {
    expect(secondJoin.ticketId).toBe(firstJoin.ticketId);
  } else {
    expect(secondJoin.roomId).toBe(firstJoin.roomId);
  }
});

realCodexTest('real codex prompt flow duel can finish and can be spectated', async ({ request }) => {
  test.setTimeout(300_000);

  const skillRes = await request.get('http://127.0.0.1:8787/skill.md');
  expect(skillRes.ok()).toBeTruthy();
  const skillText = await skillRes.text();
  expect(skillText).toContain('/api/matchmaking/join');
  expect(skillText).toContain('/api/agent/register');

  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.resolve(thisDir, '../../..');
  const codexBin = process.platform === 'win32' ? 'codex.cmd' : 'codex';
  const codexCheck = spawnSync(codexBin, ['--version'], { encoding: 'utf8' });
  if (codexCheck.status !== 0) {
    throw new Error(
      `codex CLI unavailable. Ensure codex is installed and logged in (run: codex login).\n` +
      `stdout: ${codexCheck.stdout ?? ''}\n` +
      `stderr: ${codexCheck.stderr ?? ''}`,
    );
  }
  const baseUrl = 'http://127.0.0.1:8787';
  const webBaseUrl = process.env.WEB_BASE_URL ?? 'http://127.0.0.1:5173';
  const leftAgentName = `codex-real-left-${Date.now()}`;
  const rightAgentName = `codex-real-right-${Date.now()}`;
  const leftOutFile = path.join(rootDir, 'output', 'e2e-codex-left.json');
  const rightOutFile = path.join(rootDir, 'output', 'e2e-codex-right.json');
  await mkdir(path.join(rootDir, 'output'), { recursive: true });
  const commonArgs = ['exec', '--dangerously-bypass-approvals-and-sandbox', '--color', 'never', '-C', rootDir];

  const leftPrompt =
    `Read ${baseUrl}/skill.md. ` +
    `When calling POST /api/agent/register, use name "${leftAgentName}". ` +
    'Do not create room directly. Join matchmaking when no room id is provided. ' +
    'Continue until the game status is finished. ' +
    'At the end, output exactly one line JSON: {"roomId":"<uuid>","winner":<0|1|2>,"status":"finished"}';

  const leftChild = spawn(codexBin, [...commonArgs, '-o', leftOutFile, leftPrompt], {
    cwd: rootDir,
    env: { ...process.env },
  });
  let leftLogs = '';
  leftChild.stdout.on('data', (buf) => {
    leftLogs += buf.toString();
  });
  leftChild.stderr.on('data', (buf) => {
    leftLogs += buf.toString();
  });

  const rightPrompt =
    `Read ${baseUrl}/skill.md. ` +
    `When calling POST /api/agent/register, use name "${rightAgentName}". ` +
    'Do not create room directly. Join matchmaking when no room id is provided. ' +
    'Continue until the game status is finished. ' +
    'At the end, output exactly one line JSON: {"roomId":"<uuid>","winner":<0|1|2>,"status":"finished"}';

  const rightChild = spawn(codexBin, [...commonArgs, '-o', rightOutFile, rightPrompt], {
    cwd: rootDir,
    env: { ...process.env },
  });
  let rightLogs = '';
  rightChild.stdout.on('data', (buf) => {
    rightLogs += buf.toString();
  });
  rightChild.stderr.on('data', (buf) => {
    rightLogs += buf.toString();
  });

  const roomId = await new Promise<string>(async (resolve, reject) => {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const activeRes = await request.get('http://127.0.0.1:8787/api/rooms/active');
      if (activeRes.ok()) {
        const payload = await activeRes.json();
        const found = (payload.activeRooms as Array<{ roomId: string; players: { name: string }[] }> | undefined)?.find((room) => {
          const names = room.players.map((p) => p.name);
          return names.includes(leftAgentName) && names.includes(rightAgentName);
        });
        if (found?.roomId) {
          resolve(found.roomId);
          return;
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    reject(new Error(`timeout waiting matchmaking room.\nleft logs:\n${leftLogs}\nright logs:\n${rightLogs}`));
  });

  console.log(`Spectator URL: ${webBaseUrl}/?roomId=${roomId}`);

  const playingReady = await new Promise<boolean>(async (resolve) => {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const stateRes = await request.get(`http://127.0.0.1:8787/api/rooms/${roomId}/state`);
      if (stateRes.ok()) {
        const state = await stateRes.json();
        if (state.status === 'playing' || state.status === 'finished') {
          resolve(true);
          return;
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    resolve(false);
  });
  expect(playingReady).toBeTruthy();

  const [leftExitCode, rightExitCode] = await Promise.all([
    new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        leftChild.kill('SIGKILL');
        resolve(-1);
      }, 180_000);
      leftChild.on('close', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    }),
    new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        rightChild.kill('SIGKILL');
        resolve(-1);
      }, 180_000);
      rightChild.on('close', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    }),
  ]);

  const [leftOut, rightOut] = await Promise.all([
    readFile(leftOutFile, 'utf8'),
    readFile(rightOutFile, 'utf8'),
  ]);
  const leftResult = parseResultJson(leftOut);
  const rightResult = parseResultJson(rightOut);

  expect(leftExitCode, leftLogs).toBe(0);
  expect(rightExitCode, rightLogs).toBe(0);
  expect(leftResult.status).toBe('finished');
  expect(rightResult.status).toBe('finished');
  expect(leftResult.roomId).toBe(roomId);
  expect(rightResult.roomId).toBe(roomId);
  expect([0, 1, 2]).toContain(leftResult.winner);
  expect([0, 1, 2]).toContain(rightResult.winner);

  const finalStateRes = await request.get(`http://127.0.0.1:8787/api/rooms/${roomId}/state`);
  if (finalStateRes.ok()) {
    const finalState = await finalStateRes.json();
    expect(finalState.status).toBe('finished');
    expect([0, 1, 2]).toContain(finalState.winner);
  } else {
    expect(finalStateRes.status()).toBe(404);
  }
});
