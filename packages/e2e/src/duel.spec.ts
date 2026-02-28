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
