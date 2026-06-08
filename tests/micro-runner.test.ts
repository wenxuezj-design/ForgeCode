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
