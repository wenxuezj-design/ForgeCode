# v0.2 Local Dev Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v0.2 Claude Code-style local development experience on top of the v0.1 agent loop.

**Architecture:** Keep the CLI thin and move durable behavior into runtime/tool/workspace boundaries. `runTask` emits structured events and records trace metadata; tools return structured metadata for command risk, diffs, protection, context, and verification; CLI renders those facts into readable progress and final summary.

**Tech Stack:** TypeScript ESM, Node.js built-in test runner, Node child processes, existing deterministic/scripted provider, npm scripts.

---

## Design Inputs

- Spec: `docs/superpowers/specs/2026-06-08-v0-2-local-dev-experience-design.md`
- Roadmap: `docs/roadmap.md`
- Alignment: `docs/claude-code-alignment.md`

## File Structure

- Modify `src/agent/trace.ts`: add trace metadata and v0.2 event types while preserving v0.1 type names.
- Modify `src/tools/registry.ts`: allow `ToolResult.metadata` and `ToolResult.success`.
- Modify `src/core/run-task.ts`: emit runtime events, record todo/progress/approval/diff/summary trace events, return runtime summary.
- Create `src/core/run-summary.ts`: derive final evidence from trace and tool metadata.
- Modify `src/tools/command-tool.ts`: add command risk classification, approval policy, structured command metadata, and verification metadata.
- Create `src/workspace/git-state.ts`: detect git availability, dirty paths, and per-file dirty state.
- Create `src/workspace/diff.ts`: generate simple unified text diffs for write operations.
- Modify `src/tools/workspace-tools.ts`: add protected write behavior and diff metadata.
- Create `src/tools/search-tool.ts`: implement search-first context discovery.
- Modify `src/app.ts`: register new tools, pass runtime event handler, render plan/progress/diff/summary.
- Modify `src/benchmarks/micro-runner.ts`: support scripted runtime benchmark tasks and expectations.
- Modify `benchmarks/micro/tasks.json`: expand to at least 10 tasks.
- Modify tests under `tests/`: cover trace metadata, runtime events, command approval, dirty protection, diff, search, CLI output, and benchmark expectations.
- Create `docs/v0.2-acceptance.md`: document v0.2 acceptance checklist.
- Modify `README.md` and `docs/roadmap.md`: link the v0.2 acceptance document and implementation plan.

---

## Task 1: Trace And Tool Result Metadata

**Goal:** Add metadata-capable trace and tool results without breaking existing v0.1 tests.

**Files:**
- Modify: `src/agent/trace.ts`
- Modify: `src/tools/registry.ts`
- Modify: `tests/trace.test.ts`
- Modify: `tests/tools.test.ts`

- [ ] **Step 1: Write failing trace metadata test**

Add this test to `tests/trace.test.ts`:

```ts
test("records trace metadata for v0.2 events", () => {
  const trace = createTraceRecorder(() => "2026-06-08T00:00:00.000Z");

  trace.record({
    type: "summary",
    message: "Runtime summary",
    metadata: {
      modifiedFiles: ["README.md"],
      verification: [{ command: "npm test", passed: true }]
    }
  });

  assert.equal(trace.events[0]?.type, "summary");
  assert.deepEqual(trace.events[0]?.metadata, {
    modifiedFiles: ["README.md"],
    verification: [{ command: "npm test", passed: true }]
  });
});
```

- [ ] **Step 2: Write failing tool result metadata test**

Add this test to `tests/tools.test.ts`:

```ts
test("registry preserves structured tool result metadata", async () => {
  const registry = createToolRegistry();

  registry.register({
    name: "structured",
    description: "Return metadata.",
    async execute() {
      return {
        success: true,
        content: "ok",
        metadata: {
          kind: "diff",
          path: "README.md"
        }
      };
    }
  });

  assert.deepEqual(await registry.execute("structured", {}), {
    success: true,
    content: "ok",
    metadata: {
      kind: "diff",
      path: "README.md"
    }
  });
});
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
npm run build --silent && node --experimental-strip-types --test tests/trace.test.ts tests/tools.test.ts
```

Expected: FAIL because `TraceEvent` does not accept `summary` or `metadata`, and `ToolResult` does not define `success` or `metadata`.

- [ ] **Step 4: Extend trace types**

Update `src/agent/trace.ts` to this shape:

```ts
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type TraceMetadata = Record<string, JsonValue>;

export type TraceEventType =
  | "plan"
  | "tool_call"
  | "tool_result"
  | "verification"
  | "final"
  | "todo"
  | "approval"
  | "diff"
  | "protection"
  | "context"
  | "summary";

export interface TraceEvent {
  type: TraceEventType;
  message: string;
  timestamp: string;
  metadata?: TraceMetadata;
}

export interface TraceRecorder {
  events: TraceEvent[];
  record(event: Omit<TraceEvent, "timestamp">): void;
}

export function createTraceRecorder(now = () => new Date().toISOString()): TraceRecorder {
  const events: TraceEvent[] = [];

  return {
    events,
    record(event) {
      events.push({
        ...event,
        timestamp: now()
      });
    }
  };
}
```

