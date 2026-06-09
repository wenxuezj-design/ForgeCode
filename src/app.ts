import { runTask } from "./core/run-task.js";
import type { RunSummaryEvidence, VerificationEvidence } from "./core/run-summary.js";
import type { RunTaskEvent } from "./core/run-task.js";
import { createModelProvider } from "./providers/model-provider.js";
import { createCommandTool } from "./tools/command-tool.js";
import { createToolRegistry } from "./tools/registry.js";
import { createSearchTextTool } from "./tools/search-tool.js";
import { createWorkspaceTools } from "./tools/workspace-tools.js";
import { readGitState } from "./workspace/git-state.js";
import { createWorkspace } from "./workspace/workspace.js";

const VERSION = "0.1.0";

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled run task event: ${JSON.stringify(value)}`);
}

export function renderVerification(verification: VerificationEvidence[]): string {
  if (verification.length === 0) {
    return "not recorded";
  }

  return verification
    .map((item) => {
      const exitCode = item.exitCode === undefined ? "" : ` (exit ${item.exitCode})`;

      return `${item.command}: ${item.passed ? "passed" : "failed"}${exitCode}`;
    })
    .join("; ");
}

function renderBlockedActions(evidence: RunSummaryEvidence): string {
  if (evidence.blockedActions.length === 0) {
    return "none";
  }

  return evidence.blockedActions
    .map((action) => {
      if (action.path) {
        return `${action.reason} (${action.path})`;
      }

      if (action.command) {
        return `${action.reason} (${action.command})`;
      }

      return action.reason;
    })
    .join("; ");
}

export function renderSummary(evidence: RunSummaryEvidence): string[] {
  return [
    "Summary:",
    `- Changes: ${evidence.modifiedFiles.length > 0 ? evidence.modifiedFiles.join(", ") : "not recorded"}`,
    `- Verification: ${renderVerification(evidence.verification)}`,
    `- Blocked: ${renderBlockedActions(evidence)}`,
    `- Risks: ${evidence.remainingRisks.length > 0 ? evidence.remainingRisks.join("; ") : "none"}`
  ];
}

export function renderRunEvent(event: RunTaskEvent): string | undefined {
  switch (event.type) {
    case "plan_started":
      return `Plan: ${event.message}`;
    case "todo_updated":
      return `Todo: ${event.todos.map((todo) => `${todo.status}:${todo.content}`).join(", ")}`;
    case "tool_started":
    case "tool_finished":
    case "approval_required":
    case "diff_available":
    case "verification_result":
      return `Progress: ${event.message}`;
    case "final_summary":
      return undefined;
    default:
      return assertNever(event);
  }
}

export function createWelcomeMessage(): string {
  return [
    "ForgeCode",
    "An open coding agent built from first principles.",
    "",
    "Run forgecode --help to see available commands."
  ].join("\n");
}

export function createHelpMessage(): string {
  return [
    "Usage: forgecode [command] [options]",
    "",
    "Commands:",
    "  run <task>    Create an agent session for a coding task",
    "  help          Show help information",
    "",
    "Options:",
    "  -h, --help     Show help information",
    "  -v, --version  Show the current version"
  ].join("\n");
}

export async function runCli(args: string[]): Promise<CliResult> {
  const [command] = args;

  if (command === "--version" || command === "-v") {
    return {
      exitCode: 0,
      stdout: `${VERSION}\n`,
      stderr: ""
    };
  }

  if (command === "--help" || command === "-h" || command === "help") {
    return {
      exitCode: 0,
      stdout: `${createHelpMessage()}\n`,
      stderr: ""
    };
  }

  if (command === "run") {
    const task = args.slice(1).join(" ").trim();

    if (!task) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: "Missing task. Usage: forgecode run <task>\n"
      };
    }

    const workspace = createWorkspace(process.cwd());
    const tools = createToolRegistry();
    const gitState = await readGitState(workspace.rootPath);
    const workspaceTools = createWorkspaceTools(workspace, {
      dirtyPathsAtStart: gitState.dirtyPaths
    });
    tools.register(workspaceTools.listFiles);
    tools.register(workspaceTools.readFile);
    tools.register(workspaceTools.writeFile);
    tools.register(createSearchTextTool(workspace));
    tools.register(createCommandTool({ cwd: workspace.rootPath }));
    const provider = createModelProvider({ name: "stub" });
    const progressLines: string[] = [];
    const result = await runTask({
      task,
      provider,
      tools,
      workspace,
      onEvent(event) {
        const line = renderRunEvent(event);

        if (line) {
          progressLines.push(line);
        }
      }
    });

    return {
      exitCode: result.exitCode,
      stdout: [
        `Task: ${task}`,
        ...progressLines,
        ...renderSummary(result.summaryEvidence),
        `Provider final: ${result.summary}`,
        `Trace events: ${result.trace.events.length}`
      ].join("\n") + "\n",
      stderr: ""
    };
  }

  if (command) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Unknown command: ${command}\nRun forgecode --help to see available commands.\n`
    };
  }

  return {
    exitCode: 0,
    stdout: `${createWelcomeMessage()}\n`,
    stderr: ""
  };
}
