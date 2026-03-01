# Progress

Original prompt: web 端调用 live 和 move 改成通过 ws

## Current Scope

- Gomoku referee server (rules, room lifecycle, turn validation, winner settlement)
- Web UI for human play / join / matchmaking / spectating logs
- Agent API for register, join, reconnect, move, history and leaderboard
- Playwright E2E including optional real codex duel mode

## Current Status

- Build passes: `npm run build`
- E2E available: `npm run test:e2e`
- Real agent duel available: `npm run test:e2e:real-agent`
- Web now requests live stats via WS (`/ws?live=1` + `live_request`)
- Web now submits moves via room WS (`type: move`) and awaits `move_result`
- Server WS supports `live_request` + `move` while preserving HTTP compatibility

## Notes

- Room/game state is in-memory (dev-oriented).
- Finished rooms are recycled by `FINISHED_ROOM_TTL_MS`.

## 2026-03-01 Session (UI persistence + room ID copy)

- Updated web theme storage key from generic `theme` to `clawgame:theme` and kept `data-theme` sync on `<html>`.
- Added explicit language persistence in `localStorage` with key `clawgame:language` and synced both in `App.tsx` and i18next detector config.
- Added new i18n keys: `common.clickToCopy`, `messages.copyFailed` (zh/en).
- Changed room header ID interaction from double-clicking input to single-clicking a badge-style button that copies room ID.
- Added copied-success visual state (`.room-id-copy-btn.copied`) with pulse animation and check icon text feedback.
- TODO: run build + quick interaction check to confirm no regressions.
- Verification: `npm run build:web` passed.
- Verification (skill client): ran `web_game_playwright_client.js` against `http://localhost:5174` and inspected `output/web-game/shot-0.png`, `state-0.json`; observed one existing 404 resource warning in `errors-0.json`.
- Verification (Playwright MCP): created room, clicked room ID badge and confirmed label switched to copied state; toggled theme/language then reloaded and confirmed persistence values `{clawgame:theme: dark, clawgame:language: en}` and `data-theme=dark`.
- TODO: If needed, clean up existing 404 static resource warning reported by browser console (not introduced by this change).
- Updated finish banner copy to player-perspective wording: title shows won/lost/draw based on `mySide`, and reason text now uses self/opponent perspective for `win` and `opponent_timeout` cases.
- Added i18n keys for `room.result.*` and `room.finishReason.perspective.*` in zh/en.
- Verification: `npm run build:web:only` passed.

## 2026-03-01 Session (Cloudflare best-practice storage alignment)

- Researched Cloudflare docs and aligned architecture to: Durable Objects for real-time room coordination/state, D1 for persistent agent token/profile/history data.
- Added D1 binding (`DB`) in `packages/server/wrangler.toml` and added D1 migration file `packages/server/migrations/0001_init.sql`.
- Refactored server persistence:
  - Agent identity + stats + history now persisted in D1 (schema auto-ensured at runtime via `ensureD1Schema`).
  - Runtime room/matchmaking/seat state snapshot now persisted in Durable Object storage (`runtime:v1`) and restored on DO startup.
- Added runtime state persistence calls to room/matchmaking/move/reconnect/leave/timeouts flows.
- Verification: `npm run test:unit -w @clawgame/server` passed (6/6).

## 2026-03-01 Session (duel UI jitter + desktop/mobile e2e)

- Fixed board info jitter risk during duel by stabilizing the second info row layout.
- `RoomView`: always renders the second info row container; non-playing state uses hidden placeholder to preserve layout height.
- Countdown now uses fallback `--:--` when deadline is missing to avoid content disappearance.
- CSS updates:
  - `.board-info-live` uses fixed min-height and nowrap.
  - `.board-countdown` uses right alignment with stable width behavior.
  - mobile responsive rules force full-width live row with consistent spacing.
- Added e2e test: `board info layout should stay stable during duel on desktop and mobile`.
  - Two real human players join a room and play moves.
  - Verifies `.board-info-live` visible in playing state.
  - Verifies `.board-surface` Y position remains stable across countdown ticks and moves.
- Verification:
  - `npm run test -w @clawgame/e2e -- --config=playwright.local.config.ts --grep "two real human players can enter game when B joins via room link|board info layout should stay stable during duel on desktop and mobile"` passed (2/2).
  - `npm run build:web:only` passed.
