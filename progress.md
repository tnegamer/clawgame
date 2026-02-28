Original prompt: 这是一个提供给 Agent 玩游戏的平台，第一版本提供五子棋。
- Agent（通过各种方式例如 claude、codex 或者 openclaw）通过 api 加入游戏，接着可以自主进行游戏。可以参考 https://www.moltbook.com/ 的实现
- 人类玩家可以跟Agent玩家对战，也可以Agent与另一个Agent玩家对战
- 进入游戏的方式是，人类玩家打开页面，创建游戏房间，等待Agent玩家加入对战。Agent 玩家进入游戏的方式是通过 api 了解到规则，自行决定加入游戏并了解游戏规则玩法，自行通过 api 操作游戏。完成后可以统计战况
- Agent 通过 api 第一次调用后会获得 token，便于让服务端记录该Agent玩家的战况
- 使用 vite + react + ts 开发游戏，后端请调研后给出方案，要求能承受百人在线
- 项目要完成端到端测试，通过命令行 codex --dangerously-bypass-approvals-and-sandbox  启动两个 Agent 玩家加入五子棋对决，完成一次对决游戏。
- 没完成一个功能都要提交代码
- 需要补充 README.md 和 Claude.md 规范代码开发
- 不断迭代直到测试通过
- 选择合适的线上部署方案，要求免费额度覆盖需求，并自动部署

TODO:
- 初始化前后端与共享类型
- 打通房间、Agent token、对战与战绩 API
- 前端房间与棋盘交互
- Agent bot 与 E2E 对战脚本
- 文档与部署方案

Update 2026-02-28:
- Initialized monorepo with packages: web/server/shared/agent-bot/e2e.
- Implemented Gomoku backend APIs with in-memory room state, Agent registration token, seat token auth, move validation, winner detection, Agent leaderboard, and WS state push.
- Implemented React frontend for human create/join room and play board.
- Added Agent bot library + single bot + agent-vs-agent duel script.
- Added Playwright E2E test for full Agent-vs-Agent game completion.
- Verified: `npm run build`, `npm run test:e2e` pass.
- Ran develop-web-game Playwright client and reviewed screenshot/state artifacts under `output/web-game/`.

TODO:
- Add README.md and Claude.md with dev规范 + deployment方案.
- Add CI/CD workflow and free-tier deployment target recommendation.
- Make required incremental git commits per functionality.

Update 2026-02-28 (clarification):
- Clarified architecture: server is referee only; Agent logic remains external via API.
- Added docs/LLM_AGENT_API.md to define external LLM agent integration protocol.
- Updated README to avoid misunderstanding around built-in Agent.

Update 2026-02-28 (codex prompt flow):
- Removed root-level duel npm scripts and deleted scripts/agent_duel_once.sh.
- Updated README to codex-cli prompt-only gameplay flow (no npm duel/bot script required for user).
- Updated E2E to run autonomous duel via direct tsx invocation instead of npm run script wrapper.
- Re-verified build + e2e pass.

Update 2026-02-28 (spectator + decision logs):
- Added per-move decision logs in server state (`decisionLogs`) with source + thought payload.
- Added `/api/rooms/:roomId/logs` endpoint and updated skill.md guidance to include decision logging.
- Updated web UI with right-side real-time LLM decision log panel and spectator URL support (`?roomId=`).
- Updated autonomous duel to run bots directly via `tsx` and emit room id in output.
- Extended E2E to open web spectator and assert live LLM decision logs appear.
- Verified build + e2e pass; also verified visual layout via develop-web-game screenshot.

Update 2026-02-28 (definition alignment):
- Unified terminology to "Agent" and removed wording that implies platform provides LLM.
- Changed spectator panel title to "Agent 决策日志".
- Changed default decision source from llm to agent in bot client.
- Updated skill/docs/readme wording to emphasize external agent autonomy and server referee-only role.
- Re-verified build + e2e pass.

Update 2026-02-28 (gomoku intent clarification):
- Strengthened server-provided rules and skill.md text to explicitly state this is Gomoku and objective is to win (not just legal moves).
- Added decision priority guidance: win-in-1, block-in-1, then build strongest line.
- Extended RulesResponse with objective + strategyHints.
- Updated README and protocol docs to recommend explicit win-oriented prompt wording.
- Verified build + e2e pass.

Update 2026-02-28 (human move failure fix):
- Fixed web jsonFetch header merge bug where per-request headers overwrote default content-type.
- Now POST move requests consistently send application/json, preventing express.json parse failures.
- Verified build + e2e pass.

Update 2026-02-28 (human room URL + prompt UX + stricter skill):
- When create/join room succeeds, URL now syncs with ?roomId=<id>.
- Added in-page prompt box with one-click copy for Agent join instructions containing exact room id.
- Strengthened skill.md: no script generation, no local file usage, each move must be reasoned from latest API board state.
- Updated README/protocol docs accordingly.
- Verified build + e2e pass.

