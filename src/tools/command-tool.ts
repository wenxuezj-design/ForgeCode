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

function classifyCommand(command: string, args: string[]): CommandRisk {
  const destructiveCommands = new Set(["rm", "rmdir"]);

  if (command === "git" && ["reset", "clean", "checkout"].includes(args[0] ?? "")) {
    return "destructive";
  }

  if (destructiveCommands.has(command) || args.includes("--force") || args.includes("-f")) {
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
  stderr: string
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

        child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.on("error", (error: Error) => {
          resolve(commandResult(risk, formattedCommand, 1, stdout, error.message));
        });
        child.on("close", (exitCode) => {
          const actualExitCode = exitCode ?? 1;

          resolve(commandResult(risk, formattedCommand, actualExitCode, stdout, stderr));
        });
      });
    }
  };
}
