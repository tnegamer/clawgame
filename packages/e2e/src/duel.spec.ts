import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';

const execFileAsync = promisify(execFile);

test('two AI players can finish one gomoku duel', async ({ request }) => {
  const rules = await request.get('http://localhost:8787/api/rules');
  expect(rules.ok()).toBeTruthy();

  const leftRes = await request.post('http://localhost:8787/api/ai/register', {
    data: { name: `codex-e2e-${Date.now()}`, provider: 'codex', model: 'gpt-5' },
  });
  const rightRes = await request.post('http://localhost:8787/api/ai/register', {
    data: { name: `claude-e2e-${Date.now()}`, provider: 'claude', model: 'sonnet' },
  });
  expect(leftRes.ok()).toBeTruthy();
  expect(rightRes.ok()).toBeTruthy();

  const left = await leftRes.json();
  const right = await rightRes.json();

  const createRes = await request.post('http://localhost:8787/api/rooms', {
    headers: { authorization: `Bearer ${left.token}` },
    data: { actorType: 'ai', name: left.profile.name },
  });
  expect(createRes.ok()).toBeTruthy();
  const created = await createRes.json();

  const joinRes = await request.post(`http://localhost:8787/api/rooms/${created.roomId}/join`, {
    headers: { authorization: `Bearer ${right.token}` },
    data: { actorType: 'ai', name: right.profile.name },
  });
  expect(joinRes.ok()).toBeTruthy();
  const joined = await joinRes.json();

  const bySide = new Map<number, string>();
  bySide.set(1, created.seatToken);
  bySide.set(2, joined.seatToken);

  let done = false;
  for (let step = 0; step < 240; step += 1) {
    const stateRes = await request.get(`http://localhost:8787/api/rooms/${created.roomId}/state`);
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

    const moveRes = await request.post(`http://localhost:8787/api/rooms/${created.roomId}/move`, {
      headers: { authorization: `Bearer ${token}` },
      data: action!,
    });
    expect(moveRes.ok()).toBeTruthy();
  }

  expect(done).toBeTruthy();

  const statsRes = await request.get('http://localhost:8787/api/stats/ai');
  expect(statsRes.ok()).toBeTruthy();
  const stats = await statsRes.json();
  expect(stats.leaderboard.length).toBeGreaterThanOrEqual(2);
});

test('skill prompt flow is published and autonomous duel can finish', async ({ request }) => {
  const skillRes = await request.get('http://localhost:8787/skill.md');
  expect(skillRes.ok()).toBeTruthy();
  const skillText = await skillRes.text();
  expect(skillText).toContain('/api/rooms/open');
  expect(skillText).toContain('/api/ai/register');

  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.resolve(thisDir, '../../..');
  const tsxBin = path.join(rootDir, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
  const duelScript = path.join(rootDir, 'packages', 'ai-bot', 'src', 'autonomous-duel.ts');
  const { stdout } = await execFileAsync(tsxBin, [duelScript], {
    cwd: rootDir,
    env: {
      ...process.env,
      BASE_URL: 'http://localhost:8787',
    },
    timeout: 45_000,
  });

  expect(stdout).toContain('game finished winner=');
});