Update 2026-02-28 (agent interruption fix):
- Strengthened skill.md with explicit persistence rules: opponent turn waiting is not blocker; never stop before status=finished.
- Updated in-page copied prompt with non-termination requirement during wait turns.
- Added docs section for wait-loop behavior and retry cadence.
- Verified build + e2e pass.

Update 2026-02-28 (auto-continue after interruption):
- Added POST /api/rooms/:roomId/reconnect to restore Agent seat after process interruption.
- reconnect rotates seat token and returns latest game state.
- Updated skill/readme/prompt text to require reconnect + continue loop until status=finished.
- Verified build + e2e pass.

Update 2026-02-28 (english skill + short prompt):
- Converted rules apiGuide strings to English for API-facing agent instructions.
- Shortened in-page Agent prompt to only include skill URL + room id + finish condition.
- Updated README and API doc prompt examples to concise English wording with room id.
- Verified build + e2e pass.

Update 2026-02-28 (strict completion criteria):
- Added explicit requirement in skill/docs/prompt: task is complete only when winner is 1 or 2.
- Clarified that winner=0 is not completion and must continue.
- Verified build + e2e pass.

Update 2026-02-28 (board intersections rendering):
- Changed web board rendering from tile cells to true line intersections for Gomoku stones.
- Implemented absolute-positioned intersection buttons over a line-grid board background.
- Kept backend coordinates unchanged (`x,y` still map to 15x15 intersections).
- Verified frontend build passes.
- Ran develop-web-game Playwright client and reviewed latest screenshot artifact under `output/web-game/`.

Update 2026-02-28 (new termination policy):
- Changed forced termination criteria to: game finished OR board full OR opponent timeout > 60s.
- Added room finishReason in state: win / draw_board_full / opponent_timeout.
- Implemented server-side turn timeout settlement and reconnect activity refresh.
- Updated prompt and docs to reflect new completion policy.
- Verified build + e2e pass.

Update 2026-02-28 (minimal prompt):
- Reduced copied Agent prompt to room-id only format: ROOM_ID=<ROOM_ID>.
- Updated README and API doc prompt examples to room-id only.
- Verified build pass.

Update 2026-02-28 (prompt wording final):
- Updated copied prompt and docs to exact wording: "Read http://127.0.0.1:8787/skill.md, then join room <ROOM_ID>."
- Verified build pass.

Update 2026-02-28 (single-move early exit mitigation):
- Added mandatory execution contract in skill.md: "join room" prompt still requires full lifecycle until termination conditions.
- Explicitly stated "Never stop after a single move".
- Synced this default behavior in API protocol doc.
- Verified build + e2e pass.

Update 2026-02-28 (home player count + generic Agent prompt):
- Added live stats endpoint `GET /api/stats/live` returning activePlayers/activeRooms/waitingRooms.
- Home page now shows "当前玩家数" with live polling stats.
- Home page now includes copyable Agent prompt text:
  `Read http://127.0.0.1:8787/skill.md. If no room id is provided, join a waiting room; if none exists, create a room and wait for another Agent to join.`
- Added explicit Chinese hint explaining no-room-id behavior (join waiting room or create-and-wait).
- Kept room page prompt with room id for directed joins.
- Verified `npm run build` passes.
- Ran develop-web-game Playwright client against `http://localhost:5175` and reviewed latest screenshot `output/web-game/shot-0.png`.

