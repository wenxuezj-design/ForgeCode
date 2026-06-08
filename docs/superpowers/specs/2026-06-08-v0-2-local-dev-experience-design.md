# v0.2 本地开发体验设计

## 背景

ForgeCode v0.1 已经证明最小本地 agent loop 成立：CLI 能接收任务，provider 能产出 action，runtime 能调用工具，trace 能记录 plan、tool call、tool result 和 final，micro-benchmark 能跑基础 smoke task。

v0.2 的目标不是扩大模型能力，也不是先追求更多 benchmark 分数，而是在 v0.1 loop 之上补齐 Claude Code-style 的本地开发体验、安全边界和上下文管理。v0.2 完成后，ForgeCode 应该开始像一个可靠的终端 coding partner：先展示计划，执行时展示进度，修改前尊重用户已有变更，高风险命令需要确认，修改内容能看 diff，最终总结能给出验证证据和剩余风险。

本设计遵守：

- `docs/roadmap.md` 中的 v0.2 版本计划。
- `docs/claude-code-alignment.md` 中的交互模式、工具模型、workspace 安全、上下文管理和验证闭环原则。
- v0.1 已建立的 TypeScript CLI、runtime、tools、workspace、provider、trace、micro-benchmark 模块边界。

## 目标

v0.2 必须提供以下能力：

1. planning/todo 展示。
2. tool call 的可读进度输出。
3. git dirty check 和用户已有修改保护。
4. destructive command 权限确认。
5. patch/diff 展示。
6. 搜索优先的上下文选择策略，避免全仓暴力读取。
7. final summary 包含修改、验证、失败证据和剩余风险。
8. micro-benchmark 扩展到 10 个以上任务，并覆盖交互、安全和上下文管理检查项。

## 非目标

v0.2 不实现以下能力：

- 不接入真实远程模型 provider。
- 不做长上下文压缩算法。
- 不做交互式全屏 UI。
- 不实现外部 benchmark 子集，例如 SWE-bench、Terminal-Bench 或 CCBench。
- 不实现跨 workspace 的文件操作。
- 不默认执行 destructive command。
- 不把 CLI 输出作为唯一事实来源；机器可分析事实仍然以 trace 和结构化结果为准。

## 推荐路径

采用 runtime-first 路径：先扩展核心 runtime 和工具边界，再让 CLI 渲染它们。

原因：

- v0.2 的核心风险在安全边界和可验证事实，不在输出文案。
- trace、tool result、workspace guard、command approval、diff metadata 都需要先成为结构化数据，CLI 才能稳定展示。
- benchmark 需要测 runtime 行为；如果只改 CLI 字符串，benchmark 无法可靠判断 dirty 保护、权限确认和 summary 证据完整性。

不采用 CLI-first 作为主路径。CLI-first 可以更快展示 planning/todo 和进度，但容易把 v0.2 做成字符串包装。

不采用 benchmark-first 作为主路径。benchmark 会在每个能力落地后同步扩展，但不能先于 runtime 结构存在。

## 架构

v0.2 保持现有模块分工，并增加几个小的边界：

- `src/core/run-task.ts`：继续负责 agent loop，同时支持执行事件回调和结构化运行摘要。
- `src/agent/trace.ts`：扩展 trace event 类型，记录 todo、approval、diff、verification 和 summary 证据。
- `src/tools/registry.ts`：工具结果从纯文本扩展为可携带 metadata 的结构化结果。
- `src/tools/workspace-tools.ts`：写文件工具在写入前做用户修改保护，并返回 diff metadata。
- `src/tools/command-tool.ts`：命令工具识别 destructive command，未获批准时拒绝执行并返回 approval metadata。
- `src/tools/search-tool.ts`：新增搜索工具，用于搜索优先的上下文发现。
- `src/workspace/git-state.ts`：封装 git dirty check、文件状态查询和 diff 生成。
- `src/core/run-summary.ts`：从 trace 和 tool metadata 生成 final summary 证据结构。
- `src/app.ts`：CLI 保持薄层，只把 runtime 事件和 summary 渲染为可读输出。
- `src/benchmarks/micro-runner.ts`：扩展 benchmark task 类型，支持检查 trace 事件、summary 字段和安全行为。

设计原则：

- runtime 产生事实，CLI 渲染事实。
- 工具通过 metadata 报告风险、修改、验证和 diff。
- trace 记录足够数据供测试和 benchmark 分析。
- 用户已有修改保护发生在写入前，而不是写入后补救。
- destructive command 默认拒绝，除非显式配置允许。

## 运行事件

`runTask` 新增可选 `onEvent` 回调，用于 CLI 进度输出和测试观察。事件不替代 trace；事件是实时输出通道，trace 是持久事实记录。

事件类型：

