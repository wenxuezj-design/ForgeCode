import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
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
