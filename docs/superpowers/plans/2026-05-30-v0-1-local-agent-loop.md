# v0.1 本地 Agent Loop 实施计划

> **给 agentic worker 的要求：**实现本计划时，必须逐项执行任务，并在每个任务完成后运行对应验证命令。建议使用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans`。

**目标：**实现 ForgeCode 的第一个真实 coding loop：接收本地任务、检查文件、制定计划、编辑文件、运行验证、在失败时修正，并输出带证据的结果。

**架构：**CLI 保持很薄，核心行为放到 `src/core/run-task.ts`。agent loop 通过明确边界协作：`workspace` 负责安全文件访问，`tools` 负责可调用动作，`providers` 负责模型式决策，`agent` 负责 session 和 trace，`benchmarks` 负责 v0.1 可重复评测。

**技术栈：**TypeScript、Node.js 内置 test runner、Node 文件系统和进程 API、现有 `tsc` 构建。

---

## 文件结构

- 新增 `src/agent/trace.ts`：结构化 trace 事件和 recorder。
- 修改 `src/agent/session.ts`：让 session 持有 trace。
- 新增 `src/workspace/path-policy.ts`：阻止访问 workspace root 外的路径。
- 修改 `src/workspace/workspace.ts`：暴露安全路径解析能力。
- 新增 `src/tools/workspace-tools.ts`：实现 `list_files`、`read_file`、`write_file`。
- 新增 `src/tools/command-tool.ts`：运行验证命令并捕获 stdout、stderr、exit code。
- 修改 `src/tools/registry.ts`：增加重复注册校验和 `execute()`。
- 新增 `src/providers/scripted-provider.ts`：用于测试和早期 benchmark 的确定性 provider。
- 新增 `src/core/run-task.ts`：本地 agent loop 编排。
- 修改 `src/app.ts`：将 `forgecode run <task>` 接到 `runTask()`。
- 新增 `benchmarks/micro/tasks.json`：v0.1 micro-benchmark 任务定义。
- 新增 `src/benchmarks/micro-runner.ts`：加载并运行 micro-benchmark。
- 修改 `README.md` 和 `docs/roadmap.md`：记录 v0.1 行为和 benchmark 命令。
- 新增测试：覆盖 trace、workspace tools、tool registry、provider、run-task、micro-runner。

---

## Task 1：结构化 Agent Trace

**目标：**让每次 plan、tool call、tool result、verification、final 都能进入有序 trace。

**文件：**

- 新增：`src/agent/trace.ts`
- 修改：`src/agent/session.ts`
- 新增测试：`tests/trace.test.ts`

**步骤：**

1. 先写失败测试：`createTraceRecorder()` 能记录带 timestamp 的事件；`createAgentSession()` 返回的 session 持有 `trace`。
2. 运行 `npm test`，期望失败：`trace.js` 不存在或 `session.trace` 不存在。
3. 实现 `TraceEventType`、`TraceEvent`、`TraceRecorder` 和 `createTraceRecorder()`。
4. 修改 `createAgentSession()`，初始化 `trace: createTraceRecorder()`。
5. 从 `src/index.ts` 导出 trace API 和类型。
6. 运行 `npm test`，期望全部通过。

**验收：**

- trace 事件保持记录顺序。
- 每条 trace 都有 timestamp。
- session 能同时保留原有 `events` 和新的 `trace`。

---

## Task 2：Workspace Path Policy 和文件工具

**目标：**提供安全的 workspace 文件访问能力，禁止越出 workspace root。

**文件：**

- 新增：`src/workspace/path-policy.ts`
- 修改：`src/workspace/workspace.ts`
- 新增：`src/tools/workspace-tools.ts`
- 新增测试：`tests/workspace-tools.test.ts`

**步骤：**

1. 先写失败测试：在临时目录中创建 README，验证 `list_files`、`read_file`、`write_file` 能工作。
2. 增加越权路径测试：`../secret.txt` 必须抛出包含 `outside the workspace` 的错误。
3. 运行 `npm test`，期望失败：workspace tools 和 path policy 尚未实现。
4. 实现 `resolveInsideRoot(rootPath, requestedPath)`。
5. 修改 `Workspace`，增加 `resolvePath(requestedPath)`。
6. 实现 `createWorkspaceTools(workspace)`，返回 `listFiles`、`readFile`、`writeFile` 三个 tool。
7. 从 `src/index.ts` 导出 workspace tools 和 path policy。
8. 运行 `npm test`，期望全部通过。

**验收：**

- 只能读取和写入 workspace root 内的文件。
- 文件工具实现统一的 `Tool` 接口。
- 越权路径不会被 resolve 到 root 外。

---

## Task 3：Tool Registry 执行能力和 Command Tool

**目标：**让工具注册表能执行工具，并增加一个可捕获命令输出的 `run_command` 工具。

**文件：**

- 修改：`src/tools/registry.ts`
- 新增：`src/tools/command-tool.ts`
- 新增测试：`tests/tools.test.ts`

**步骤：**

1. 先写失败测试：重复注册同名 tool 应抛错；`registry.execute(name, input)` 应执行对应 tool。
2. 写 command tool 测试：执行 `node --version`，结果中包含 `exitCode=0` 和 `stdout=v...`。
3. 运行 `npm test`，期望失败：`execute()` 和 command tool 尚未实现。
4. 修改 `ToolRegistry`，增加 `execute(name, input): Promise<ToolResult>`。
5. 在 `register()` 中拒绝重复 tool name。
6. 实现 `createCommandTool({ cwd })`，使用 `spawn(command, args, { cwd, shell: false })`。
7. command tool 输出格式固定为：

```text
exitCode=<number>
stdout=<trimmed stdout>
stderr=<trimmed stderr>
```

8. 从 `src/index.ts` 导出 command tool。
9. 运行 `npm test`，期望全部通过。

**验收：**

- tool name 唯一。
- 未知 tool 执行时抛出 `Unknown tool`。
- 命令输出可被后续 agent loop 记录和分析。

---

## Task 4：确定性 Provider 协议

**目标：**在真实模型接入前，用 scripted provider 驱动测试和 benchmark，避免 v0.1 被模型不确定性拖住。

**文件：**

- 修改：`src/providers/model-provider.ts`
- 新增：`src/providers/scripted-provider.ts`
- 新增测试：`tests/provider.test.ts`

**步骤：**

1. 先写失败测试：`createScriptedProvider([...actions])` 应按顺序返回 `plan`、`tool`、`final`。
2. 运行 `npm test`，期望失败：`scripted-provider` 和 `AgentAction` 类型尚未实现。
3. 在 `model-provider.ts` 中定义：
   - `AgentAction`
   - `AgentActionContext`
   - `ModelProvider.nextAction(context)`
4. 保留现有 `complete(messages)`，方便后续真实模型 provider 接入。
5. 实现 `createScriptedProvider(actions)`，每次调用 `nextAction()` 弹出一个 action。
6. action 队列耗尽时返回 `{ kind: "final", content: "Script complete." }`。
7. 从 `src/index.ts` 导出 scripted provider 和 action 类型。
8. 运行 `npm test`，期望全部通过。

**验收：**

- provider 决策与 agent loop 解耦。
- 测试不依赖真实 LLM。
- 之后接入 OpenAI/Anthropic provider 时不需要改 core loop。

---

## Task 5：核心 Run-Task Agent Loop

**目标：**实现 v0.1 的最小 agent loop：读取 provider action，记录 trace，调用工具，直到 final。

**文件：**

- 新增：`src/core/run-task.ts`
- 修改：`src/app.ts`
- 修改：`src/cli.ts`
- 新增测试：`tests/run-task.test.ts`
- 修改测试：`tests/app.test.ts`

**步骤：**

1. 先写失败测试：用临时 workspace、workspace tools 和 scripted provider 完成“读取 README -> 写入 README -> final”流程。
2. 运行 `npm test`，期望失败：`run-task.js` 不存在。
3. 实现 `runTask(options)`：
   - 创建 `AgentSession`。
   - 最多执行 `maxSteps ?? 20` 步。
   - `plan` action 记录 `trace.type = "plan"`。
   - `tool` action 记录 `tool_call`，执行 `tools.execute()`，再记录 `tool_result`。
   - `final` action 记录 `final` 并返回 `{ exitCode: 0, summary, trace }`。
   - 超过步数返回 `{ exitCode: 1, summary: "Stopped after ...", trace }`。
4. 从 `src/index.ts` 导出 `runTask` 和相关类型。
5. 将 `runCli()` 改成 async；`src/cli.ts` 使用 `await runCli(...)`。
6. 在 `src/app.ts` 的 `run` 分支中创建 workspace、tool registry、workspace tools、command tool、stub provider，并调用 `runTask()`。
7. 更新 `tests/app.test.ts`，所有 `runCli()` 调用统一 `await`。
8. 运行 `npm test`，期望全部通过。

**验收：**

- `runTask()` 能完成确定性 coding loop。
- trace 中能看到 plan、tool_call、tool_result、final。
- CLI 的 `forgecode run <task>` 不再只是 session stub，而是进入 core loop。

---

## Task 6：验证失败 Trace

**目标：**确保验证命令失败时，stdout/stderr/exitCode 会进入 trace，provider 后续可以基于失败信息修正。

**文件：**

- 修改：`src/core/run-task.ts`
- 修改测试：`tests/run-task.test.ts`

**步骤：**

1. 写测试：注册一个假的 `run_command` tool，返回：

```text
exitCode=1
stdout=
stderr=test failed
```

2. scripted provider 先调用 `run_command`，再返回 final。
3. 断言 `result.trace.events` 中包含 `stderr=test failed`。
4. 如果 Task 5 已经记录完整 tool result，这个测试应直接通过；否则修复 `runTask()`。
5. 运行 `npm test`，期望全部通过。

**验收：**

- 失败验证命令的完整输出进入 trace。
- 最终 summary 之外，trace 也保留可机器分析的证据。

---

## Task 7：v0.1 Micro-Benchmark Harness

**目标：**提供最小 benchmark harness，为 v0.1 的“能跑通本地 coding loop”建立可重复评测入口。

**文件：**

- 新增：`benchmarks/micro/tasks.json`
- 新增：`src/benchmarks/micro-runner.ts`
- 修改：`package.json`
- 新增测试：`tests/micro-runner.test.ts`

**步骤：**

1. 先写失败测试：`runMicroBenchmarkTask()` 在临时 workspace 中运行验证命令，并返回 `{ id, passed, verificationOutput }`。
2. 运行 `npm test`，期望失败：`micro-runner` 不存在。
3. 新增 `benchmarks/micro/tasks.json`，先放一个 `readme-smoke` 任务。
4. 实现 `runMicroBenchmarkTask(task)`：
   - 使用 `createCommandTool({ cwd: task.workspaceRoot })`。
   - 运行 `task.verification.command` 和 `task.verification.args`。
   - `verificationOutput` 保存 command tool 输出。
   - `passed` 通过输出是否包含 `exitCode=0` 判断。
5. 在 `package.json` 中新增：

```json
"bench:micro": "npm run build --silent && node dist/benchmarks/micro-runner.js"
```

6. 运行 `npm test`，期望全部通过。

**验收：**

- micro-benchmark task 能被单独执行。
- benchmark 结果包含任务 id、是否通过、验证输出。
- 后续可以扩展到 10-20 个 v0.1 任务。

---

## Task 8：文档和 v0.1 验收清单

**目标：**明确 v0.1 什么时候算完成。

**文件：**

- 修改：`README.md`
- 修改：`docs/roadmap.md`
- 新增：`docs/v0.1-acceptance.md`

**步骤：**

1. 新增 `docs/v0.1-acceptance.md`，内容包括：
   - `forgecode run <task>` 能运行本地 agent loop。
   - loop 能通过 workspace tools 检查文件。
   - loop 能在 workspace 内写入范围受限的文件修改。
   - loop 能运行验证命令。
   - 失败验证输出被记录进 trace。
   - 最终输出包含 summary 和验证证据。
   - micro-benchmark harness 至少能运行一个任务。
   - `npm test`、`npm run typecheck`、`npm run build`、`npm run bench:micro` 通过。
2. 从 `README.md` 和 `docs/roadmap.md` 链接到验收清单。
3. 运行：

```bash
npm test
npm run typecheck
npm run build
```

4. 实现 benchmark runner 后，再运行：

```bash
npm run bench:micro
```

**验收：**

- 中文文档能解释 v0.1 范围。
- 验收标准和路线图一致。
- 用户能从 README 找到路线图、架构和 v0.1 验收清单。

---

## 自检

- 覆盖范围：计划覆盖 v0.1 路线图中的全部要求，包括任务输入、文件检查、计划、文件编辑、验证命令、失败 trace、最终 summary 和 micro-benchmark。
- 占位检查：每个任务都包含明确文件、测试、命令和验收点。
- 类型一致性：`TraceRecorder`、`ToolRegistry.execute`、`AgentAction`、`ModelProvider.nextAction` 和 `runTask` 都先定义再使用。
