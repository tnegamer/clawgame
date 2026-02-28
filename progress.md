Original prompt: 这是一个提供给 AI 玩游戏的平台，第一版本提供五子棋。
- AI（通过各种方式例如 claude、codex 或者 openclaw）通过 api 加入游戏，接着可以自主进行游戏。可以参考 https://www.moltbook.com/ 的实现
- 人类玩家可以跟AI玩家对战，也可以AI与另一个AI玩家对战
- 进入游戏的方式是，人类玩家打开页面，创建游戏房间，等待AI玩家加入对战。AI 玩家进入游戏的方式是通过 api 了解到规则，自行决定加入游戏并了解游戏规则玩法，自行通过 api 操作游戏。完成后可以统计战况
- AI 通过 api 第一次调用后会获得 token，便于让服务端记录该AI玩家的战况
- 使用 vite + react + ts 开发游戏，后端请调研后给出方案，要求能承受百人在线
- 项目要完成端到端测试，通过命令行 codex --dangerously-bypass-approvals-and-sandbox  启动两个 AI 玩家加入五子棋对决，完成一次对决游戏。
- 没完成一个功能都要提交代码
- 需要补充 README.md 和 Claude.md 规范代码开发
- 不断迭代直到测试通过
- 选择合适的线上部署方案，要求免费额度覆盖需求，并自动部署

TODO:
- 初始化前后端与共享类型
- 打通房间、AI token、对战与战绩 API
- 前端房间与棋盘交互
- AI bot 与 E2E 对战脚本
- 文档与部署方案

Update 2026-02-28:
- Initialized monorepo with packages: web/server/shared/ai-bot/e2e.
- Implemented Gomoku backend APIs with in-memory room state, AI registration token, seat token auth, move validation, winner detection, AI leaderboard, and WS state push.
- Implemented React frontend for human create/join room and play board.
- Added AI bot library + single bot + ai-vs-ai duel script.
- Added Playwright E2E test for full AI-vs-AI game completion.
- Verified: `npm run build`, `npm run test:e2e` pass.
- Ran develop-web-game Playwright client and reviewed screenshot/state artifacts under `output/web-game/`.

TODO:
- Add README.md and Claude.md with dev规范 + deployment方案.
- Add CI/CD workflow and free-tier deployment target recommendation.
- Make required incremental git commits per functionality.

Update 2026-02-28 (clarification):
- Clarified architecture: server is referee only; AI logic remains external via API.
- Added docs/LLM_AGENT_API.md to define external LLM agent integration protocol.
- Updated README to avoid misunderstanding around built-in AI.

Update 2026-02-28 (codex prompt flow):
- Removed root-level duel npm scripts and deleted scripts/ai_duel_once.sh.
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
- Unified terminology to "AI Agent" and removed wording that implies platform provides LLM.
- Changed spectator panel title to "AI 决策日志".
- Changed default decision source from llm to agent in bot client.
- Updated skill/docs/readme wording to emphasize external agent autonomy and server referee-only role.
- Re-verified build + e2e pass.

Update 2026-02-28 (gomoku intent clarification):
- Strengthened server-provided rules and skill.md text to explicitly state this is Gomoku and objective is to win (not just legal moves).
- Added decision priority guidance: win-in-1, block-in-1, then build strongest line.
- Extended RulesResponse with objective + strategyHints.
- Updated README and protocol docs to recommend explicit win-oriented prompt wording.
- Verified build + e2e pass.
