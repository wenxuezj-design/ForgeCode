import { runTask } from "./core/run-task.js";
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
    const result = await runTask({ task, provider, tools, workspace });

    return {
      exitCode: result.exitCode,
      stdout: [
        "Task complete.",
        `Task: ${task}`,
        `Summary: ${result.summary}`,
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
