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

test("treats summaryFields as presence checks even when values are empty", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-bench-"));
  await writeFile(join(root, "README.md"), "# Demo\n");

  const result = await runMicroBenchmarkTask({
    id: "empty-summary-field",
    task: "Record empty modified files evidence",
    workspaceRoot: root,
    script: [
      { kind: "plan", content: "Return final summary" },
      { kind: "final", content: "No files modified." }
    ],
    expectations: {
      summaryFields: ["modifiedFiles"]
    }
  });

  assert.equal(result.passed, true);
  assert.match(result.verificationOutput, /"modifiedFiles":\[\]/);
});

test("runs scripted write benchmarks in an isolated fixture without mutating the supplied root", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-bench-"));
  await writeFile(join(root, "README.md"), "# Caller workspace\n");

  const result = await runMicroBenchmarkTask({
    id: "isolated-write",
    task: "Write benchmark output without touching caller root",
    workspaceRoot: root,
    script: [
      { kind: "plan", content: "Write output\nReport diff" },
      {
        kind: "tool",
        toolName: "write_file",
        input: {
          path: "micro-benchmark-output.txt",
          content: "isolated output\n"
        }
      },
      { kind: "final", content: "Wrote isolated output." }
    ],
    expectations: {
      traceEvents: ["diff", "summary"],
      summaryFields: ["modifiedFiles"]
    }
  });

  assert.equal(result.passed, true);
  await assert.rejects(() => readFile(join(root, "micro-benchmark-output.txt"), "utf8"), {
    code: "ENOENT"
  });
});

test("refuses unknown scripted commands with the safe approval policy", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-bench-"));
  await writeFile(join(root, "README.md"), "# Demo\n");

  const result = await runMicroBenchmarkTask({
    id: "unknown-command-refusal",
    task: "Refuse unknown command",
    workspaceRoot: root,
    script: [
      { kind: "plan", content: "Try unknown command\nReport refusal" },
      {
        kind: "tool",
        toolName: "run_command",
        input: {
          command: "definitely-not-a-real-forgecode-command",
          args: []
        }
      },
      { kind: "final", content: "Refused unknown command." }
    ],
    expectations: {
      traceEvents: ["approval", "summary"],
      summaryFields: ["blockedActions"]
    }
  });

  assert.equal(result.passed, true);
  assert.match(result.verificationOutput, /Command risk is not safe/);
});

test("refuses unknown verification commands with the safe approval policy", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-bench-"));
  await writeFile(join(root, "README.md"), "# Demo\n");

  const result = await runMicroBenchmarkTask({
    id: "unknown-verification-refusal",
    task: "Refuse unknown verification command",
    workspaceRoot: root,
    verification: {
      command: "definitely-not-a-real-forgecode-command",
      args: []
    }
  });

  assert.equal(result.passed, false);
  assert.match(result.verificationOutput, /Command risk is not safe/);
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

test("search-first-context searches before reading README", async () => {
  const content = await readFile("benchmarks/micro/tasks.json", "utf8");
  const tasks = JSON.parse(content) as Array<{
    id: string;
    script?: Array<{
      kind: string;
      toolName?: string;
    }>;
  }>;
  const searchTask = tasks.find((task) => task.id === "search-first-context");
  const toolNames = searchTask?.script
    ?.filter((action) => action.kind === "tool")
    .map((action) => action.toolName);

  assert.deepEqual(toolNames, ["search_text", "read_file"]);
});
