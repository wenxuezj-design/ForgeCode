# ForgeCode

一个从第一性原理出发构建的开放式 coding agent。

ForgeCode 从一个小型 TypeScript CLI 开始，目标是逐步成长为一个 Claude Code-style 的本地编码智能体：核心清晰、工具接口明确、行为可测试、结果可评估。

这里的“第一性原理”指的是：不从“复刻某个界面或功能清单”开始，而是先拆解 coding agent 必须成立的基本事实：任务理解、上下文发现、工具调用、文件修改、验证闭环、安全边界和可复现评估。ForgeCode 会从这些基本能力出发，再逐步逼近 Claude Code-style 的工程设计和使用体验。

## 快速开始

```bash
npm install
npm test
npm run dev
npm run dev -- --help
npm run dev -- run "inspect this repository"
```

## 脚本

- `npm run dev`：构建并在本地运行 CLI。
- `npm test`：运行 Node 测试套件。
- `npm run typecheck`：执行 TypeScript 类型检查。
- `npm run build`：将 CLI 编译到 `dist/`。

## 当前范围

- CLI 入口，支持欢迎信息、版本输出、帮助信息和未知命令处理。
- `run <task>` 命令会创建 agent session，输出 plan/todo、工具进度和结构化 final summary。
- 核心运行时记录 plan、todo、tool_call、tool_result、approval、diff、protection、context、verification、summary 等 trace 事件。
- workspace 工具支持 list/read/write，写入时保留 diff metadata，并保护任务开始前的 git dirty 文件。
- command 工具会捕获 stdout/stderr/exit code，默认拒绝 destructive command，并把验证结果纳入 summary evidence。
- `search_text` 支持搜索优先的上下文发现。
- micro-benchmark harness 覆盖本地运行、安全边界和上下文管理场景。

## 架构

当前模块布局和增长路径见 [docs/architecture.md](docs/architecture.md)。

## Claude Code 对齐原则

ForgeCode 的核心目标是对标 Claude Code 的工程设计和使用体验。具体原则见 [docs/claude-code-alignment.md](docs/claude-code-alignment.md)。

## 路线图

版本规划和 benchmark 策略见 [docs/roadmap.md](docs/roadmap.md)。

## v0.1 验收

v0.1 的完成标准见 [docs/v0.1-acceptance.md](docs/v0.1-acceptance.md)。

## v0.2 验收

v0.2 的完成标准见 [docs/v0.2-acceptance.md](docs/v0.2-acceptance.md)。

## 版本分享说明

按版本整理的分享说明文档见 [docs/release-shares/](docs/release-shares/)。每个版本使用独立目录，包含总览、机制说明等文档。
