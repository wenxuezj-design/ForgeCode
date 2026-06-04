import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCommandTool } from "../tools/command-tool.js";

export interface MicroBenchmarkTask {
  id: string;
  task: string;
  workspaceRoot: string;
  verification: {
    command: string;
    args: string[];
  };
}

export interface MicroBenchmarkResult {
  id: string;
  passed: boolean;
  verificationOutput: string;
}

type MicroBenchmarkTaskFileEntry = Omit<MicroBenchmarkTask, "workspaceRoot"> & {
  workspaceRoot?: string;
};

export async function runMicroBenchmarkTask(task: MicroBenchmarkTask): Promise<MicroBenchmarkResult> {
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