- `plan_started`：provider 产生 plan action。
- `todo_updated`：runtime 从 plan 中生成或更新 todo 列表。
- `tool_started`：工具调用开始，包含工具名和简短输入摘要。
- `tool_finished`：工具调用结束，包含工具名、成功状态和结果摘要。
- `approval_required`：工具需要用户批准但当前策略未批准。
- `diff_available`：文件修改产生 diff。
- `verification_result`：验证命令执行结束。
- `final_summary`：运行结束时生成结构化总结。

事件 payload 保持小而稳定，完整内容保留在 trace 和 tool result metadata 中。

## Trace 扩展

现有 trace 类型为 `plan`、`tool_call`、`tool_result`、`verification`、`final`。v0.2 保留这些类型，并扩展为：

- `todo`：记录 todo 列表的当前状态。
- `approval`：记录命令或工具需要权限确认，以及最终策略结果。
- `diff`：记录文件修改摘要和 diff。
- `protection`：记录用户已有修改保护、越权路径拒绝或写入前保护结果。
- `context`：记录上下文选择行为，例如搜索 query、命中文件、读取原因。
- `summary`：记录 runtime 生成的最终证据结构。

每条 trace event 继续包含 `message` 和 `timestamp`，同时新增可选 `metadata`。metadata 必须是 JSON-serializable object，便于 benchmark 检查。

## Planning 和 Todo 展示

v0.2 不要求模型自然地产生完美 todo。runtime 提供一个轻量 todo model：

- 当 provider 返回 `plan` action 时，runtime 把 plan 内容记录为 plan event。
- 如果 plan 内容包含多行步骤，runtime 将非空行转换为 pending todo。
- 如果 plan 只是单句，runtime 创建一个 pending todo，内容就是该 plan。
- 工具执行开始时，runtime 可以把当前 todo 标记为 in_progress。
- final 前，runtime 将未完成 todo 保留为 remaining work，进入 summary 的剩余风险。

CLI 输出示例：

```text
Plan:
- Read relevant files
- Update README
- Run npm test

Progress:
- read_file README.md
- write_file README.md
- run_command npm test
```

Todo 是用户可读进度，不作为复杂任务调度器。v0.2 不实现手动 todo 编辑。

## Tool Call 进度输出

工具调用开始和结束都会产生事件：

- 开始：`tool_started`，显示工具名和输入摘要。
- 成功：`tool_finished`，显示结果摘要。
- 失败：`tool_finished`，显示错误摘要，并让 provider 在下一步看到失败 trace。

CLI 不打印完整文件内容或完整 stdout，避免输出被大内容淹没。完整内容保留在 trace metadata 或 tool result content 中。

## Git Dirty Check

任务开始时，runtime 调用 git state boundary：

- 如果当前 workspace 不是 git 仓库，记录 `git.available=false`，继续运行，但 dirty 保护只基于文件存在性和写入前内容比较。
- 如果是 git 仓库，执行 `git status --porcelain`。
- 如果工作区 dirty，runtime 不直接失败。它记录 dirty 文件列表，并启用用户已有修改保护。

dirty check 的目的不是禁止所有任务，而是让写入工具能判断目标文件是否可能覆盖用户修改。

## 用户已有修改保护

写文件前，workspace write guard 按以下规则判断：

1. 解析目标路径，确保仍在 workspace 内。
2. 读取目标文件当前内容；如果文件不存在，允许创建。
3. 查询目标文件 git status。
4. 如果目标文件在任务开始时已经 dirty，默认拒绝覆盖。
5. 如果目标文件在任务运行中由 ForgeCode 写过，再次写入允许。
6. 拒绝时返回结构化 tool result：`success=false`、`blockedByUserChanges=true`、`path`、`reason`。
7. trace 记录 protection 事件，final summary 报告未修改原因。

v0.2 不尝试自动 merge 用户已有修改。后续版本可以加 patch apply 和冲突提示。

## Destructive Command 权限确认

`run_command` 增加风险分类：

- `safe`：默认允许，例如 `npm test`、`npm run typecheck`、`npm run build`、`node --version`。
- `destructive`：默认拒绝，例如 `rm`、`git reset`、`git checkout --`、`git clean`、`mv` 覆盖目标、带 `--force` 的命令。
- `unknown`：默认允许或拒绝由运行策略决定。v0.2 默认允许常规命令，但记录风险为 unknown。

v0.2 的确认策略是非交互式的：

- `approvalPolicy: "never"`：destructive command 拒绝执行。这是默认策略。
- `approvalPolicy: "allow-safe"`：safe 自动执行，destructive 拒绝。
- `approvalPolicy: "allow-all"`：测试专用，允许 destructive command，并在 trace 中记录批准来源。

当 destructive command 被拒绝时，runtime 产生 `approval_required` 事件和 `approval` trace。final summary 必须说明命令未执行及原因。

## Patch/Diff 展示

`write_file` 成功写入后返回：

- 修改路径。
- 修改类型：created、updated。
- unified diff。
- 行数变化摘要。

diff 来源：

- 对已有文件，用写入前内容和写入后内容生成 unified diff。
- 对新文件，diff 显示新增文件内容。
- 对二进制文件，v0.2 不支持写入；write tool 只处理 UTF-8 文本。

