# ForgeCode 路线图

ForgeCode 不是 Claude Code 的 1:1 克隆。项目目标是从第一性原理出发，实现一个 Claude Code-style 的 coding agent，然后通过固定任务和行业 benchmark 对比它的真实表现。

项目必须遵守 [Claude Code 对齐原则](claude-code-alignment.md)：不是单纯复刻功能，而是学习并独立实现 Claude Code-style 的工程边界、交互模式和验证方式。

## 第一性原理

这里的“第一性原理”不是一句口号。它表示我们不直接从“Claude Code 有哪些按钮或命令”开始，而是先拆解一个 coding agent 必须成立的基本事实：

- 用户有一个开发目标。
- agent 必须理解目标、约束和成功条件。
- agent 必须发现相关上下文，而不是全仓乱读。
- agent 必须通过显式工具执行外部动作。
- 文件修改必须可追踪、范围克制，并尊重用户已有修改。
- 验证结果必须进入下一轮决策。
- 最终结果必须能被复现、检查和 benchmark。

这些基本事实会指导 ForgeCode 的模块设计。Claude Code 是重要对标对象，但 ForgeCode 的实现路径应该从这些底层约束推导出来，而不是机械复制表层功能。

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

### v0.1：最小本地 Agent Loop

目标：证明可追踪、可验证的最小 coding loop 能在本地仓库中跑通。

实施计划：[v0.1 本地 Agent Loop](superpowers/plans/2026-05-30-v0-1-local-agent-loop.md)。

验收清单：[v0.1 验收清单](v0.1-acceptance.md)。

必需能力：

- 通过 `forgecode run <task>` 接收任务。
- 创建 agent session 和结构化 trace。
- 通过 workspace tools 读取和写入文件。
- 运行验证命令。
- 使用 deterministic provider 驱动测试和早期 benchmark。
- 执行 `runTask` loop，记录 plan、tool_call、tool_result、final。
- 输出包含验证证据的最终结果摘要。

benchmark 目标：

- 通过 ForgeCode 自建 micro-benchmark smoke suite，初期至少包含 3 个小任务。

示例任务：

- 读取 README 并总结项目目的。
- 修改一个小文件并运行验证命令。
- 捕获失败验证输出并写入 trace。

### v0.2：Claude Code-style 本地开发体验

目标：在最小 loop 之上补齐 Claude Code-style 的本地交互、安全边界和上下文管理，让 ForgeCode 不只是能跑 benchmark，也能像一个可靠的终端 coding partner。

实施计划：[v0.2 本地开发体验](superpowers/plans/2026-06-08-v0-2-local-dev-experience.md)。

验收清单：[v0.2 验收清单](v0.2-acceptance.md)。

必需能力：

- planning/todo 展示。
- tool call 的可读进度输出。
- git dirty check 和用户已有修改保护。
- destructive command 权限确认。
- patch/diff 展示。
- 搜索优先的上下文选择策略，避免全仓暴力读取。
- final summary 包含修改、验证、失败证据和剩余风险。

benchmark 目标：

- ForgeCode 自建 micro-benchmark 扩展到 10-20 个任务，并加入交互、安全、上下文管理检查项。

成功指标：

- 任务完成率。
- 验证通过率。
- 工具调用 trace 完整率。
- 用户已有修改保护通过率。
- 权限确认覆盖率。
- final summary 证据完整率。

### v0.3：可复现 Benchmark Runner 和外部任务集

目标：建立可复现 benchmark 基础设施，并开始在外部小任务集上评估 ForgeCode，而不是只依赖自建任务。

必需能力：

- 在干净 benchmark workspace 中运行。
- 导出机器可读 JSON 结果。
- 导出完整 action trace。
- 强制执行命令、时间和 token 预算。
- 记录 patch、验证命令和失败分类。
- 支持 Terminal-Bench 或 CCBench-style 子集。
- 尝试 Multi-SWE-bench JavaScript/TypeScript 小子集。

benchmark 目标：

- 跑通一个 Terminal-Bench 或 CCBench-style 子集。
- 探索 Multi-SWE-bench JavaScript/TypeScript 小子集。

成功指标：

- 任务完成率。
- 验证通过率。
- resolved rate。
- patch apply rate。
- 命令次数和重试次数。
- 单任务平均成本和耗时。
- 失败类别分布。

### v0.4：真实 Provider、成本预算和上下文预算

