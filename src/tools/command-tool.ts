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

function normalizeCommandName(command: string): string {
  return command.split(/[\\/]/).filter(Boolean).at(-1) ?? command;
}

function hasForceFlag(args: string[]): boolean {
  return args.some(
    (arg) => arg === "-f" || arg === "--force" || arg.startsWith("--force=") || arg.startsWith("--force-")
  );
}

function isShellCommand(command: string): boolean {
  return command === "sh" || command === "bash" || command === "zsh";
}

function hasShellCommandStringOption(args: string[]): boolean {
  return args.some((arg) => arg === "-c" || (arg.startsWith("-") && !arg.startsWith("--") && arg.includes("c")));
}

function splitEnvCommandString(value: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | undefined;
  let escaped = false;

  for (const char of value) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }

      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }

      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function parseEnvCommand(args: string[]): { command: string | undefined; args: string[] } {
  let index = 0;

  while (index < args.length) {
    const arg = args[index];

    if (arg === "-S" || arg === "--split-string") {
      const splitArgs = args[index + 1] ? splitEnvCommandString(args[index + 1]) : [];

      return {
        command: splitArgs[0],
        args: [...splitArgs.slice(1), ...args.slice(index + 2)]
      };
    }

    if (arg.startsWith("--split-string=")) {
      const splitArgs = splitEnvCommandString(arg.slice("--split-string=".length));

      return {
        command: splitArgs[0],
        args: [...splitArgs.slice(1), ...args.slice(index + 1)]
      };
    }

    if (arg === "-u" || arg === "--unset") {
      index += 2;
      continue;
    }

    if (arg.startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(arg)) {
      index += 1;
      continue;
    }

    return {
      command: arg,
      args: args.slice(index + 1)
    };
  }

  return {
    command: undefined,
    args: []
  };
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

function isSafeGitCommand(args: string[]): boolean {
  return (
    args[0] === "status" &&
    args.slice(1).every((arg) => arg === "--short" || arg === "--porcelain" || arg === "-s")
  );
}

function isSafeNpmCommand(args: string[]): boolean {
  return (
    (args.length === 1 && args[0] === "test") ||
    (args.length === 2 && args[0] === "run" && (args[1] === "typecheck" || args[1] === "build"))
  );
}

function isSafeNodeCommand(args: string[]): boolean {
  return args.length === 1 && args[0] === "--version";
}

function classifyCommand(command: string, args: string[]): CommandRisk {
  const destructiveCommands = new Set(["rm", "rmdir", "mv"]);
  const normalizedCommand = normalizeCommandName(command);

  if (isShellCommand(normalizedCommand) && hasShellCommandStringOption(args)) {
    return "destructive";
  }

  if (normalizedCommand === "env") {
    const envCommand = parseEnvCommand(args);
    const normalizedEnvCommand = envCommand.command ? normalizeCommandName(envCommand.command) : undefined;

    if (normalizedEnvCommand && isShellCommand(normalizedEnvCommand) && hasShellCommandStringOption(envCommand.args)) {
      return "destructive";
    }
  }

  if (normalizedCommand === "git" && isDestructiveGitCommand(args)) {
    return "destructive";
  }

  if (destructiveCommands.has(normalizedCommand) || hasForceFlag(args)) {
    return "destructive";
  }

  if (normalizedCommand === "node" && isSafeNodeCommand(args)) {
    return "safe";
  }

  if (normalizedCommand === "npm" && isSafeNpmCommand(args)) {
    return "safe";
  }

  if (normalizedCommand === "git" && isSafeGitCommand(args)) {
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

      if (approvalPolicy === "allow-safe" && risk !== "safe") {
        return {
          success: false,
          content: `Command requires approval: ${formattedCommand}`,
          metadata: {
            risk,
            blockedAction: {
              kind: "approval",
              reason: "Command risk is not safe.",
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