CLI 展示短 diff。trace metadata 保留完整 diff，benchmark 可以检查 `diff` event 是否存在。

## 搜索优先上下文策略

新增 `search_text` 工具：

- 输入：`query`、可选 `include` glob、可选 `maxResults`。
- 输出：匹配文件、行号、行内容摘要。
- 默认跳过 `node_modules`、`dist`、`.git`、`.worktrees`、`coverage`。

上下文策略规则：

- provider 应优先使用 `search_text` 或目录级 `list_files` 找相关文件。
- `read_file` 的 trace metadata 记录读取原因，如果来自搜索命中，则记录 query。
- benchmark 增加任务检查：在需要定位文件时，trace 中应先出现 `context` 或 `search_text`，再出现 `read_file`。

v0.2 不阻止所有直接 `read_file`，因为小仓库中读取 README 或 package.json 是合理行为。限制目标是避免全仓暴力读取。

## Final Summary

runtime 在 provider final 之外生成结构化 summary evidence：

- `task`：用户任务。
- `modifiedFiles`：修改或创建的文件。
- `verification`：验证命令、exit code、是否通过、失败输出摘要。
- `blockedActions`：被 dirty 保护或 approval policy 阻止的动作。
- `remainingRisks`：未验证部分、未完成 todo、失败命令或被拒绝动作。
- `traceEventCount`：trace 事件数量。

CLI 最终输出固定包含：

```text
Summary:
- Changes: ...
- Verification: ...
- Blocked: ...
- Risks: ...
```

如果 provider final 内容缺少证据，runtime summary 仍然补齐这些字段。

## Benchmark 扩展

micro-benchmark 从 3 个 smoke task 扩到至少 10 个任务。新增任务覆盖：

1. 测试套件 smoke。
2. typecheck smoke。
3. build smoke。
4. plan/todo trace 完整性。
5. tool call progress trace 完整性。
6. write_file diff 生成。
7. dirty 文件保护。
8. destructive command 拒绝。
9. verification result 进入 summary。
10. 搜索优先上下文选择。

benchmark runner 支持每个任务声明期望：

- 必须出现的 trace event 类型。
- 必须包含的 summary 字段。
- 必须拒绝的 command。
- 必须保护的 dirty file。
- 必须通过的 verification command。

v0.2 benchmark 仍使用 deterministic/scripted provider，避免模型随机性影响 runtime 行为验证。

## 测试策略

新增和修改测试应覆盖：

- `runTask` 发送实时事件，并保留 trace。
- plan action 生成 todo trace。
- tool call 产生 started/finished 事件。
- `write_file` 对干净文件生成 diff。
- `write_file` 拒绝覆盖任务开始前已经 dirty 的文件。
- `run_command` 默认拒绝 destructive command。
- verification command 结构化进入 summary。
- `search_text` 跳过构建目录并返回匹配行。
- CLI 输出包含 plan、progress、diff、summary。
- micro-benchmark 能检查 trace 和 summary 结构。

验证命令：

```bash
npm test
npm run typecheck
npm run bench:micro
```

## 版本验收

v0.2 完成时必须满足：

- `forgecode run <task>` 输出 plan/todo、tool progress 和结构化 final summary。
- 工具调用 trace 完整记录 plan、tool_call、tool_result、todo、approval、diff、protection、context、summary 中适用的事件。
- dirty 文件不会被默认覆盖。
- destructive command 不会被默认执行。
- 文件写入后能展示 diff。
- 上下文发现支持搜索优先路径。
- final summary 包含修改、验证、失败证据和剩余风险。
- micro-benchmark 至少包含 10 个任务，并覆盖交互、安全和上下文管理。
- `npm test`、`npm run typecheck`、`npm run bench:micro` 通过。

## 风险和取舍

- 非交互式 approval 会让部分任务在 v0.2 被拒绝，而不是提示用户现场确认。这是有意取舍：先保证 destructive command 不会默认执行。
- dirty 保护默认拒绝覆盖用户已有修改，可能比真实 coding partner 更保守。这有利于建立安全基线。
- 搜索优先策略在小仓库里可能显得多一步，但它为后续大仓上下文管理打基础。
- runtime summary 可能和 provider final 有重复。v0.2 接受少量重复，优先保证证据完整。
- trace metadata 扩展会影响测试断言。实施时需要保持旧 trace type 兼容，避免破坏 v0.1 行为。

## 实施顺序建议

1. 扩展 trace 和 tool result metadata。
2. 给 `runTask` 增加 `onEvent` 和 runtime summary。
3. 实现 planning/todo 事件。
4. 实现 command risk classification 和 approval policy。
5. 实现 git state boundary 和 write_file dirty 保护。
6. 实现 write_file diff metadata 和 CLI diff 展示。
7. 实现 `search_text` 和 context trace。
8. 扩展 CLI 输出。
9. 扩展 micro-benchmark task schema 和任务集。
10. 更新 README、roadmap 和 v0.2 验收文档。
