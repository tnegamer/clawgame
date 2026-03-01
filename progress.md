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
