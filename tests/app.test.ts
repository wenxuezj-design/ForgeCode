import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import {
  createHelpMessage,
  createWelcomeMessage,
  renderRunEvent,
  renderSummary,
  runCli
} from "../dist/app.js";
import type { RunSummaryEvidence } from "../dist/core/run-summary.js";
import type { RunTaskEvent } from "../dist/core/run-task.js";

const execFileAsync = promisify(execFile);

function shouldClearGitEnv(key: string): boolean {
  return key.startsWith("GIT_");
}

function safeGitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !shouldClearGitEnv(key)) {
      env[key] = value;
    }
  }

  return env;
}

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd, env: safeGitEnv() });
}

test("creates a welcome message with the project name and purpose", () => {
  const message = createWelcomeMessage();

  assert.match(message, /ForgeCode/);
  assert.match(message, /open coding agent/i);
  assert.match(message, /from first principles/i);
});

test("prints the welcome message when no command is provided", async () => {
  const result = await runCli([]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /ForgeCode/);
  assert.equal(result.stderr, "");
});

test("prints the current version", async () => {
  const result = await runCli(["--version"]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), "0.1.0");
  assert.equal(result.stderr, "");
});

test("creates help text with available commands", () => {
  const message = createHelpMessage();

  assert.match(message, /Usage: forgecode/);
  assert.match(message, /--help/);
  assert.match(message, /--version/);
});

test("prints help for --help and -h", async () => {
  for (const flag of ["--help", "-h"]) {
    const result = await runCli([flag]);

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Usage: forgecode/);
    assert.equal(result.stderr, "");
  }
});

test("returns an error for unknown commands", async () => {
  const result = await runCli(["frobnicate"]);

  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Unknown command: frobnicate/);
  assert.match(result.stderr, /forgecode --help/);
});

test("runs the agent loop for the run command", async () => {
  const result = await runCli(["run", "build", "a", "tool", "registry"]);
  const lines = result.stdout.trimEnd().split("\n");

  assert.equal(result.exitCode, 0);
  assert.deepEqual(lines, [
    "Task: build a tool registry",
    "Summary:",
    "- Changes: not recorded",
    "- Verification: not recorded",
    "- Blocked: none",
    "- Risks: none",
    "Provider final: No provider actions configured.",
    "Trace events: 2"
  ]);
  assert.doesNotMatch(result.stdout, /^Plan:/m);
  assert.doesNotMatch(result.stdout, /^Todo:/m);
  assert.doesNotMatch(result.stdout, /^Progress:/m);
  assert.doesNotMatch(result.stdout, /Task complete\./);
  assert.equal(result.stderr, "");
});

test("renders runtime events as readable progress", () => {
  const events: RunTaskEvent[] = [
    { type: "plan_started", message: "Inspect workspace" },
    {
      type: "todo_updated",
      message: "Todo list updated",
      todos: [
        { content: "Inspect workspace", status: "in_progress" },
        { content: "Report result", status: "pending" }
      ]
    },
    { type: "tool_started", message: "Starting read_file", toolName: "read_file" },
    { type: "tool_finished", message: "read_file succeeded", toolName: "read_file", success: true },
    { type: "approval_required", message: "Destructive command requires approval." },
    { type: "diff_available", message: "Diff available for README.md", path: "README.md" },
    { type: "verification_result", message: "npm test exitCode=0", passed: true },
    {
      type: "final_summary",
      message: "Done.",
      summary: {
        task: "Inspect workspace",
        providerFinal: "Done.",
        modifiedFiles: [],
        verification: [],
        blockedActions: [],
        remainingRisks: [],
        traceEventCount: 1
      }
    }
  ];

  assert.deepEqual(events.map(renderRunEvent), [
    "Plan: Inspect workspace",
    "Todo: in_progress:Inspect workspace, pending:Report result",
    "Progress: Starting read_file",
    "Progress: read_file succeeded",
    "Progress: Destructive command requires approval.",
    "Progress: Diff available for README.md",
    "Progress: npm test exitCode=0",
    undefined
  ]);
});

test("renders summary evidence lines", () => {
  const evidence: RunSummaryEvidence = {
    task: "Update README",
    providerFinal: "Updated README and verified.",
    modifiedFiles: ["README.md", "src/app.ts"],
    verification: [
      { command: "npm test", exitCode: 0, passed: true },
      { command: "npm run lint", passed: false }
    ],
    blockedActions: [
      { reason: "Refusing to overwrite user-modified file.", path: "README.md" },
      { reason: "Destructive command requires approval.", command: "rm tmp.txt" }
    ],
    remainingRisks: ["Manual QA pending.", "Release note pending."],
    traceEventCount: 12
  };

  assert.deepEqual(renderSummary(evidence), [
    "Summary:",
    "- Changes: README.md, src/app.ts",
    "- Verification: npm test: passed (exit 0); npm run lint: failed",
    "- Blocked: Refusing to overwrite user-modified file. (README.md); Destructive command requires approval. (rm tmp.txt)",
    "- Risks: Manual QA pending.; Release note pending."
  ]);
});

test("renders empty summary evidence as not recorded", () => {
  const evidence: RunSummaryEvidence = {
    task: "Inspect workspace",
    providerFinal: "No provider actions configured.",
    modifiedFiles: [],
    verification: [],
    blockedActions: [],
    remainingRisks: [],
    traceEventCount: 2
  };

  assert.deepEqual(renderSummary(evidence), [
    "Summary:",
    "- Changes: not recorded",
    "- Verification: not recorded",
    "- Blocked: none",
    "- Risks: none"
  ]);
});

test("run command keeps working from an isolated git repository subdirectory", { concurrency: false }, async () => {
  const originalCwd = process.cwd();
  const root = await mkdtemp(join(tmpdir(), "forgecode-app-git-"));
  const workspaceRoot = join(root, "sub");
  await mkdir(workspaceRoot);
  await runGit(root, ["init", "--quiet"]);
  await writeFile(join(workspaceRoot, "file.txt"), "user\n");

  try {
    process.chdir(workspaceRoot);
    const result = await runCli(["run", "inspect", "git", "state"]);

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Summary:/);
    assert.equal(result.stderr, "");
  } finally {
    process.chdir(originalCwd);
  }
});

test("requires a task for the run command", async () => {
  const result = await runCli(["run"]);

  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Missing task/);
  assert.match(result.stderr, /forgecode run/);
});