- [ ] **Step 5: Extend tool result types**

Update `src/tools/registry.ts` result interfaces:

```ts
import type { TraceMetadata } from "../agent/trace.js";

export interface ToolResult {
  content: string;
  success?: boolean;
  metadata?: TraceMetadata;
}
```

Keep the rest of the registry behavior unchanged.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm run build --silent && node --experimental-strip-types --test tests/trace.test.ts tests/tools.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/agent/trace.ts src/tools/registry.ts tests/trace.test.ts tests/tools.test.ts
git commit -m "feat: add trace and tool metadata"
```

---

## Task 2: Runtime Events And Summary Evidence

**Goal:** Make `runTask` emit progress events and return summary evidence derived from trace/tool metadata.

**Files:**
- Modify: `src/core/run-task.ts`
- Create: `src/core/run-summary.ts`
- Modify: `tests/run-task.test.ts`

- [ ] **Step 1: Write failing event emission test**

Add to `tests/run-task.test.ts`:

```ts
test("emits plan, todo, tool progress, and final summary events", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-run-task-"));
  await writeFile(join(root, "README.md"), "# Old\n");
  const workspace = createWorkspace(root);
  const tools = createToolRegistry();
  const workspaceTools = createWorkspaceTools(workspace);
  tools.register(workspaceTools.readFile);
  const events: Array<{ type: string }> = [];
  const provider = createScriptedProvider([
    { kind: "plan", content: "Read README\nReport result" },
    { kind: "tool", toolName: "read_file", input: { path: "README.md" } },
    { kind: "final", content: "Read README." }
  ]);

  const result = await runTask({
    task: "Inspect README",
    provider,
    tools,
    workspace,
    maxSteps: 10,
    onEvent(event) {
      events.push(event);
    }
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(events.map((event) => event.type), [
    "plan_started",
    "todo_updated",
    "tool_started",
    "tool_finished",
    "final_summary"
  ]);
  assert.equal(result.summaryEvidence.task, "Inspect README");
  assert.ok(result.summaryEvidence.traceEventCount >= 1);
});
```

- [ ] **Step 2: Write failing runtime summary test**

Add to `tests/run-task.test.ts`:

```ts
test("derives modified files, verification, blocked actions, and risks from trace metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-run-task-"));
  const workspace = createWorkspace(root);
  const tools = createToolRegistry();
  tools.register({
    name: "fake_write",
    description: "Fake write.",
    async execute() {
      return {
        success: true,
        content: "Wrote README.md",
        metadata: {
          modifiedFiles: ["README.md"],
          diff: "--- README.md\n+++ README.md\n@@\n-Old\n+New"
        }
      };
    }
  });
  tools.register({
    name: "fake_verify",
    description: "Fake verification.",
    async execute() {
      return {
        success: true,
        content: "exitCode=0\nstdout=ok\nstderr=",
        metadata: {
          verification: {
            command: "npm test",
            exitCode: 0,
            passed: true
          }
        }
      };
    }
  });
  const provider = createScriptedProvider([
    { kind: "tool", toolName: "fake_write", input: {} },
    { kind: "tool", toolName: "fake_verify", input: {} },
    { kind: "final", content: "Updated README and verified." }
  ]);

  const result = await runTask({ task: "Update README", provider, tools, workspace, maxSteps: 10 });

  assert.deepEqual(result.summaryEvidence.modifiedFiles, ["README.md"]);
  assert.equal(result.summaryEvidence.verification[0]?.passed, true);
  assert.deepEqual(result.summaryEvidence.blockedActions, []);
  assert.deepEqual(result.summaryEvidence.remainingRisks, []);
});
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
npm run build --silent && node --experimental-strip-types --test tests/run-task.test.ts
```

Expected: FAIL because `RunTaskOptions.onEvent` and `RunTaskResult.summaryEvidence` do not exist.

- [ ] **Step 4: Add summary evidence module**

Create `src/core/run-summary.ts`:

```ts
import type { TraceEvent } from "../agent/trace.js";

export interface VerificationEvidence {
  command: string;
  exitCode: number;
  passed: boolean;
  output?: string;
}

export interface BlockedActionEvidence {
  kind: string;
  reason: string;
  path?: string;
  command?: string;
}

