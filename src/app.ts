import { createAgentSession } from "./agent/session.js";

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

export function runCli(args: string[]): CliResult {
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

    const session = createAgentSession({ task });

    return {
      exitCode: 0,
      stdout: [
        "Session created.",
        `Task: ${session.task}`,
        "The agent loop is not implemented yet."
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
