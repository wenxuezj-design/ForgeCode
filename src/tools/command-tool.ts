import { spawn } from "node:child_process";
import type { Tool, ToolResult } from "./registry.js";

export type ApprovalPolicy = "never" | "allow-safe" | "allow-all";
export type CommandRisk = "safe" | "unknown" | "destructive";

export interface CreateCommandToolOptions {
  cwd: string;
  approvalPolicy?: ApprovalPolicy;
}

interface CommandInput {
  command: string;
  args: string[];
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

function hasForceFlag(args: string[]): boolean {
  return args.some(
    (arg) => arg === "-f" || arg === "--force" || arg.startsWith("--force=") || arg.startsWith("--force-")
  );
}

function parseGitCommand(args: string[]): { subcommand: string | undefined; subcommandArgs: string[] } {
  const globalOptionsWithValues = new Set([
    "-C",
    "-c",
    "--config-env",
    "--exec-path",
    "--git-dir",
    "--namespace",
    "--super-prefix",
    "--work-tree"
  ]);
  let index = 0;

  while (index < args.length) {
    const arg = args[index];

    if (globalOptionsWithValues.has(arg)) {
      index += 2;
      continue;
    }

    if (
      arg.startsWith("--config-env=") ||
      arg.startsWith("--exec-path=") ||
      arg.startsWith("--git-dir=") ||
      arg.startsWith("--namespace=") ||
      arg.startsWith("--super-prefix=") ||
      arg.startsWith("--work-tree=")
    ) {
      index += 1;
      continue;
    }

    if (arg.startsWith("-")) {
      index += 1;
      continue;
    }

    return {
      subcommand: arg,
      subcommandArgs: args.slice(index + 1)
    };
  }

  return {
    subcommand: undefined,
    subcommandArgs: []
  };
}

function isDestructiveGitCommand(args: string[]): boolean {
  const destructiveSubcommands = new Set(["reset", "clean", "checkout", "restore", "rm", "switch"]);
  const { subcommand, subcommandArgs } = parseGitCommand(args);

  if (subcommand === undefined) {
    return false;
  }

  if (destructiveSubcommands.has(subcommand)) {
    return true;
  }

  if (subcommand === "branch") {
    return subcommandArgs.some(
      (arg) =>
        arg === "-D" ||
        arg === "-d" ||
        arg === "--delete" ||
        (arg.startsWith("-") && !arg.startsWith("--") && (arg.includes("d") || arg.includes("D")))
    );
  }

  if (subcommand === "push") {
    return subcommandArgs.some((arg) => arg === "--delete" || arg.startsWith(":"));
  }

  return false;
}

function classifyCommand(command: string, args: string[]): CommandRisk {
  const destructiveCommands = new Set(["rm", "rmdir", "mv"]);

  if (command === "git" && isDestructiveGitCommand(args)) {
    return "destructive";
  }

  if (destructiveCommands.has(command) || hasForceFlag(args)) {
    return "destructive";
  }

  if (command === "npm" || command === "node" || command === "tsc" || command === "npx") {
    return "safe";
  }

  return "unknown";
}

function commandResult(
  risk: CommandRisk,
  formattedCommand: string,
  exitCode: number,
  stdout: string,
  stderr: string,
  approvalPolicy?: ApprovalPolicy
): ToolResult {
  const content = [
    `exitCode=${exitCode}`,
    `stdout=${stdout.trim()}`,
    `stderr=${stderr.trim()}`
  ].join("\n");

  return {
    success: exitCode === 0,
    content,
    metadata: {
      risk,
      ...(approvalPolicy ? { approval: { policy: approvalPolicy } } : {}),
      verification: {
        command: formattedCommand,
        exitCode,
        passed: exitCode === 0,
        output: content
      }
    }
  };
}

function parseCommandInput(input: unknown): CommandInput {
  if (!input || typeof input !== "object") {
    throw new Error("Command input must be an object");
  }

  const record = input as Record<string, unknown>;
  const command = record.command;
  const args = record.args ?? [];

  if (typeof command !== "string") {
    throw new Error("Missing string input: command");
  }

  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    throw new Error("args must be an array of strings");
  }

  return {
    command,
    args
  };
}

export function createCommandTool(options: CreateCommandToolOptions): Tool {
  return {
    name: "run_command",
    description: "Run a command in the workspace and capture output.",
    async execute(input) {
      const { command, args } = parseCommandInput(input);
      const approvalPolicy = options.approvalPolicy ?? "never";
      const risk = classifyCommand(command, args);
      const formattedCommand = formatCommand(command, args);
      const auditedApprovalPolicy = risk === "destructive" && approvalPolicy === "allow-all"
        ? approvalPolicy
        : undefined;

      if (risk === "destructive" && approvalPolicy !== "allow-all") {
        return {
          success: false,
          content: `Command requires approval: ${formattedCommand}`,
          metadata: {
            risk,
            blockedAction: {
              kind: "approval",
              reason: "Destructive command requires approval.",
              command: formattedCommand
            }
          }
        };
      }

      return new Promise((resolve) => {
        const child = spawn(command, args, {
          cwd: options.cwd,
          shell: false
        });
        let stdout = "";
        let stderr = "";
        let settled = false;
        const settle = (result: ToolResult) => {
          if (settled) {
            return;
          }

          settled = true;
          resolve(result);
        };

        child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.on("error", (error: Error) => {
          settle(commandResult(risk, formattedCommand, 1, stdout, error.message, auditedApprovalPolicy));
        });
        child.on("close", (exitCode) => {
          const actualExitCode = exitCode ?? 1;

          settle(commandResult(risk, formattedCommand, actualExitCode, stdout, stderr, auditedApprovalPolicy));
        });
      });
    }
  };
}