Update 2026-02-28 (frontend i18n auto switch):
- Added lightweight i18n in `packages/web/src/App.tsx` with `zh/en` copy dictionaries.
- Added automatic locale detection from `navigator.language` (`zh*` => Chinese, else English).
- Added `languagechange` listener to auto-update displayed language without manual toggle.
- Migrated homepage and room-page user-facing copy to i18n keys, including status, prompts, errors, and finish reasons.
- Verified `npm run build:web` passes.
- Ran develop-web-game Playwright client against `http://localhost:5175`; reviewed screenshot `output/web-game/shot-0.png` confirming English UI under non-zh locale.
Update 2026-02-28 (human join room-id input normalization):
- Added frontend room-id normalization before join request.
- Join now accepts pasted values like full URL (`...?roomId=`), `roomId=...`, `ID: ...`, and trimmed/mixed-case input.
- join request uses normalized id and syncs normalized id back to input/url state.
Update 2026-02-28 (human create+join regression test):
- Verified backend join endpoint works with canonical room id.
- Added manual Playwright regression run (two browser contexts): first human creates room, second human joins using `ID: <roomId>` input; join succeeds and lands on `?roomId=<id>`.
- Verification command output: `PASS roomId=<uuid>`.
- `npm run build` passed.
- `npm run test:e2e` currently has one existing locale-sensitive failure in spectator heading assertion (expects Chinese heading text only).
Update 2026-02-28 (room recycle on game finish):
- Added finished-room recycle mechanism in server memory.
- New env var: `FINISHED_ROOM_TTL_MS` (default 30000ms) controls how long a finished room is retained before deletion.
- On `win` / `draw_board_full` / `opponent_timeout`, server now schedules room recycle.
- Recycle removes both room data and associated seat-token index entries.
- Verified with temporary server (`PORT=8788 FINISHED_ROOM_TTL_MS=500`): room state is available immediately after finish (200), then returns 404 after TTL.
Update 2026-02-28 (i18n library integration):
- Replaced manual frontend locale dictionary wiring with `i18next + react-i18next + i18next-browser-languagedetector` in `packages/web`.
- Added `packages/web/src/i18n.ts` to centralize zh/en translation resources and language detection config.
- Updated `packages/web/src/main.tsx` to initialize i18n before rendering App.
- Migrated `packages/web/src/App.tsx` copy rendering from local `copyByLocale` object to `t(...)` translation keys.
- Verified `npm run build:web` passes.
- Ran develop-web-game Playwright client against `http://localhost:5176`; reviewed screenshot `output/web-game/shot-1.png` and state snapshots to confirm UI renders with translated text and no functional regression in home flow.
Update 2026-02-28 (prompt-driven Agent-vs-Agent E2E full pass):
- Reproduced failure in `packages/e2e/src/duel.spec.ts` caused by locale-coupled assertions (`Agent 决策日志` / `来源: agent`).
- Fixed E2E assertions to be locale-agnostic:
  - heading now matches `/Agent 决策日志|Agent Decision Logs/i`
  - decision log item now asserts generic `agent` text instead of Chinese-only prefix.
- Re-ran `npm run test:e2e`: all tests passed (2/2).
- Also executed autonomous duel script directly:
  - left Agent created room and joined as side=1
  - right Agent joined same room as side=2
  - game completed with winner output.
Update 2026-02-28 (remove local agent-bot package, switch to real codex duel test):
- Confirmed `packages/agent-bot/src/autonomous-duel.ts` was not launching real Codex; it spawned local `tsx bot.ts` workers.
- Removed `packages/agent-bot` package files entirely.
- Reworked E2E prompt-flow test to run two real `codex exec` processes:
  - left Codex explicitly creates a new room and plays to finish;
  - right Codex joins the detected fresh room id and plays to finish.
- Added room-detection robustness to avoid stale waiting rooms from earlier runs.
- Added longer test timeout and child-process timeout guards.
- Validation:
  - `npm run test:e2e` passed (2/2), prompt-flow test duration ~2.1m.
  - `npm run build` passed.
Update 2026-02-28 (on-demand real Codex duel test + spectator link):
- Changed real-Codex duel test to run only when `RUN_REAL_CODEX_DUEL=1`; default `npm run test:e2e` now skips it.
- Added dedicated scripts:
  - root: `npm run test:e2e:codex`
  - e2e workspace: `npm run test:real-codex`
- Real duel test now prints live spectator URL immediately after room allocation:
  - `Spectator URL: http://localhost:5173/?roomId=<ROOM_ID>`
- Improved room detection robustness by assigning a unique left-agent register name and matching `/api/rooms/open` owner name.
- Verified:
  - `npm run test:e2e`: regular suite passes with real-codex test skipped.
  - `npm run test:e2e:codex`: passes and prints spectator URL.
Update 2026-02-28 (matchmaking rule refactor):
- Enforced new room policy:
  - Human can create room directly (`POST /api/rooms`) or join matchmaking.
  - Agent cannot create room directly anymore (`POST /api/rooms` for agent now returns 403).
  - Agent can only join matchmaking (`POST /api/matchmaking/join`) or join by known room id (`POST /api/rooms/:roomId/join`).
- Added matchmaking endpoints:
  - `POST /api/matchmaking/join`
  - `GET /api/matchmaking/:ticketId`
  - Auto-create room and start game when two queued players are matched.
- Added `GET /api/rooms/active` to expose currently active rooms and player names (used by on-demand real codex spectator test).
- Updated server skill markdown to matchmaking-first Agent flow and removed Agent self-create guidance.
- Updated web home UX:
  - Added human `Join Matchmaking` button.
  - Added polling flow to transition to room automatically after match assignment.
  - Updated i18n prompts/messages to matchmaking rule.
- Updated docs (`README.md`, `docs/LLM_AGENT_API.md`) to reflect new policy and API flow.
- Updated regular e2e test to new rule: human creates room, Agent joins by room id.
- Validation:
  - `npm run build` passed.
  - `npm run test:e2e` passed (real-codex test remains on-demand and skipped by default).
  - API spot-check confirmed:
    - Agent direct create => 403.
    - Two matchmaking joins => auto-created room with status=playing.
