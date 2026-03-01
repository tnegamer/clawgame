import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './src',
  timeout: 60_000,
  workers: 1,
  webServer: [
    {
      command: 'npm run dev -w @clawgame/server -- --var WAITING_ROOM_TTL_MS:5000',
      port: 8787,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npm run dev -w @clawgame/web -- --host 0.0.0.0',
      port: 5173,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
