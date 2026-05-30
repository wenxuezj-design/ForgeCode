# ForgeCode 路线图

ForgeCode 不是 Claude Code 的 1:1 克隆。项目目标是从第一性原理出发，实现一个 Claude Code-style 的 coding agent，然后通过固定任务和行业 benchmark 对比它的真实表现。

## 产品定义

ForgeCode 应该逐步成长为一个本地 coding agent，能够：

- 理解开发任务。
- 读取并总结项目上下文。
- 形成简短、可执行的计划。
- 使用工具搜索代码、编辑文件、运行命令。
- 根据失败输出修正下一步行动。
- 报告修改内容和验证证据。
- 尊重安全边界，例如 destructive 操作确认和用户已有修改保护。

这意味着我们评估的不只是底层模型能力，还包括 agent loop、工具 scaffold、上下文管理、失败恢复和验证闭环。

## 评估原则

benchmark 结果必须记录足够上下文，否则无法解释：

- 任务集和精确仓库版本。
- 使用的模型和模型参数。
- 工具权限，以及是否允许联网。
- 时间、token 和命令预算。
- 完整 action trace。
- 用于验证的测试或命令。
- 最终 patch 是否能干净应用。

如果要和 Claude Code-style 工具对比，必须尽量控制这些变量。否则结果很可能只是在比较模型强弱或运行环境差异。

## 版本计划

### v0.1：本地 Agent Loop

目标：证明最小真实 coding loop 能在本地仓库中跑通。

实施计划：[v0.1 本地 Agent Loop](superpowers/plans/2026-05-30-v0-1-local-agent-loop.md)。

必需能力：

- 通过 `forgecode run <task>` 接收任务。
- 检查文件并搜索代码。
- 生成简短计划。
- 应用范围克制的文件修改。
- 运行验证命令。
- 根据命令失败输出修正 patch。
- 输出包含验证证据的最终结果摘要。

benchmark 目标：

- 通过 ForgeCode 自建 micro-benchmark 套件，初期包含 10-20 个小任务。

示例任务：

- 根据现有代码更新 README。
- 修复失败单元测试。
- 增加一个小 CLI 命令。
- 拆分一个小模块。
- 调试运行时报错。
- 增加一个跨文件小功能并补测试。

### v0.2：终端任务 Benchmark

目标：评估 ForgeCode 是否能作为终端 coding agent 完成外部任务。

必需能力：

- 在干净 benchmark workspace 中运行。
- 捕获每次工具调用的结构化 trace。
- 强制执行命令和时间预算。
- 将 benchmark 结果导出为机器可读 JSON。

benchmark 目标：

- 跑通一个 Terminal-Bench 或 CCBench-style 子集。

成功指标：

- 任务完成率。
- 验证通过率。
- 命令次数和重试次数。
- 失败类别分布。

### v0.3：多语言真实仓库修复

目标：在小型 repo 之外，测试 ForgeCode 处理真实 issue-fixing 任务的能力。

必需能力：

- 处理更大的仓库上下文。
- 在不读取全部文件的情况下选择相关文件。
- 保持 patch 小而聚焦。
- 运行项目特定测试。
- 在依赖安装或测试失败时恢复。

benchmark 目标：

- 跑 Multi-SWE-bench 的 JavaScript/TypeScript 子集。

成功指标：

- resolved rate。
- patch apply rate。
- test pass rate。
- 单任务平均成本和耗时。

### v1.0：可行业对比的 Coding Agent

目标：形成可以和其他 coding agent 对比的评估设置。

必需能力：

- 稳定工具协议。
- 可配置模型 provider。
- 强 workspace 安全规则。
- 可复现 benchmark runner。
- trace 查看器或 trace 导出。

benchmark 目标：

- 跑 SWE-bench Verified。

成功指标：

- resolved rate。
- verified test pass rate。
- 成本和耗时。
- 人工介入次数。

## 早期非目标

- Claude Code UI 1:1 对齐。
- IDE 集成。
- 多 agent 编排。
- 长期记忆。
- MCP 支持。
- 自动创建 PR。
- 广泛 provider 支持。

这些能力可以在本地 agent loop 和 benchmark harness 稳定之后再加入。