export interface RunSummaryEvidence {
  task: string;
  providerFinal: string;
  modifiedFiles: string[];
  verification: VerificationEvidence[];
  blockedActions: BlockedActionEvidence[];
  remainingRisks: string[];
  traceEventCount: number;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export function createRunSummaryEvidence(task: string, providerFinal: string, events: TraceEvent[]): RunSummaryEvidence {
  const modifiedFiles = new Set<string>();
  const verification: VerificationEvidence[] = [];
  const blockedActions: BlockedActionEvidence[] = [];
  const remainingRisks: string[] = [];

  for (const event of events) {
    const metadata = event.metadata as Record<string, unknown> | undefined;

    for (const file of readStringArray(metadata?.modifiedFiles)) {
      modifiedFiles.add(file);
    }

    if (metadata?.verification && typeof metadata.verification === "object") {
      const record = metadata.verification as Record<string, unknown>;
      verification.push({
        command: String(record.command ?? ""),
        exitCode: Number(record.exitCode ?? 1),
        passed: Boolean(record.passed),
        output: typeof record.output === "string" ? record.output : undefined
      });
    }

    if (metadata?.blockedAction && typeof metadata.blockedAction === "object") {
      const record = metadata.blockedAction as Record<string, unknown>;
      const blocked = {
        kind: String(record.kind ?? "unknown"),
        reason: String(record.reason ?? event.message),
        path: typeof record.path === "string" ? record.path : undefined,
        command: typeof record.command === "string" ? record.command : undefined
      };
      blockedActions.push(blocked);
      remainingRisks.push(blocked.reason);
    }
  }

  if (verification.some((entry) => !entry.passed)) {
    remainingRisks.push("One or more verification commands failed.");
  }

  if (verification.length === 0) {
    remainingRisks.push("No verification command was recorded.");
  }

  return {
    task,
    providerFinal,
    modifiedFiles: [...modifiedFiles].sort(),
    verification,
    blockedActions,
    remainingRisks,
    traceEventCount: events.length
  };
}
```

- [ ] **Step 5: Add runtime event types and emit events**

In `src/core/run-task.ts`, add:

```ts
import { createRunSummaryEvidence, type RunSummaryEvidence } from "./run-summary.js";

export type RunTaskEvent =
  | { type: "plan_started"; message: string }
  | { type: "todo_updated"; message: string; todos: Array<{ content: string; status: "pending" | "in_progress" | "completed" }> }
  | { type: "tool_started"; message: string; toolName: string }
  | { type: "tool_finished"; message: string; toolName: string; success: boolean }
  | { type: "approval_required"; message: string }
  | { type: "diff_available"; message: string; path: string }
  | { type: "verification_result"; message: string; passed: boolean }
  | { type: "final_summary"; message: string; summary: RunSummaryEvidence };

function planToTodos(content: string): Array<{ content: string; status: "pending" | "in_progress" | "completed" }> {
  const lines = content
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);

  return (lines.length > 0 ? lines : [content]).map((line, index) => ({
    content: line,
    status: index === 0 ? "in_progress" : "pending"
  }));
}
```

Extend interfaces:

```ts
export interface RunTaskOptions {
  task: string;
  provider: ModelProvider;
  tools: ToolRegistry;
  workspace: Workspace;
  maxSteps?: number;
  onEvent?: (event: RunTaskEvent) => void;
}

export interface RunTaskResult {
  exitCode: number;
  summary: string;
  summaryEvidence: RunSummaryEvidence;
  trace: TraceRecorder;
}
```

When handling `plan`, record `todo` and call `onEvent`. When handling `tool`, call started/finished events, and record extra trace events based on tool result metadata. When handling `final`, call `createRunSummaryEvidence`, record `summary`, emit `final_summary`, and return it.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm run build --silent && node --experimental-strip-types --test tests/run-task.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/run-task.ts src/core/run-summary.ts tests/run-task.test.ts
git commit -m "feat: emit runtime events and summary evidence"
```

---

## Task 3: Command Risk And Approval Policy

**Goal:** Prevent destructive commands by default and expose structured command/verification metadata.

**Files:**
- Modify: `src/tools/command-tool.ts`
- Modify: `tests/tools.test.ts`

- [ ] **Step 1: Write failing safe command metadata test**

Add to `tests/tools.test.ts`:

```ts
test("command tool returns structured command metadata", async () => {
  const tool = createCommandTool({ cwd: process.cwd() });

  const result = await tool.execute({ command: "node", args: ["--version"] });

  assert.equal(result.success, true);
  assert.equal(result.metadata?.risk, "safe");
  assert.deepEqual(result.metadata?.verification, {
    command: "node --version",
    exitCode: 0,
    passed: true,
    output: result.content
  });
});
```

- [ ] **Step 2: Write failing destructive command refusal test**

Add to `tests/tools.test.ts`:

```ts
test("command tool refuses destructive commands by default", async () => {
  const tool = createCommandTool({ cwd: process.cwd() });

  const result = await tool.execute({ command: "rm", args: ["README.md"] });

  assert.equal(result.success, false);
  assert.match(result.content, /requires approval/i);
  assert.deepEqual(result.metadata?.blockedAction, {
    kind: "approval",
    reason: "Destructive command requires approval.",
    command: "rm README.md"
  });
});
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
npm run build --silent && node --experimental-strip-types --test tests/tools.test.ts
```

Expected: FAIL because `createCommandTool` does not classify risk or block destructive commands.

- [ ] **Step 4: Implement command risk classification**

Update `src/tools/command-tool.ts` with these additions:

