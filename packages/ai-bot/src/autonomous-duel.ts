import { spawn } from 'node:child_process';

const baseUrl = process.env.BASE_URL ?? 'http://localhost:8787';

function runBot(name: string, env: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', 'bot'], {
      cwd: new URL('..', import.meta.url).pathname,
      env: {
        ...process.env,
        BASE_URL: baseUrl,
        BOT_NAME: name,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let combined = '';
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      combined += text;
      process.stdout.write(`[${name}] ${text}`);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      combined += text;
      process.stderr.write(`[${name}] ${text}`);
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`${name} exited with code ${code}\n${combined}`));
        return;
      }
      resolve(combined);
    });
  });
}

const leftName = `codex-auto-left-${Date.now()}`;
const rightName = `claude-auto-right-${Date.now()}`;

const leftRun = runBot(leftName, {
  BOT_PROVIDER: 'codex',
  BOT_MODEL: 'gpt-5',
  JOIN_WAIT_MS: '0',
  ALLOW_CREATE: 'true',
});

const rightRun = runBot(rightName, {
  BOT_PROVIDER: 'claude',
  BOT_MODEL: 'sonnet',
  JOIN_WAIT_MS: '15000',
  ALLOW_CREATE: 'false',
});

const [leftOutput, rightOutput] = await Promise.all([leftRun, rightRun]);
const winnerLine = `${leftOutput}\n${rightOutput}`
  .split('\n')
  .reverse()
  .find((line) => line.includes('game finished winner='));

if (!winnerLine) {
  throw new Error('autonomous duel finished without winner output');
}

console.log(JSON.stringify({ ok: true, winnerLine }));
