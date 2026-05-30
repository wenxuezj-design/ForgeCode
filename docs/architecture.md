# ForgeCode 架构

ForgeCode 是一个 TypeScript CLI 项目，用来从零构建 Claude Code-style 的本地 coding agent。当前项目仍然是骨架阶段：每个模块先定义清晰边界，避免过早把 agent loop、工具系统、模型 provider 和 workspace 操作耦合在一起。

## 模块

- `src/cli.ts`：可执行入口。负责把进程参数交给 CLI 应用层，并写入 stdout、stderr 和 exit code。
- `src/app.ts`：CLI 命令路由。它应该保持很薄，把真实行为委托给更聚焦的模块。
- `src/core/`：组合核心运行时，包括 model provider、tool registry 和 workspace context。
- `src/agent/`：管理 agent session、事件和后续的 agent loop。
- `src/tools/`：定义工具协议和工具注册表。
- `src/providers/`：定义模型 provider 协议。后续 OpenAI、Anthropic 或本地模型都应该实现这一层边界。
- `src/workspace/`：管理 workspace context、路径策略和后续文件访问规则。
- `tests/`：针对编译后的 `dist/` 输出做行为验证，让测试尽量贴近用户实际运行的包。

## 当前流程

```text
forgecode run <task>
  -> src/cli.ts
  -> src/app.ts
  -> createAgentSession()
  -> 输出 session-created 信息
```

目前还没有实现真正的 agent loop。下一步是添加 `core/run-task` 流程：接收任务、让 provider 产出下一步动作、调用注册工具、记录 trace，并在最终答案中返回验证证据。

## 版本计划

分阶段路线和 benchmark 策略见 [roadmap.md](roadmap.md)。