```ts
export type ApprovalPolicy = "never" | "allow-safe" | "allow-all";
export type CommandRisk = "safe" | "unknown" | "destructive";

export interface CreateCommandToolOptions {
  cwd: string;
  approvalPolicy?: ApprovalPolicy;
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

function classifyCommand(command: string, args: string[]): CommandRisk {
  const destructiveCommands = new Set(["rm", "rmdir", "git"]);

  if (command === "git" && ["reset", "clean", "checkout"].includes(args[0] ?? "")) {
    return "destructive";
  }

  if (destructiveCommands.has(command) || args.includes("--force") || args.includes("-f")) {
    return "destructive";
  }

  if (
    command === "npm" ||
    command === "node" ||
    command === "tsc" ||
    command === "npx"
  ) {
    return "safe";
  }

  return "unknown";
}
```

Before spawning:

```ts
const approvalPolicy = options.approvalPolicy ?? "never";
const risk = classifyCommand(command, args);
const formattedCommand = formatCommand(command, args);

if (risk === "destructive" && approvalPolicy !== "allow-all") {
  return {
    success: false,
    content: `Command requires approval: ${formattedCommand}`,
    metadata: {
      risk,
      blockedAction: {
        kind: "approval",
        reason: "Destructive command requires approval.",
        command: formattedCommand
      }
    }
  };
}
```

On close, include:

```ts
const actualExitCode = exitCode ?? 1;
const content = [
  `exitCode=${actualExitCode}`,
  `stdout=${stdout.trim()}`,
  `stderr=${stderr.trim()}`
].join("\n");

resolve({
  success: actualExitCode === 0,
  content,
  metadata: {
    risk,
    verification: {
      command: formattedCommand,
      exitCode: actualExitCode,
      passed: actualExitCode === 0,
      output: content
    }
  }
});
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm run build --silent && node --experimental-strip-types --test tests/tools.test.ts tests/run-task.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tools/command-tool.ts tests/tools.test.ts
git commit -m "feat: guard destructive commands"
```

---

## Task 4: Git State, Dirty Protection, And Diffs

**Goal:** Protect user-modified files and return diff metadata from writes.

**Files:**
- Create: `src/workspace/git-state.ts`
- Create: `src/workspace/diff.ts`
- Modify: `src/tools/workspace-tools.ts`
- Modify: `src/app.ts`
- Modify: `tests/workspace-tools.test.ts`
- Modify: `tests/app.test.ts`

- [ ] **Step 1: Write failing diff metadata test**

Add to `tests/workspace-tools.test.ts`:

```ts
test("workspace write tool returns diff metadata for clean files", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-workspace-"));
  await writeFile(join(root, "README.md"), "# Old\n");
  const workspace = createWorkspace(root);
  const tools = createWorkspaceTools(workspace);

  const result = await tools.writeFile.execute({ path: "README.md", content: "# New\n" });

  assert.equal(result.success, true);
  assert.equal(result.metadata?.modifiedFiles, ["README.md"]);
  assert.match(String(result.metadata?.diff), /-# Old/);
  assert.match(String(result.metadata?.diff), /\\+# New/);
});
```

- [ ] **Step 2: Write failing dirty protection test**

Add to `tests/workspace-tools.test.ts`:

```ts
test("workspace write tool refuses files dirty at task start", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-workspace-"));
  await writeFile(join(root, "README.md"), "# User change\n");
  const workspace = createWorkspace(root);
  const tools = createWorkspaceTools(workspace, {
    dirtyPathsAtStart: new Set(["README.md"])
  });

  const result = await tools.writeFile.execute({ path: "README.md", content: "# ForgeCode change\n" });

  assert.equal(result.success, false);
  assert.match(result.content, /user changes/i);
  assert.deepEqual(result.metadata?.blockedAction, {
    kind: "user_changes",
    reason: "Refusing to overwrite user-modified file.",
    path: "README.md"
  });
  assert.equal(await readFile(join(root, "README.md"), "utf8"), "# User change\n");
});
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
npm run build --silent && node --experimental-strip-types --test tests/workspace-tools.test.ts
```

Expected: FAIL because `createWorkspaceTools` does not accept dirty paths or return diff metadata.

- [ ] **Step 4: Add simple diff helper**

Create `src/workspace/diff.ts`:

```ts
export interface TextDiffInput {
  path: string;
  before: string;
  after: string;
}

export function createTextDiff(input: TextDiffInput): string {
  if (input.before === input.after) {
    return "";
  }

  const beforeLines = input.before.split("\n");
  const afterLines = input.after.split("\n");
  const removed = beforeLines.filter((line) => !afterLines.includes(line)).map((line) => `-${line}`);
  const added = afterLines.filter((line) => !beforeLines.includes(line)).map((line) => `+${line}`);

  return [`--- ${input.path}`, `+++ ${input.path}`, "@@", ...removed, ...added].join("\n");
}
```

- [ ] **Step 5: Add git state boundary**

Create `src/workspace/git-state.ts`:

