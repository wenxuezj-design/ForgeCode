import { spawn } from "node:child_process";
import type { Tool } from "./registry.js";

export interface CreateCommandToolOptions {
  cwd: string;
}

interface CommandInput {
  command: string;
  args: string[];
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

      return new Promise((resolve, reject) => {
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
        child.on("error", reject);
        child.on("close", (exitCode) => {
          resolve({
            content: [
              `exitCode=${exitCode ?? 1}`,
              `stdout=${stdout.trim()}`,
              `stderr=${stderr.trim()}`
            ].join("\n")
          });
        });
      });
    }
  };
}
