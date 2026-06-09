import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { runTask } from "../dist/core/run-task.js";
import { createScriptedProvider } from "../dist/providers/scripted-provider.js";
import { createCommandTool } from "../dist/tools/command-tool.js";
import { createToolRegistry } from "../dist/tools/registry.js";
import { createWorkspaceTools } from "../dist/tools/workspace-tools.js";
import { createWorkspace } from "../dist/workspace/workspace.js";

test("runs a deterministic coding loop with plan, tool calls, and final summary", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-run-task-"));
  await writeFile(join(root, "README.md"), "# Old\n");
  const workspace = createWorkspace(root);
  const tools = createToolRegistry();
  const workspaceTools = createWorkspaceTools(workspace);
  tools.register(workspaceTools.readFile);
  tools.register(workspaceTools.writeFile);
  const provider = createScriptedProvider([
    { kind: "plan", content: "Read then update README." },
    { kind: "tool", toolName: "read_file", input: { path: "README.md" } },
    { kind: "tool", toolName: "write_file", input: { path: "README.md", content: "# New\n" } },
    { kind: "final", content: "Updated README and verified file write." }
  ]);

  const result = await runTask({ task: "Update README", provider, tools, workspace, maxSteps: 10 });

  assert.equal(await readFile(join(root, "README.md"), "utf8"), "# New\n");
  assert.equal(result.exitCode, 0);
  assert.match(result.summary, /Updated README/);
  assert.deepEqual(result.trace.events.map((event) => event.type), [
    "plan",
    "todo",
    "tool_call",
    "tool_result",
    "tool_call",
    "tool_result",
    "diff",
    "final",
    "summary"
  ]);
});

test("records failed verification command output so the provider can revise", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-run-task-"));
  const workspace = createWorkspace(root);
  const tools = createToolRegistry();
  tools.register({
    name: "run_command",
    description: "Fake verification command.",
    async execute() {
      return { content: "exitCode=1\nstdout=\nstderr=test failed" };
    }
  });
  const provider = createScriptedProvider([
    { kind: "tool", toolName: "run_command", input: { command: "npm", args: ["test"] } },
    { kind: "final", content: "Verification failed and was reported." }
  ]);

  const result = await runTask({ task: "Run verification", provider, tools, workspace, maxSteps: 5 });

  assert.equal(result.exitCode, 0);
  assert.match(result.trace.events.map((event) => event.message).join("\n"), /stderr=test failed/);
});

test("passes provider trace events as snapshots", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-run-task-"));
  const workspace = createWorkspace(root);
  const tools = createToolRegistry();
  let firstEvents: unknown[] | undefined;
  let calls = 0;
  const provider = {
    name: "snapshot-test",
    async complete() {
      return { role: "assistant" as const, content: "unused" };
    },
    async nextAction(context: { events: unknown[] }) {
      if (calls === 0) {
        firstEvents = context.events;
      }

      calls += 1;

      return calls === 1
        ? { kind: "plan" as const, content: "Inspect project" }
        : { kind: "final" as const, content: "Done." };
    }
  };

  const result = await runTask({ task: "Inspect project", provider, tools, workspace, maxSteps: 5 });

  assert.equal(result.exitCode, 0);
  assert.ok(result.trace.events.length > 0);
  assert.equal(firstEvents?.length, 0);
});

test("records task-start git state as protection evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-run-task-"));
  const workspace = createWorkspace(root);
  const tools = createToolRegistry();
  const provider = createScriptedProvider([
    { kind: "final", content: "Recorded git state." }
  ]);

  const result = await runTask({
    task: "Inspect git state",
    provider,
    tools,
    workspace,
    maxSteps: 5,
    initialGitState: {
      available: true,
      dirtyPaths: ["README.md"]
    }
  });
  const protectionEvent = result.trace.events.find(
    (event) => event.type === "protection" && event.metadata?.kind === "git_state"
  );

  assert.equal(protectionEvent?.message, "Task-start git state captured.");
  assert.deepEqual(protectionEvent?.metadata?.dirtyPaths, ["README.md"]);
  assert.equal(protectionEvent?.metadata?.gitAvailable, true);
});

