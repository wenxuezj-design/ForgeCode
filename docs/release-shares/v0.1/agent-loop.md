# Agent Loop核心运行机制

现在的 Agent Loop 核心很小，重点是把“任务 -> provider 决策 -> 工具执行 -> trace 记录 -> final”这条链路跑通。

入口在 `src/core/run-task.ts`

流程大概是：

```text
runTask({ task, provider, tools, workspace })
  -> createAgentSession(task)
  -> for step in maxSteps
      -> provider.nextAction({ task, events: trace.events })
      -> action.kind === "plan"
           record plan
      -> action.kind === "tool"
           record tool_call
           tools.execute(toolName, input)
           record tool_result
      -> action.kind === "final"
           record final
           return summary + trace
  -> 超过 maxSteps 后返回失败 summary
```

## 1. Session 和 Trace

每次任务会先创建一个 session：`src/agent/session.ts`

它保存：

- 原始 task
- 初始 `user_task` event
- 一个 trace recorder

trace recorder 在 `src/agent/trace.ts`，每次记录都会附加 timestamp。当前 trace 类型包括：

```text
plan
tool_call
tool_result
verification
final
```

实际 loop 目前主要写入 `plan/tool_call/tool_result/final`。

## 2. Provider 决定下一步

provider 协议在 `src/providers/model-provider.ts`。

`nextAction()` 只能返回三类 action：

```typescript
{ kind: "plan", content }
{ kind: "tool", toolName, input }
{ kind: "final", content }
```

当前 CLI 里用的是 stub provider，所以真实 `forgecode run` 现在基本会直接 final：

```text
No provider actions configured.
```

测试里用 `scripted-provider.ts` 来模拟多步 action，这样可以稳定验证 agent loop。

## 3. Tool Registry 执行工具

工具注册表在 `src/tools/registry.ts`。

它负责：

- 注册工具
- 防止重复工具名
- 按名称查找工具
- 执行工具
- 未知工具时报错

CLI 当前注册了四类工具：

- `list_files`
- `read_file`
- `write_file`
- `run_command`

## 4. Workspace 安全边界

workspace 在 `src/workspace/workspace.ts`。

关键边界在 `src/workspace/path-policy.ts`：所有文件路径都会被 resolve 到 workspace root 里，如果像 `../secret.txt` 这样越界，就直接抛错。

所以文件工具不是直接读任意路径，而是通过：

```text
workspace.resolvePath(requestedPath)
```

确保路径在项目目录内。

## 5. 当前边界

现在这个 loop 已经成立，但还很 v0.1：

- 没有真实 LLM
- 没有权限确认
- 没有 diff 展示
- 没有上下文选择/压缩
- 没有 git dirty check
- provider 现在既像模型层，也像决策层，后面可能拆成 `ModelProvider + Planner/Policy`

现在的 Agent Loop “骨架成立”：provider 给动作，registry 调工具，workspace 控边界，trace 记录全过程。
