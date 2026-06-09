import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunSummaryEvidence } from "../core/run-summary.js";
import { runTask } from "../core/run-task.js";
import type { AgentAction } from "../providers/model-provider.js";
import { createScriptedProvider } from "../providers/scripted-provider.js";
import { createCommandTool } from "../tools/command-tool.js";
import { createToolRegistry } from "../tools/registry.js";
import { createSearchTextTool } from "../tools/search-tool.js";
import { createWorkspaceTools } from "../tools/workspace-tools.js";
import { createWorkspace } from "../workspace/workspace.js";

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

export interface MicroBenchmarkResult {
  id: string;
  passed: boolean;
  verificationOutput: string;
}

type MicroBenchmarkTaskFileEntry = Omit<MicroBenchmarkTask, "workspaceRoot"> & {
  workspaceRoot?: string;
};

function dirtyPathsAtStartForTask(task: MicroBenchmarkTask): Set<string> | undefined {
  return task.id === "dirty-protection" ? new Set(["README.md"]) : undefined;
}

function hasSummaryField(evidence: RunSummaryEvidence, field: string): boolean {
  const value = (evidence as unknown as Record<string, unknown>)[field];

  if (value === undefined || value === null) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }

  return true;
}

function collectExpectationFailures(
  traceEvents: string[],
  summaryEvidence: RunSummaryEvidence,
  expectations: MicroBenchmarkExpectations | undefined
): string[] {
  const failures: string[] = [];
  const traceEventSet = new Set(traceEvents);

  for (const expectedEvent of expectations?.traceEvents ?? []) {
    if (!traceEventSet.has(expectedEvent)) {
      failures.push(`missing trace event: ${expectedEvent}`);
    }
  }

  for (const summaryField of expectations?.summaryFields ?? []) {
    if (!hasSummaryField(summaryEvidence, summaryField)) {
      failures.push(`missing summary evidence: ${summaryField}`);
    }
  }

  return failures;
}

async function runScriptedBenchmarkTask(task: MicroBenchmarkTask): Promise<MicroBenchmarkResult> {
  const workspace = createWorkspace(task.workspaceRoot);
  const tools = createToolRegistry();
  const workspaceTools = createWorkspaceTools(workspace, {
    dirtyPathsAtStart: dirtyPathsAtStartForTask(task)
  });

  tools.register(workspaceTools.listFiles);
  tools.register(workspaceTools.readFile);
  tools.register(workspaceTools.writeFile);
  tools.register(createSearchTextTool(workspace));
  tools.register(createCommandTool({ cwd: task.workspaceRoot }));

  const result = await runTask({
    task: task.task,
    provider: createScriptedProvider(task.script ?? []),
    tools,
    workspace,
    maxSteps: Math.max((task.script?.length ?? 0) + 2, 10)
  });
  const traceEvents = result.trace.events.map((event) => event.type);
  const expectationFailures = collectExpectationFailures(
    traceEvents,
    result.summaryEvidence,
    task.expectations
  );
  const verificationOutput = [
    `exitCode=${result.exitCode}`,
    `traceEvents: ${traceEvents.join(",")}`,
    `summaryFields: ${Object.keys(result.summaryEvidence).join(",")}`,
    `summaryEvidence: ${JSON.stringify(result.summaryEvidence)}`,
    expectationFailures.length > 0
      ? `expectationFailures: ${expectationFailures.join("; ")}`
      : "expectationFailures: none"
  ].join("\n");

  return {
    id: task.id,
    passed: result.exitCode === 0 && expectationFailures.length === 0,
    verificationOutput
  };
}

export async function runMicroBenchmarkTask(task: MicroBenchmarkTask): Promise<MicroBenchmarkResult> {
  if (task.script) {
    return runScriptedBenchmarkTask(task);
  }

  if (!task.verification) {
    return {
      id: task.id,
      passed: false,
      verificationOutput: "Missing verification command or scripted benchmark actions."
    };
  }

  const commandTool = createCommandTool({ cwd: task.workspaceRoot });
  const verification = await commandTool.execute(task.verification);

  return {
    id: task.id,
    passed: verification.content.startsWith("exitCode=0"),
    verificationOutput: verification.content
  };
}

async function loadMicroBenchmarkTasks(path: string, defaultWorkspaceRoot: string): Promise<MicroBenchmarkTask[]> {
  const content = await readFile(path, "utf8");
  const entries = JSON.parse(content) as MicroBenchmarkTaskFileEntry[];

  return entries.map((entry) => ({
    ...entry,
    workspaceRoot: entry.workspaceRoot ? resolve(defaultWorkspaceRoot, entry.workspaceRoot) : defaultWorkspaceRoot
  }));
}

async function main(): Promise<void> {
  const workspaceRoot = process.cwd();
  const taskPath = resolve(workspaceRoot, "benchmarks/micro/tasks.json");
  const tasks = await loadMicroBenchmarkTasks(taskPath, workspaceRoot);
  const results = [];

  for (const task of tasks) {
    results.push(await runMicroBenchmarkTask(task));
  }

  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  process.exitCode = results.every((result) => result.passed) ? 0 : 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
const currentPath = fileURLToPath(import.meta.url);

if (invokedPath === currentPath) {
  await main();
}