目标：接入真实模型 provider，并让每次 agent run 的成本、耗时和上下文占用都可观测、可限制。v0.4 不直接追求长上下文压缩，而是先建立后续上下文管理和 benchmark 对比所需的计量基础。

provider 策略：

- 实现 OpenAI-compatible Provider Adapter，而不是把第一版绑定到单一厂商。
- 以 DeepSeek 作为低成本真实 provider 的第一站，默认支持 `deepseek-chat`。
- 可选支持 `deepseek-reasoner`，用于复杂任务或 release 前验证。
- provider 配置应包含 base URL、model、API key 环境变量名、上下文窗口、价格参数和默认预算。
- 保留后续接入 OpenAI、Qwen、Moonshot、OpenRouter 等兼容 provider 的扩展点。

必需能力：

- 真实 provider 的 `ModelProvider` 实现。
- 每次 run 记录 model、provider、输入 token、输出 token、估算成本和耗时。
- 每个任务强制执行最大 model calls、最大 tokens、最大 wall time 和最大 estimated cost。
- 将 raw trace 和发送给模型的 model context 分离。
- 对大型 tool output、失败日志和 diff 做进入模型上下文前的截断或摘要。
- benchmark runner 输出 `cost_usd`、`input_tokens`、`output_tokens`、`duration_ms`、`model_calls`。

benchmark 目标：

- 默认 smoke suite 使用低成本模型运行，单次本地验证预算控制在很小范围内。
- nightly 或手动 benchmark 可以切换到 reasoner 模型，并记录成本差异。
- 记录不同 provider/model 在同一任务集上的完成率、验证通过率、成本和耗时。

成功指标：

- provider 配置可以无代码切换。
- 每个任务都有成本和 token 证据。
- 超预算任务会被明确中止并进入失败分类。
- 低成本 provider 能稳定跑完自建 micro-benchmark 和 v0.3 小型外部任务集。

### v0.5：Context Pack 和 Working Set Manager

目标：从“能搜索上下文”升级为“能维护当前任务的有效工作集”。v0.5 重点解决读什么、保留什么、为什么保留，而不是先做复杂压缩算法。

必需能力：

- 为每个任务维护 context pack，包含用户目标、约束、当前计划、未完成 todo、已读文件、修改中文件、验证结果和失败原因。
- 记录 search result -> read_file -> edit/verify 的上下文链路。
- 为已读文件生成短摘要，并缓存摘要与原文件版本的关系。
- 将关键证据分级：必须保留、可摘要、可丢弃。
- 避免全仓暴力读取，优先通过搜索、文件列表和已有 context pack 扩展工作集。

benchmark 目标：

- 增加需要跨文件定位、失败后回溯、重复读取文件的任务。
- 检查 context pack 是否保留了关键约束、失败验证和修改文件。

成功指标：

- 任务中后段仍能引用早期关键约束。
- 重复读取和无关读取下降。
- 失败修正时能利用此前验证输出和文件摘要。

### v0.6：长上下文压缩算法

目标：在 v0.4 的预算观测和 v0.5 的 context pack 基础上，实现长任务中的自动上下文压缩。v0.6 的核心不是丢弃历史，而是在 raw trace 完整保留的前提下，为模型构造更小但足够可靠的上下文。

必需能力：

- 当 model context 接近预算阈值时触发 compaction。
- 压缩旧 tool_result、搜索结果、长 diff、失败日志和已完成计划。
- 强保留不可丢信息：用户目标、约束、未完成 todo、已修改文件、验证结果、失败原因、blocked actions 和未解决风险。
- raw trace 完整保存，model context 使用压缩版。
- trace 中记录 compaction 事件、输入大小、输出大小、保留规则和潜在风险。

benchmark 目标：

- 增加长任务、多轮失败恢复、大输出验证和跨文件修改任务。
- 对比启用/禁用 compaction 的完成率、验证通过率、成本和失败类型。

成功指标：

- 超预算任务可以继续推进，而不是直接失败。
- 压缩后不丢失关键约束和失败证据。
- 相同任务在压缩开启后成本或上下文占用下降，且验证通过率不显著下降。

### v1.0：可行业对比的 Coding Agent

目标：形成可以和其他 coding agent 对比的评估设置。

必需能力：

- 稳定工具协议。
- 可配置模型 provider。
- 强 workspace 安全规则。
- 可复现 benchmark runner。
- 成熟的上下文预算、working set 和长上下文压缩机制。
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
- 广泛 provider 矩阵和 provider marketplace。

这些能力可以在本地 agent loop 和 benchmark harness 稳定之后再加入。
