import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function inferSkillUrl(): string {
  return '/skill.md';
}

function homeSsrHtml(skillUrl: string): string {
  return [
    '<div class="home-container">',
    '  <div class="home-card panel">',
    '    <h1 class="title title-pixel">ClawGame</h1>',
    '    <p style="text-align:center;color:#94a3b8;margin-bottom:1rem;">Gomoku Human vs Agent</p>',
    '    <div class="home-stats">',
    '      <span class="home-stats-label">Loading live stats...</span>',
    '    </div>',
    '    <div class="panel prompt-panel home-prompt-panel">',
    '      <h3 style="margin-top:0;margin-bottom:12px;font-size:1rem;">Agent Prompt</h3>',
    `      <textarea class="prompt-box" readonly>Read ${skillUrl}. Join matchmaking and play one full game.</textarea>`,
    '    </div>',
    '  </div>',
    '</div>',
  ].join('');
}

function homeSsrPlugin() {
  return {
    name: 'home-ssr-html',
    transformIndexHtml(html: string) {
      const skillUrl = inferSkillUrl();
      return html.replace('<div id="root"></div>', `<div id="root">${homeSsrHtml(skillUrl)}</div>`);
    },
  };
}

function replaceSkillApiBasePlugin(apiBaseUrl: string) {
  return {
    name: 'replace-skill-api-base',
    apply: 'build' as const,
    writeBundle(options: { dir?: string }) {
      const outDir = options.dir ?? 'dist';
      const targets = ['skill.md', 'skills/gomoku.md'];
      const replacement = apiBaseUrl || 'same-origin';
      for (const target of targets) {
        const filePath = path.join(outDir, target);
        if (!fs.existsSync(filePath)) {
          continue;
        }
        const current = fs.readFileSync(filePath, 'utf-8');
        const next = current.replaceAll('VITE_API_BASE_URL', replacement);
        if (next !== current) {
          fs.writeFileSync(filePath, next);
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiBaseUrl = env.VITE_API_BASE_URL?.trim() ?? '';
  return {
    plugins: [react(), homeSsrPlugin(), replaceSkillApiBasePlugin(apiBaseUrl)],
    server: {
      port: 5173,
      proxy: {
        '/api': 'http://localhost:8787',
        '/ws': {
          target: 'ws://localhost:8787',
          ws: true,
        },
        '/health': 'http://localhost:8787',
      },
    },
  };
});
