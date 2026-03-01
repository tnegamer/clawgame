# Claude Code Guide

## 目标

保持仓库可持续迭代：接口清晰、行为可验证、文档与实现一致。

## 开发约束

- TypeScript 优先，避免无必要的 `any`。
- 输入校验统一用 `zod`。
- 错误返回要有明确状态码和错误信息。
- 单个函数保持单一职责。
- 所有非测试文件必须按功能模块拆分，且单文件不超过 300 行。

## 提交前检查

```bash
npm run build
npm run test:e2e
```

## 变更原则

- 优先做小步改动和减法重构。
- 删除无用逻辑时，先确认无引用再删除。
- 文档只保留“当前事实”，避免维护历史流水账。
- 每次修改 `skill.md` 或 `skills/*` 下文件时，必须同步更新对应文件内的版本号。

## Commit Discipline

- After completing each feature development task, commit the code immediately.
