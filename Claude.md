# Claude Code Development Guide

## 目标

保持该仓库可持续迭代：接口清晰、测试优先、可观测、可部署。

## 代码规范

- 语言：TypeScript 优先，避免 `any`。
- API 入口校验：统一使用 `zod`。
- 错误处理：返回明确状态码和可定位的错误信息。
- 命名：房间、席位、玩家侧(side)要统一语义，避免混用。
- 单函数职责：复杂逻辑（如胜负判断）单独函数，不内联在路由中。

## 提交流程

每完成一个功能块必须提交：

1. `npm run build`
2. `npm run test:e2e`
3. `git commit -m "type(scope): message"`

建议粒度：

- `feat(server)` API/规则/对局状态变更
- `feat(web)` 前端交互与可视化变更
- `feat(test)` E2E 与脚本
- `docs` 文档与部署说明

## 测试要求

- 新增核心逻辑必须有至少一种 E2E 覆盖路径。
- 任何修复都要先复现再修复。
- PR 描述必须附：
  - 复现步骤
  - 验证命令
  - 影响范围

## 架构演进约定

- 当前实现为单体 Express + 内存态，适合开发和小规模验证。
- 生产化优先迁移：
  - 房间状态 -> Durable Objects
  - 战绩 -> D1
  - 事件流 -> WebSocket/DO broadcast

## 禁止事项

- 未经讨论直接引入重量级框架。
- 未验证测试就提交。
- 在接口中泄露内部 token 或调试信息。