```ts
import { spawn } from "node:child_process";

export interface GitState {
  available: boolean;
  dirtyPaths: Set<string>;
}

export async function readGitState(cwd: string): Promise<GitState> {
  return new Promise((resolve) => {
    const child = spawn("git", ["status", "--porcelain"], { cwd, shell: false });
    let stdout = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on("error", () => {
      resolve({ available: false, dirtyPaths: new Set() });
    });
    child.on("close", (exitCode) => {
      if (exitCode !== 0) {
        resolve({ available: false, dirtyPaths: new Set() });
        return;
      }

      const dirtyPaths = new Set(
        stdout
          .split("\n")
          .map((line) => line.slice(3).trim())
          .filter(Boolean)
      );

      resolve({ available: true, dirtyPaths });
    });
  });
}
```

- [ ] **Step 6: Protect workspace writes**

Update `src/tools/workspace-tools.ts`:

```ts
import { readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createTextDiff } from "../workspace/diff.js";

export interface CreateWorkspaceToolsOptions {
  dirtyPathsAtStart?: Set<string>;
}

export function createWorkspaceTools(workspace: Workspace, options: CreateWorkspaceToolsOptions = {}): WorkspaceTools {
  const dirtyPathsAtStart = options.dirtyPathsAtStart ?? new Set<string>();
  const writtenPaths = new Set<string>();
  // keep existing listFiles/readFile implementations
}
```

Inside `writeFile.execute`:

```ts
const absolutePath = workspace.resolvePath(path);

if (dirtyPathsAtStart.has(path) && !writtenPaths.has(path)) {
  return {
    success: false,
    content: `Refusing to overwrite user changes in ${path}`,
    metadata: {
      blockedAction: {
        kind: "user_changes",
        reason: "Refusing to overwrite user-modified file.",
        path
      }
    }
  };
}

const before = existsSync(absolutePath) ? await readFile(absolutePath, "utf8") : "";
await writeFile(absolutePath, content);
writtenPaths.add(path);

return {
  success: true,
  content: `Wrote ${path}`,
  metadata: {
    modifiedFiles: [path],
    diff: createTextDiff({ path, before, after: content })
  }
};
```

- [ ] **Step 7: Wire git state into CLI tool setup**

Update `src/app.ts` so CLI-created workspace tools receive the task-start dirty paths:

```ts
import { readGitState } from "./workspace/git-state.js";
```

Inside the `run` command setup, before `createWorkspaceTools`:

```ts
const gitState = await readGitState(workspace.rootPath);
const workspaceTools = createWorkspaceTools(workspace, {
  dirtyPathsAtStart: gitState.dirtyPaths
});
```

Do not block non-git workspaces; this task only passes `dirtyPathsAtStart` into workspace tools.

- [ ] **Step 8: Add CLI dirty protection regression**

Add to `tests/app.test.ts`:

```ts
test("run command keeps working when git state is available", async () => {
  const result = await runCli(["run", "inspect", "git", "state"]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Summary:/);
  assert.equal(result.stderr, "");
});
```

- [ ] **Step 9: Run focused tests**

Run:

```bash
npm run build --silent && node --experimental-strip-types --test tests/workspace-tools.test.ts tests/run-task.test.ts
npm run build --silent && node --experimental-strip-types --test tests/app.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/workspace/git-state.ts src/workspace/diff.ts src/tools/workspace-tools.ts src/app.ts tests/workspace-tools.test.ts tests/app.test.ts
git commit -m "feat: protect workspace writes and report diffs"
```

---

## Task 5: Search-First Context Tool

**Goal:** Add `search_text` for targeted context discovery and traceable search results.

**Files:**
- Create: `src/tools/search-tool.ts`
- Create: `tests/search-tool.test.ts`
- Modify: `src/app.ts`

- [ ] **Step 1: Write failing search test**

Create `tests/search-tool.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createSearchTextTool } from "../dist/tools/search-tool.js";
import { createWorkspace } from "../dist/workspace/workspace.js";

test("search_text finds matching lines and skips generated directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-search-"));
  await writeFile(join(root, "README.md"), "ForgeCode local agent\n");
  await mkdir(join(root, "dist"));
  await writeFile(join(root, "dist", "bundle.js"), "ForgeCode generated\n");
  const tool = createSearchTextTool(createWorkspace(root));

  const result = await tool.execute({ query: "ForgeCode" });

  assert.equal(result.success, true);
  assert.match(result.content, /README.md:1:ForgeCode local agent/);
  assert.doesNotMatch(result.content, /bundle.js/);
  assert.deepEqual(result.metadata?.context, {
    query: "ForgeCode",
    resultCount: 1,
    files: ["README.md"]
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
npm run build --silent && node --experimental-strip-types --test tests/search-tool.test.ts
```

Expected: FAIL because `src/tools/search-tool.ts` does not exist.

- [ ] **Step 3: Implement search tool**

Create `src/tools/search-tool.ts`:

