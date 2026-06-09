import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { runMicroBenchmarkTask } from "../dist/benchmarks/micro-runner.js";

test("runs a micro benchmark task and reports pass when verification succeeds", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-bench-"));
  await writeFile(join(root, "README.md"), "# Demo\n");

  const result = await runMicroBenchmarkTask({
    id: "readme-smoke",
    task: "Inspect README",
    workspaceRoot: root,
    verification: { command: "node", args: ["--version"] }
  });

  assert.equal(result.id, "readme-smoke");
  assert.equal(result.passed, true);
  assert.match(result.verificationOutput, /exitCode=0/);
});

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

test("names the npm test micro benchmark after its verification behavior", async () => {
  const content = await readFile("benchmarks/micro/tasks.json", "utf8");
  const tasks = JSON.parse(content) as Array<{
    id: string;
    task: string;
    verification: {
      command: string;
      args: string[];
    };
  }>;

  const testSuiteTask = tasks.find((task) =>
    task.verification.command === "npm" &&
    task.verification.args.length === 1 &&
    task.verification.args[0] === "test"
  );

  assert.equal(testSuiteTask?.id, "test-suite-smoke");
  assert.equal(testSuiteTask?.task, "Verify the project test suite passes.");
});

test("defines at least ten v0.2 micro benchmark tasks", async () => {
  const content = await readFile("benchmarks/micro/tasks.json", "utf8");
  const tasks = JSON.parse(content) as Array<{
    id: string;
  }>;
  const ids = new Set(tasks.map((task) => task.id));

  assert.ok(tasks.length >= 10);
  assert.equal(ids.has("dirty-protection"), true);
  assert.equal(ids.has("destructive-command-refusal"), true);
  assert.equal(ids.has("search-first-context"), true);
});
