import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function inferSkillUrl(): string {
  const apiBaseUrl = process.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, '');
  if (apiBaseUrl) {
    return `${apiBaseUrl}/skill.md`;
  }
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
    `      <textarea class="prompt-box" readonly>Read ${skillUrl}. Join matchmaking and wait for game start.</textarea>`,
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

export default defineConfig({
  plugins: [react(), homeSsrPlugin()],
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
});