test("records context and protection trace events from tool metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-run-task-"));
  const workspace = createWorkspace(root);
  const tools = createToolRegistry();
  tools.register({
    name: "fake_context",
    description: "Fake context evidence.",
    async execute() {
      return {
        success: true,
        content: "Found README.md",
        metadata: {
          context: {
            query: "README",
            matches: [{ path: "README.md", line: 1 }]
          }
        }
      };
    }
  });
  tools.register({
    name: "fake_blocked",
    description: "Fake blocked action.",
    async execute() {
      return {
        success: false,
        content: "Blocked README.md",
        metadata: {
          blockedAction: {
            kind: "user_changes",
            path: "README.md",
            reason: "Refusing to overwrite user-modified file."
          }
        }
      };
    }
  });
  const provider = createScriptedProvider([
    { kind: "tool", toolName: "fake_context", input: {} },
    { kind: "tool", toolName: "fake_blocked", input: {} },
    { kind: "final", content: "Recorded context and protection evidence." }
  ]);

  const result = await runTask({ task: "Record evidence", provider, tools, workspace, maxSteps: 10 });
  const contextEvent = result.trace.events.find((event) => event.type === "context");
  const protectionEvent = result.trace.events.find(
    (event) => event.type === "protection" && event.metadata?.kind === "user_changes"
  );

  assert.equal(contextEvent?.message, "Context captured from fake_context.");
  assert.equal(contextEvent?.metadata?.toolName, "fake_context");
  assert.deepEqual(protectionEvent?.metadata, {
    kind: "user_changes",
    path: "README.md",
    reason: "Refusing to overwrite user-modified file.",
    toolName: "fake_blocked"
  });
});

test("emits plan, todo, tool progress, and final summary events", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-run-task-"));
  await writeFile(join(root, "README.md"), "# Old\nSENTINEL_LARGE_TOOL_RESULT_CONTENT\n");
  const workspace = createWorkspace(root);
  const tools = createToolRegistry();
  const workspaceTools = createWorkspaceTools(workspace);
  tools.register(workspaceTools.readFile);
  const events: Array<Record<string, unknown>> = [];
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
  assert.deepEqual(events[0], {
    type: "plan_started",
    message: "Read README\nReport result"
  });

  assert.equal(events[1]?.type, "todo_updated");
  assert.deepEqual((events[1]?.todos as unknown[] | undefined)?.[0], {
    content: "Read README",
    status: "in_progress"
  });
  assert.deepEqual((events[1]?.todos as unknown[] | undefined)?.[1], {
    content: "Report result",
    status: "pending"
  });

  assert.equal(typeof events[2]?.message, "string");
  assert.match(events[2]?.message as string, /read_file/);
  assert.doesNotMatch(events[2]?.message as string, /README\.md/);
  assert.equal("input" in (events[2] ?? {}), false);
  assert.equal(typeof events[3]?.message, "string");
  assert.match(events[3]?.message as string, /read_file/);
  assert.doesNotMatch(events[3]?.message as string, /SENTINEL_LARGE_TOOL_RESULT_CONTENT/);
  assert.equal("content" in (events[3] ?? {}), false);
  assert.equal((events[4]?.summary as { task?: string } | undefined)?.task, "Inspect README");
  assert.equal(result.summaryEvidence.task, "Inspect README");
  assert.deepEqual(result.summaryEvidence.remainingRisks, []);
  assert.ok(result.summaryEvidence.traceEventCount >= 1);
});

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
  const writeToolResult = result.trace.events.find(
    (event) => event.type === "tool_result" && event.metadata?.toolName === "fake_write"
  );

  assert.deepEqual(writeToolResult?.metadata?.modifiedFiles, ["README.md"]);
  assert.equal(writeToolResult?.metadata?.toolSuccess, true);
  assert.deepEqual(result.summaryEvidence.modifiedFiles, ["README.md"]);
  assert.equal(result.summaryEvidence.verification[0]?.passed, true);
  assert.deepEqual(result.summaryEvidence.blockedActions, []);
  assert.deepEqual(result.summaryEvidence.remainingRisks, []);
  assert.equal(result.summaryEvidence.traceEventCount, result.trace.events.length);
});

