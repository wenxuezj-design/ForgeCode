import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { runTask } from "../dist/core/run-task.js";
import { createScriptedProvider } from "../dist/providers/scripted-provider.js";
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

test("emits plan, todo, tool progress, and final summary events", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-run-task-"));
  await writeFile(join(root, "README.md"), "# Old\n");
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
  assert.equal(typeof events[3]?.message, "string");
  assert.match(events[3]?.message as string, /read_file/);
  assert.equal((events[4]?.summary as { task?: string } | undefined)?.task, "Inspect README");
  assert.equal(result.summaryEvidence.task, "Inspect README");
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

  assert.deepEqual(result.summaryEvidence.modifiedFiles, ["README.md"]);
  assert.equal(result.summaryEvidence.verification[0]?.passed, true);
  assert.deepEqual(result.summaryEvidence.blockedActions, []);
  assert.deepEqual(result.summaryEvidence.remainingRisks, []);
});

test("collects remaining risks from trace metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-run-task-"));
  const workspace = createWorkspace(root);
  const tools = createToolRegistry();
  tools.register({
    name: "fake_risk",
    description: "Fake remaining risk.",
    async execute() {
      return {
        success: true,
        content: "Recorded risks",
        metadata: {
          remainingRisks: ["Manual QA is still pending.", "Release notes need review."]
        }
      };
    }
  });
  const provider = createScriptedProvider([
    { kind: "tool", toolName: "fake_risk", input: {} },
    { kind: "final", content: "Recorded risk metadata." }
  ]);

  const result = await runTask({ task: "Record risks", provider, tools, workspace, maxSteps: 10 });

  assert.deepEqual(result.summaryEvidence.remainingRisks, [
    "Manual QA is still pending.",
    "Release notes need review."
  ]);
});