```ts
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Workspace } from "../workspace/workspace.js";
import type { Tool } from "./registry.js";

const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", ".git", ".worktrees", "coverage"]);

interface SearchInput {
  query: string;
  maxResults: number;
}

function parseSearchInput(input: unknown): SearchInput {
  if (!input || typeof input !== "object") {
    throw new Error("Search input must be an object");
  }

  const record = input as Record<string, unknown>;
  const query = record.query;
  const maxResults = record.maxResults ?? 20;

  if (typeof query !== "string" || query.length === 0) {
    throw new Error("Missing string input: query");
  }

  if (typeof maxResults !== "number" || maxResults < 1) {
    throw new Error("maxResults must be a positive number");
  }

  return { query, maxResults };
}

async function collectFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        files.push(...await collectFiles(root, join(directory, entry.name)));
      }
      continue;
    }

    if (entry.isFile()) {
      files.push(join(directory, entry.name));
    }
  }

  return files;
}

export function createSearchTextTool(workspace: Workspace): Tool {
  return {
    name: "search_text",
    description: "Search text files in the workspace before reading files.",
    async execute(input) {
      const { query, maxResults } = parseSearchInput(input);
      const files = await collectFiles(workspace.rootPath);
      const matches: Array<{ path: string; line: number; text: string }> = [];

      for (const file of files) {
        const relativePath = relative(workspace.rootPath, file);
        const content = await readFile(file, "utf8").catch(() => "");
        const lines = content.split("\n");

        lines.forEach((line, index) => {
          if (line.includes(query) && matches.length < maxResults) {
            matches.push({ path: relativePath, line: index + 1, text: line.trim() });
          }
        });
      }

      const filesWithMatches = [...new Set(matches.map((match) => match.path))].sort();

      return {
        success: true,
        content: matches.map((match) => `${match.path}:${match.line}:${match.text}`).join("\n"),
        metadata: {
          context: {
            query,
            resultCount: matches.length,
            files: filesWithMatches
          }
        }
      };
    }
  };
}
```

- [ ] **Step 4: Register search tool in CLI**

In `src/app.ts`, import and register:

```ts
import { createSearchTextTool } from "./tools/search-tool.js";
```

Then in the `run` command setup:

```ts
tools.register(createSearchTextTool(workspace));
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm run build --silent && node --experimental-strip-types --test tests/search-tool.test.ts tests/app.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tools/search-tool.ts tests/search-tool.test.ts src/app.ts
git commit -m "feat: add search-first context tool"
```

---

## Task 6: CLI Rendering For Local Dev Experience

**Goal:** Render plan/todo, tool progress, approval, diff, verification, and summary evidence in `forgecode run`.

**Files:**
- Modify: `src/app.ts`
- Modify: `tests/app.test.ts`

- [ ] **Step 1: Write failing CLI output test**

Update `tests/app.test.ts` run-command test:

```ts
test("runs the agent loop for the run command", async () => {
  const result = await runCli(["run", "build", "a", "tool", "registry"]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Task: build a tool registry/);
  assert.match(result.stdout, /Summary:/);
  assert.match(result.stdout, /Changes:/);
  assert.match(result.stdout, /Verification:/);
  assert.match(result.stdout, /Risks:/);
  assert.equal(result.stderr, "");
});
```

Add a new test:

```ts
test("renders runtime events as readable progress", async () => {
  const result = await runCli(["run", "inspect", "this", "repository"]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Progress:/);
  assert.match(result.stdout, /Trace events:/);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npm run build --silent && node --experimental-strip-types --test tests/app.test.ts
```

Expected: FAIL because CLI output still uses v0.1 summary shape.

- [ ] **Step 3: Add CLI render helpers**

In `src/app.ts`, add:

```ts
import type { RunSummaryEvidence, VerificationEvidence } from "./core/run-summary.js";
import type { RunTaskEvent } from "./core/run-task.js";

function renderVerification(verification: VerificationEvidence[]): string {
  if (verification.length === 0) {
    return "not recorded";
  }

  return verification
    .map((entry) => `${entry.command}: ${entry.passed ? "passed" : "failed"} (exit ${entry.exitCode})`)
    .join("; ");
}

function renderSummary(evidence: RunSummaryEvidence): string[] {
  return [
    "Summary:",
    `- Changes: ${evidence.modifiedFiles.length > 0 ? evidence.modifiedFiles.join(", ") : "none"}`,
    `- Verification: ${renderVerification(evidence.verification)}`,
    `- Blocked: ${evidence.blockedActions.length > 0 ? evidence.blockedActions.map((entry) => entry.reason).join("; ") : "none"}`,
    `- Risks: ${evidence.remainingRisks.length > 0 ? evidence.remainingRisks.join("; ") : "none"}`
  ];
}

function renderRunEvent(event: RunTaskEvent): string | undefined {
  if (event.type === "plan_started") {
    return `Plan: ${event.message}`;
  }

  if (event.type === "todo_updated") {
    return `Todo: ${event.todos.map((todo) => `${todo.status}:${todo.content}`).join(", ")}`;
  }

  if (event.type === "tool_started" || event.type === "tool_finished") {
    return `Progress: ${event.message}`;
  }

  if (event.type === "approval_required" || event.type === "diff_available" || event.type === "verification_result") {
    return `Progress: ${event.message}`;
  }

  return undefined;
}
```