test("records failed tool evidence in trace metadata and summary risks", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-run-task-"));
  const workspace = createWorkspace(root);
  const tools = createToolRegistry();
  tools.register({
    name: "fake_fail",
    description: "Fake failed tool.",
    async execute() {
      return {
        success: false,
        content: "failed"
      };
    }
  });
  const provider = createScriptedProvider([
    { kind: "tool", toolName: "fake_fail", input: {} },
    { kind: "final", content: "Tool failed." }
  ]);

  const result = await runTask({ task: "Run failed tool", provider, tools, workspace, maxSteps: 10 });
  const toolResult = result.trace.events.find((event) => event.type === "tool_result");

  assert.equal(toolResult?.metadata?.toolName, "fake_fail");
  assert.equal(toolResult?.metadata?.toolSuccess, false);
  assert.deepEqual(result.summaryEvidence.remainingRisks, ["Tool fake_fail failed."]);
});

test("protects provider trace event snapshots from mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-run-task-"));
  const workspace = createWorkspace(root);
  const tools = createToolRegistry();
  tools.register({
    name: "fake_fail",
    description: "Fake failed tool.",
    async execute() {
      return {
        success: false,
        content: "failed"
      };
    }
  });
  let calls = 0;
  const provider = {
    name: "mutating-provider",
    async complete() {
      return { role: "assistant" as const, content: "unused" };
    },
    async nextAction(context: { events: Array<{ type: string; metadata?: Record<string, unknown> }> }) {
      calls += 1;

      if (calls === 1) {
        return { kind: "tool" as const, toolName: "fake_fail", input: {} };
      }

      const toolResult = context.events.find((event) => event.type === "tool_result");

      if (toolResult?.metadata) {
        toolResult.metadata.toolSuccess = true;
      }

      return { kind: "final" as const, content: "Done." };
    }
  };

  const result = await runTask({ task: "Run failed tool", provider, tools, workspace, maxSteps: 10 });
  const toolResult = result.trace.events.find((event) => event.type === "tool_result");

  assert.equal(toolResult?.metadata?.toolSuccess, false);
  assert.deepEqual(result.summaryEvidence.remainingRisks, ["Tool fake_fail failed."]);
});

test("preserves blocked action kind and path in summary evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-run-task-"));
  const workspace = createWorkspace(root);
  const tools = createToolRegistry();
  tools.register({
    name: "fake_blocked",
    description: "Fake blocked action.",
    async execute() {
      return {
        success: false,
        content: "Blocked README.md",
        metadata: {
          blockedAction: {
            kind: "user_changes",
            path: "README.md",
            reason: "Refusing to overwrite user-modified file."
          }
        }
      };
    }
  });
  const provider = createScriptedProvider([
    { kind: "tool", toolName: "fake_blocked", input: {} },
    { kind: "final", content: "Blocked unsafe write." }
  ]);

  const result = await runTask({ task: "Protect README", provider, tools, workspace, maxSteps: 10 });
  const summaryEvent = result.trace.events.find((event) => event.type === "summary");
  const serializedBlockedActions = summaryEvent?.metadata?.blockedActions as Array<Record<string, unknown>> | undefined;

  assert.deepEqual(result.summaryEvidence.blockedActions[0], {
    kind: "user_changes",
    path: "README.md",
    reason: "Refusing to overwrite user-modified file."
  });
  assert.deepEqual(serializedBlockedActions?.[0], {
    kind: "user_changes",
    path: "README.md",
    reason: "Refusing to overwrite user-modified file."
  });
});

