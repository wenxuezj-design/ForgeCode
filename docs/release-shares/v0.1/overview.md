# v0.1

## 核心目标是？

**确保 ForgeCode 的最小本地 Agent Loop 已经成立（最小可验证Agent内核）**

基本的执行骨架包括：

1. 接收任务
2. 创建 session
3. 记录trace
4. 调用工具
5. 运行验证
6. 输出结果
7. 可 benchmark

## 怎么验证核心目标已完成？

## 主要做了什么？

1. **CLI  提供最小命令入口**
   - 支持 forgecode run <task>
   - 现在 run 命令会进入真正的 runTask() loop，而不是只打印占位信息。

2. **Agent Session 和 Trace：记录agent执行过程中的关键事件**
   - 每次任务都有 session。
   - 执行过程会记录结构化 trace，比如：
     - plan
     - tool_call
     - tool_result
     - final

3. **Workspace 安全边界**
   - agent 只能在当前 workspace 内读写文件。
   - 类似 ../secret.txt 这种越界路径会被拒绝。

4. **Tool 工具系统**
   - 有工具注册表 ToolRegistry。
   - 有文件工具：
     - list_files
     - read_file
     - write_file
   - 有命令工具：
     - run_command

5. **Provider 提供模型+决策**
   - 定义了 ModelProvider.nextAction()。
   - 新增 scripted provider，用来稳定复现测试流程。
   - 暂时还没有接真实 LLM。

6. **核心 Agent Loop**
   - runTask() 会从 provider 获取下一步 action。
   - 如果是 tool action，就调用工具。
   - 如果是 final action，就结束并返回 summary。
   - 所有关键步骤都会写入 trace。

7. **Micro Benchmark**
   - 新增 npm run bench:micro
   - 当前有 3 个 smoke task：
     - npm test
     - npm run typecheck
     - npm run build

## 项目的架构设计

### 功能分层：

```javascript
CLI
    -> App 命令路由
        -> Core Agent Loop
            -> Provider 决策
            -> Tool Registry 调工具
            -> Workspace 管文件边界
            -> Trace 记录全过程
```

### 最小流程

```javascript
forgecode run <task>
  -> runTask()
  -> provider.nextAction()
  -> toolRegistry.execute()
  -> trace.record()
  -> summary / benchmark result
```

### 核心目录

```javascript
- src/
    - cli.ts # 命令的真正入口，只做一件事：拿到 `process.argv`，交给 `runCli()`，然后将结果写到 `stdout/stderr`
    - apps.ts # 命令路由，会创建 `workspace` `tool registry` `provider`，然后调用核心 `tool`
    - core/ 
        - app.ts # 用于创建 coreApp
        - run-task.ts # 最核心的文件，负责实现 `agent loop`
    - agent/
        - session.ts # 创建一次任务的 session
        - trace.ts # 记录执行过程，这是 **debug、benchmark、对标 claude code的基础**
    - provider/
        - model-provider.ts # 定义模型 provider 协议
        - scriptd-provider.ts # 用于测试，可以传入一组action，它封装后返回，可以让 agent loop 稳定执行一组action
    - tools/
        - registry.ts # 提供 工具注册表 创建方法
        - workspace-tools.ts # workspace 方法，目前主要负责文件处理
        - command-tool.ts # 命令处理，用于执行命令
    - workspace/
        - workspace.ts # 当前项目工作区
        - path.policy.ts # 负责安全边界，不能读写 workspace root 之外的路径
    - benchmark/
        - micro-runner # v0.1的 `micro benchmark runner`
```

### 整体目录

```javascript
- forgecode/
    - benchmarks/ # benchmark目录，目前只有micro
    - dist/ # 运行 build 得到的编译后文件
    - docs/ # 文档目录，包括项目的规划和 superpowers相关文件
    - node_modules/ # npm依赖包目录
    - src/ # 核心源代码目录
    - tests/ # 测试目录
    - LICENSE # 项目协议文件
    - package-lock.json # npm lock文件
    - package.json # npm 项目元信息文件
    - README.md # 项目说明
    - tsconfig.json # TS配置
    - .git/ # git 仓库元数据目录
    - .gitignore # git忽略规则
    - .npmrc # npm项目级配置，当前指定官方 registry   
```

## 为什么0.1包管理器选择的是npm

1. node自带，无需额外处理
2. 项目很小，目前只有 node 和 TS 依赖，没有复杂依赖树
3. 当前核心目标是：验证 CLI能跑、agent loop 能跑、tools能跑、benchmark能跑，npm不是核心关注点
4. 对于 benchmark/CI更通用，在行业 benchmark 或干净环境里，默认有 npm 的概率最高，用 npm 可以减少环境准备问题
5. 避免工具链变量，如果一开始使用pnpm，失败时就需要考虑：是 agent loop 问题？还是 pnpm workspace/config 问题？或者是 lockfile/sotre 问题？减少变量，避免无谓的错误分析链

不过，也不是 npm 就绝对最好，如果后续变成 monorepo，会倾向改为 pnpm，因为在 workspace、多包管理、依赖隔离、安装速度上更有优势

## 下一步是什么？

v0.2 会补 Claude Code-style 本地开发体验。

重点是 planning/todo、tool call 展示、git 状态保护、权限确认、diff 展示、上下文选择和最终总结质量。