In `runCli`, collect rendered events:

```ts
const progressLines: string[] = [];
const result = await runTask({
  task,
  provider,
  tools,
  workspace,
  onEvent(event) {
    const rendered = renderRunEvent(event);

    if (rendered) {
      progressLines.push(rendered);
    }
  }
});
```

Return:

```ts
stdout: [
  `Task: ${task}`,
  ...progressLines,
  ...renderSummary(result.summaryEvidence),
  `Provider final: ${result.summary}`,
  `Trace events: ${result.trace.events.length}`
].join("\n") + "\n",
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm run build --silent && node --experimental-strip-types --test tests/app.test.ts tests/run-task.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app.ts tests/app.test.ts
git commit -m "feat: render local dev progress in CLI"
```

---

## Task 7: Micro-Benchmark Runtime Expectations

**Goal:** Extend micro-benchmark tasks from smoke commands to runtime behavior checks and reach at least 10 tasks.

**Files:**
- Modify: `src/benchmarks/micro-runner.ts`
- Modify: `benchmarks/micro/tasks.json`
- Modify: `tests/micro-runner.test.ts`

- [ ] **Step 1: Write failing benchmark expectation test**

Add to `tests/micro-runner.test.ts`:

```ts
test("runs a scripted runtime benchmark and checks required trace events", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-bench-"));
  await writeFile(join(root, "README.md"), "# Demo\n");

  const result = await runMicroBenchmarkTask({
    id: "plan-trace",
    task: "Plan and inspect README",
    workspaceRoot: root,
    script: [
      { kind: "plan", content: "Read README" },
      { kind: "tool", toolName: "read_file", input: { path: "README.md" } },
      { kind: "final", content: "Read README." }
    ],
    expectations: {
      traceEvents: ["plan", "todo", "tool_call", "tool_result", "summary"]
    }
  });

  assert.equal(result.id, "plan-trace");
  assert.equal(result.passed, true);
  assert.match(result.verificationOutput, /traceEvents/);
});
```

Update the task type in this test file to include optional fields:

```ts
script?: Array<{ kind: string; content?: string; toolName?: string; input?: unknown }>;
expectations?: {
  traceEvents?: string[];
  summaryFields?: string[];
};
```

- [ ] **Step 2: Write failing task count test**

Add to `tests/micro-runner.test.ts`:

```ts
test("defines at least ten v0.2 micro benchmark tasks", async () => {
  const content = await readFile("benchmarks/micro/tasks.json", "utf8");
  const tasks = JSON.parse(content) as Array<{ id: string }>;

  assert.ok(tasks.length >= 10);
  assert.ok(tasks.some((task) => task.id === "dirty-protection"));
  assert.ok(tasks.some((task) => task.id === "destructive-command-refusal"));
  assert.ok(tasks.some((task) => task.id === "search-first-context"));
});
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
npm run build --silent && node --experimental-strip-types --test tests/micro-runner.test.ts
```

Expected: FAIL because `runMicroBenchmarkTask` only supports verification commands and `tasks.json` has 3 tasks.

- [ ] **Step 4: Extend benchmark types and scripted execution**

In `src/benchmarks/micro-runner.ts`, extend interfaces:

```ts
import type { AgentAction } from "../providers/model-provider.js";
import { createScriptedProvider } from "../providers/scripted-provider.js";
import { runTask } from "../core/run-task.js";
import { createToolRegistry } from "../tools/registry.js";
import { createWorkspaceTools } from "../tools/workspace-tools.js";
import { createWorkspace } from "../workspace/workspace.js";
import { createSearchTextTool } from "../tools/search-tool.js";

export interface MicroBenchmarkExpectations {
  traceEvents?: string[];
  summaryFields?: string[];
}

export interface MicroBenchmarkTask {
  id: string;
  task: string;
  workspaceRoot: string;
  verification?: {
    command: string;
    args: string[];
  };
  script?: AgentAction[];
  expectations?: MicroBenchmarkExpectations;
}
```

Add expectation helpers:

```ts
function hasSummaryField(summary: unknown, field: string): boolean {
  return Boolean(summary && typeof summary === "object" && field in summary);
}

function checkExpectations(task: MicroBenchmarkTask, traceEvents: string[], summary: unknown): string[] {
  const failures: string[] = [];

  for (const expected of task.expectations?.traceEvents ?? []) {
    if (!traceEvents.includes(expected)) {
      failures.push(`missing trace event: ${expected}`);
    }
  }

  for (const field of task.expectations?.summaryFields ?? []) {
    if (!hasSummaryField(summary, field)) {
      failures.push(`missing summary field: ${field}`);
    }
  }

  return failures;
}
```

In `runMicroBenchmarkTask`, if `task.script` exists, create workspace/tools/provider and run `runTask`, then check expectations.

- [ ] **Step 5: Expand tasks.json to at least 10 entries**

Keep the 3 existing command smoke tasks. Add scripted tasks like:

```json
{
  "id": "plan-todo-trace",
  "task": "Record plan and todo trace events.",
  "script": [
    { "kind": "plan", "content": "Read README" },
    { "kind": "final", "content": "Planned README read." }
  ],
  "expectations": {
    "traceEvents": ["plan", "todo", "summary"],
    "summaryFields": ["task", "remainingRisks", "traceEventCount"]
  }
}
```

Add tasks with ids:

```json
"tool-progress-trace"
"write-file-diff"
"dirty-protection"
"destructive-command-refusal"
"verification-summary"
"search-first-context"
"final-summary-evidence"
```

Each scripted task should use the smallest action script needed to trigger the behavior.

- [ ] **Step 6: Run focused tests and benchmark**

Run:

```bash
npm run build --silent && node --experimental-strip-types --test tests/micro-runner.test.ts
npm run bench:micro
```

Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add src/benchmarks/micro-runner.ts benchmarks/micro/tasks.json tests/micro-runner.test.ts
git commit -m "feat: expand v0.2 micro benchmarks"
```

---

## Task 8: Documentation And Acceptance Checklist

**Goal:** Document v0.2 behavior, acceptance criteria, and verification commands.

**Files:**
- Create: `docs/v0.2-acceptance.md`
- Modify: `README.md`
- Modify: `docs/roadmap.md`

- [ ] **Step 1: Write acceptance document**

Create `docs/v0.2-acceptance.md`:

```md
# v0.2 验收清单

ForgeCode v0.2 的目标是在 v0.1 最小 agent loop 之上补齐 Claude Code-style 的本地开发体验、安全边界和上下文管理。

## 必须满足

- `forgecode run <task>` 输出 plan/todo、工具进度和结构化 final summary。
- trace 记录 plan、todo、tool_call、tool_result、approval、diff、protection、context、summary 中适用的事件。
- 任务开始时记录 git dirty 状态。
- 写文件不会默认覆盖任务开始前已经 dirty 的文件。
- destructive command 默认拒绝执行，并进入 blocked actions。
- 写文件成功后返回 diff metadata，并在 CLI 中展示简短 diff。
- 支持 `search_text`，用于搜索优先的上下文发现。
- final summary 包含修改、验证、失败证据和剩余风险。
- micro-benchmark 至少包含 10 个任务，覆盖交互、安全和上下文管理。

## 验证命令

```bash
npm test
npm run typecheck
npm run bench:micro
```

## 不属于 v0.2 的内容

- 真实远程模型 provider。
- 外部 benchmark 子集。
- 长上下文压缩算法。
- 交互式全屏 UI。
```

- [ ] **Step 2: Update README links**

Add after the v0.1 acceptance section in `README.md`:

```md
## v0.2 验收

v0.2 的完成标准见 [docs/v0.2-acceptance.md](docs/v0.2-acceptance.md)。
```

- [ ] **Step 3: Update roadmap v0.2 plan link**

In `docs/roadmap.md`, under v0.2 target paragraph, add:

```md
实施计划：[v0.2 本地开发体验](superpowers/plans/2026-06-08-v0-2-local-dev-experience.md)。

验收清单：[v0.2 验收清单](v0.2-acceptance.md)。
```

- [ ] **Step 4: Run documentation checks**

Run:

```bash
rg -n "v0\\.2" README.md docs/roadmap.md docs/v0.2-acceptance.md
git diff --check
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add docs/v0.2-acceptance.md README.md docs/roadmap.md
git commit -m "docs: add v0.2 acceptance checklist"
```

---

## Task 9: Final Verification

**Goal:** Prove v0.2 is complete against the spec and acceptance checklist.

**Files:**
- Read: `docs/superpowers/specs/2026-06-08-v0-2-local-dev-experience-design.md`
- Read: `docs/v0.2-acceptance.md`
- Modify only if verification reveals a gap.

- [ ] **Step 1: Run full tests**

Run:

```bash
npm test
```

Expected: PASS with all tests passing.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run micro benchmark**

Run:

```bash
npm run bench:micro
```

Expected: PASS and JSON results where every task has `"passed": true`.

- [ ] **Step 4: Run CLI smoke**

Run:

```bash
npm run dev -- run "inspect this repository"
```

Expected output includes:

```text
Task: inspect this repository
Summary:
- Changes:
- Verification:
- Blocked:
- Risks:
Trace events:
```

- [ ] **Step 5: Check acceptance coverage**

Run:

```bash
rg -n "plan/todo|tool progress|dirty|destructive|diff|search_text|final summary|micro-benchmark" docs/v0.2-acceptance.md tests src benchmarks/micro/tasks.json
```

Expected: command exits 0 and shows hits for every v0.2 acceptance area.

- [ ] **Step 6: Check git status**

Run:

```bash
git status --short --branch
```

Expected: clean working tree on `codex-v0.2-local-dev-experience`.

- [ ] **Step 7: Final commit if verification fixes were needed**

If Step 1 through Step 5 required any changes:

```bash
git add <changed-files>
git commit -m "test: verify v0.2 local dev experience"
```

If no changes were needed, do not create an empty commit.
