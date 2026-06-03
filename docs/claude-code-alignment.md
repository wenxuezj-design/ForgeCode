# Claude Code 对齐原则

ForgeCode 的核心目标不是泛化地做一个 coding agent，也不是只复刻 Claude Code 的表层功能。ForgeCode 要对标 Claude Code 的工程设计、使用体验和能力边界，在合法、可解释、可验证的前提下，从零实现一个独立的 Claude Code-style coding agent。

## 北极星

ForgeCode 1.0 应该做到：

- 使用体验接近 Claude Code：用户用自然语言描述开发任务，agent 在终端中理解、计划、执行、验证和总结。
- 工程边界接近 Claude Code-style agent：工具调用、workspace 安全、上下文管理、失败恢复、验证闭环都必须是显式设计，而不是临时拼接。
- 效果可以对比 Claude Code：同一任务、同一仓库、同样预算下，可以比较成功率、验证通过率、命令次数、耗时、patch 质量和 trace。

如果某个实现虽然能完成类似功能，但交互模式、工具边界或执行循环与 Claude Code-style agent 差异巨大，就应视为偏离目标，除非文档中写清楚差异原因。

## Clean-Room 原则

Claude Code 官方有公开产品文档和可观察的 CLI 行为，但它不是普通意义上的开源项目。因此 ForgeCode 必须遵守 clean-room reference 原则。

可以参考：

- Claude Code 官方公开文档。
- Claude Code 的公开 CLI 行为和交互体验。
- 实际使用 Claude Code 时观察到的工具调用、权限提示、计划方式、验证方式和输出习惯。
- 公开 benchmark 中 Claude Code-style agent 的任务表现。
- 通用 agent 工程模式，例如工具注册、trace、权限、上下文摘要、验证循环。

不可以参考：

- 泄露源码。
- 未授权反编译结果。
- 直接复制 Claude Code 的私有实现、内部命名或代码结构。
- 任何来源不清、授权不明的代码片段。

允许分析公开行为，但不照搬私有实现。ForgeCode 的代码必须是独立实现。

## 1.0 对齐维度

### 交互模式

ForgeCode 应该像一个终端中的 coding partner：

- 用户输入自然语言任务。
- agent 先说明理解和计划。
- 执行工具时给出可读进度。
- 完成后报告修改、验证和剩余风险。

内部可以保留结构化 trace，但用户界面不能退化成只有 JSON 的 benchmark runner。

### 工具模型

所有外部动作都必须通过显式工具边界完成：

- 文件读取。
- 文件搜索。
- 文件编辑。
- 命令运行。
- 测试和验证。
- git 状态检查。

工具调用必须能被 trace 记录，便于调试和 benchmark 分析。

### 执行循环

ForgeCode 不应是“一次性生成 patch”的工具。核心循环应是：

```text
理解任务 -> 读取上下文 -> 制定计划 -> 调用工具 -> 观察结果 -> 修正计划 -> 修改代码 -> 运行验证 -> 总结
```

失败输出必须进入上下文，让下一步行动能基于事实修正。

### Workspace 安全

ForgeCode 必须尊重本地 workspace 边界：

- 默认只操作当前 workspace。
- 禁止越权路径访问。
- destructive 操作必须确认。
- 不能覆盖用户已有修改而不提示。
- 不能默认执行高风险命令。

### 上下文管理

ForgeCode 不能把整个仓库粗暴塞进上下文。它应该逐步具备：

- 文件选择策略。
- 搜索优先的上下文发现。
- 关键文件摘要。
- 长任务中的上下文压缩。
- 保留任务目标、计划、已执行工具、验证结果和失败原因。

### 验证闭环

最终回答不能只说“完成了”。必须包含：

- 改了什么。
- 跑了哪些命令。
- 命令结果如何。
- 是否还有未验证部分。
- 如果失败，失败证据是什么。

### Benchmark 对齐

ForgeCode 的效果需要用固定任务对比 Claude Code-style 工具：

- 同一 repo 初始状态。
- 同一任务描述。
- 同样是否允许联网。
- 同样命令、时间和 token 预算。
- 同样验证命令。
- 记录完整 action trace。

比较指标包括：

- 任务完成率。
- 验证通过率。
- patch apply rate。
- 命令次数。
- 平均耗时。
- 失败类别。
- patch 范围和质量。

## 偏离判断

以下情况应视为偏离 Claude Code 对齐目标：

- 只追求 benchmark 分数，牺牲本地开发体验。
- 只做聊天式回答，不形成工具驱动的执行循环。
- 工具调用不可追踪。
- 没有 workspace 安全策略。
- 不运行验证就声称完成。
- 上下文管理依赖全量读取或硬编码文件。
- patch 经常包含无关重构。
- 实现选择与 Claude Code-style 行为差异很大，但没有写明原因。

## 设计评审问题

后续每个核心模块设计前，都应该回答：

- Claude Code-style agent 在这个场景下大概率会暴露什么用户体验？
- 这个模块的工具边界是否清楚？
- 失败信息是否能进入下一轮决策？
- 用户能否理解 agent 正在做什么？
- benchmark runner 能否复现并分析这个行为？
- 如果和 Claude Code-style 行为不同，理由是什么？

这些问题的答案应该体现在设计文档、测试或 trace 中。
