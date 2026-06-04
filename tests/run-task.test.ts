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
    "tool_call",
    "tool_result",
    "tool_call",
    "tool_result",
    "final"
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
