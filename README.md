# ForgeCode

一个从第一性原理出发构建的开放式 coding agent。

ForgeCode 从一个小型 TypeScript CLI 开始，目标是逐步成长为一个 Claude Code-style 的本地编码智能体：核心清晰、工具接口明确、行为可测试、结果可评估。

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

- CLI 入口，支持欢迎信息和版本输出。
- `--help` 帮助信息和未知命令处理。
- `run <task>` 命令，目前会创建 agent session。
- 已建立核心运行时、agent session、工具、模型 provider、workspace 的模块边界。
- 核心模块可以不依赖 shell 单独测试。
- 后续会逐步加入 agent loop、工具调用、文件编辑、验证命令和 benchmark harness。

## 架构

当前模块布局和增长路径见 [docs/architecture.md](docs/architecture.md)。

## 路线图

版本规划和 benchmark 策略见 [docs/roadmap.md](docs/roadmap.md)。