test("records real command tool refusal as approval evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-run-task-"));
  await writeFile(join(root, "sentinel.txt"), "keep me\n");
  const workspace = createWorkspace(root);
  const tools = createToolRegistry();
  tools.register(createCommandTool({ cwd: root }));
  const events: Array<Record<string, unknown>> = [];
  const provider = createScriptedProvider([
    { kind: "tool", toolName: "run_command", input: { command: "rm", args: ["sentinel.txt"] } },
    { kind: "final", content: "Refused destructive command." }
  ]);

  const result = await runTask({
    task: "Remove sentinel",
    provider,
    tools,
    workspace,
    maxSteps: 10,
    onEvent(event) {
      events.push(event);
    }
  });
  const approvalEvent = result.trace.events.find((event) => event.type === "approval");

  assert.equal(await readFile(join(root, "sentinel.txt"), "utf8"), "keep me\n");
  assert.equal(events.some((event) => event.type === "approval_required"), true);
  assert.equal(approvalEvent?.message, "Destructive command requires approval.");
  assert.deepEqual(result.summaryEvidence.blockedActions[0], {
    kind: "approval",
    reason: "Destructive command requires approval.",
    command: "rm sentinel.txt"
  });
  assert.equal(result.summaryEvidence.remainingRisks.includes("Destructive command requires approval."), true);
});

test("preserves verification output and reports failed verification risk", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-run-task-"));
  const workspace = createWorkspace(root);
  const tools = createToolRegistry();
  tools.register({
    name: "fake_verify_fail",
    description: "Fake failing verification.",
    async execute() {
      return {
        success: true,
        content: "exitCode=1\nstdout=\nstderr=test failed",
        metadata: {
          verification: {
            command: "npm test",
            exitCode: 1,
            output: "stderr=test failed",
            passed: false
          }
        }
      };
    }
  });
  const provider = createScriptedProvider([
    { kind: "tool", toolName: "fake_verify_fail", input: {} },
    { kind: "final", content: "Verification failed." }
  ]);

  const result = await runTask({ task: "Verify failure", provider, tools, workspace, maxSteps: 10 });
  const summaryEvent = result.trace.events.find((event) => event.type === "summary");
  const serializedVerification = summaryEvent?.metadata?.verification as Array<Record<string, unknown>> | undefined;

  assert.equal(result.summaryEvidence.verification[0]?.output, "stderr=test failed");
  assert.equal(serializedVerification?.[0]?.output, "stderr=test failed");
  assert.deepEqual(result.summaryEvidence.remainingRisks, ["One or more verification commands failed."]);
});

test("reports missing verification for modified files", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-run-task-"));
  const workspace = createWorkspace(root);
  const tools = createToolRegistry();
  tools.register({
    name: "fake_unverified_write",
    description: "Fake unverified write.",
    async execute() {
      return {
        success: true,
        content: "Wrote README.md",
        metadata: {
          modifiedFiles: ["README.md"]
        }
      };
    }
  });
  const provider = createScriptedProvider([
    { kind: "tool", toolName: "fake_unverified_write", input: {} },
    { kind: "final", content: "Updated README without verification." }
  ]);

  const result = await runTask({ task: "Unverified write", provider, tools, workspace, maxSteps: 10 });

  assert.deepEqual(result.summaryEvidence.modifiedFiles, ["README.md"]);
  assert.deepEqual(result.summaryEvidence.remainingRisks, ["No verification command was recorded."]);
});

test("collects remaining risks from trace metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-run-task-"));
  const workspace = createWorkspace(root);
  const tools = createToolRegistry();
  tools.register({
    name: "fake_string_risk",
    description: "Fake string remaining risk.",
    async execute() {
      return {
        success: true,
        content: "Recorded string risk",
        metadata: {
          remainingRisks: "Code owner sign-off pending."
        }
      };
    }
  });
  tools.register({
    name: "fake_array_risk",
    description: "Fake array remaining risks.",
    async execute() {
      return {
        success: true,
        content: "Recorded array risks",
        metadata: {
          remainingRisks: ["Manual QA is still pending.", "Release notes need review."]
        }
      };
    }
  });
  const provider = createScriptedProvider([
    { kind: "tool", toolName: "fake_string_risk", input: {} },
    { kind: "tool", toolName: "fake_array_risk", input: {} },
    { kind: "final", content: "Recorded risk metadata." }
  ]);

  const result = await runTask({ task: "Record risks", provider, tools, workspace, maxSteps: 10 });

  assert.deepEqual(result.summaryEvidence.remainingRisks, [
    "Code owner sign-off pending.",
    "Manual QA is still pending.",
    "Release notes need review."
  ]);
});
