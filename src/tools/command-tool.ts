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

interface RiskContext {
  env: Map<string, string>;
}

interface ParsedEnvCommand {
  command: string | undefined;
  args: string[];
  env: Map<string, string>;
}

const emptyRiskContext: RiskContext = { env: new Map() };

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

function normalizeCommandName(command: string): string {
  return command.split(/[\\/]/).filter(Boolean).at(-1) ?? command;
}

function normalizeCommandNameForRisk(command: string): string {
  const normalizedCommand = normalizeCommandName(command).toLowerCase();

  return normalizedCommand.endsWith(".exe")
    ? normalizedCommand.slice(0, -".exe".length)
    : normalizedCommand;
}

function hasForceFlag(args: string[]): boolean {
  return args.some(
    (arg) => arg === "-f" || arg === "--force" || arg.startsWith("--force=") || arg.startsWith("--force-")
  );
}

const shellCommands = new Set([
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "fish",
  "csh",
  "tcsh",
  "mksh",
  "yash",
  "ash",
  "pwsh",
  "powershell",
  "cmd"
]);
const destructiveCommands = new Set(["rm", "rmdir", "mv"]);

function isShellCommand(command: string): boolean {
  return shellCommands.has(normalizeCommandNameForRisk(command));
}

function isPowerShellCommand(command: string): boolean {
  const shellCommand = normalizeCommandNameForRisk(command);

  return shellCommand === "pwsh" || shellCommand === "powershell";
}

function hasShortOption(arg: string, option: string): boolean {
  return arg.startsWith("-") && !arg.startsWith("--") && arg.slice(1).includes(option);
}

function hasShellCommandStringOption(command: string, args: string[]): boolean {
  const powerShellCommand = isPowerShellCommand(command);

  return args.some((arg) => {
    const lowerArg = arg.toLowerCase();

    return (
      lowerArg === "-c" ||
      (lowerArg.startsWith("/") && (lowerArg.includes("/c") || lowerArg.includes("/k"))) ||
      lowerArg === "--command" ||
      lowerArg.startsWith("--command=") ||
      lowerArg === "--init-command" ||
      lowerArg.startsWith("--init-command=") ||
      lowerArg.startsWith("-command") ||
      lowerArg.startsWith("-encodedcommand") ||
      lowerArg.startsWith("-encodedarguments") ||
      (powerShellCommand && lowerArg === "-e") ||
      lowerArg === "-enc" ||
      lowerArg === "-ec" ||
      (arg.startsWith("-") && !arg.startsWith("--") && lowerArg.includes("c"))
    );
  });
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

function parseEnvCommand(
  args: string[],
  allowSplitString = true,
  inheritedEnv: Map<string, string> = new Map()
): ParsedEnvCommand {
  const optionsWithValues = new Set(["-u", "--unset", "-C", "--chdir", "-P", "--path", "-a", "--argv0"]);
  const env = new Map(inheritedEnv);
  let index = 0;

  while (index < args.length) {
    const arg = args[index];

    if (allowSplitString && (arg === "-S" || arg === "--split-string")) {
      const splitArgs = args[index + 1] ? splitEnvCommandString(args[index + 1]) : [];

      return parseEnvCommand([...splitArgs, ...args.slice(index + 2)], false, env);
    }

    if (allowSplitString && arg.startsWith("-") && !arg.startsWith("--")) {
      let optionIndex = 1;
      let shortOptionSkip = 1;
      let parsedShortOption = false;

      while (optionIndex < arg.length) {
        const option = arg[optionIndex];

        if (option === "S") {
          const splitValue = arg.slice(optionIndex + 1);
          const splitArgs = splitValue.length > 0
            ? splitEnvCommandString(splitValue)
            : splitEnvCommandString(args[index + 1] ?? "");
          const remainingArgs = splitValue.length > 0 ? args.slice(index + 1) : args.slice(index + 2);

          return parseEnvCommand([...splitArgs, ...remainingArgs], false, env);
        }

        parsedShortOption = true;

        if (option === "u" || option === "C" || option === "P" || option === "a") {
          shortOptionSkip = optionIndex + 1 < arg.length ? 1 : 2;
          break;
        }

        if (option === "i" || option === "0" || option === "v") {
          optionIndex += 1;
          continue;
        }

        parsedShortOption = false;
        break;
      }

      if (parsedShortOption) {
        index += shortOptionSkip;
        continue;
      }
    }

    if (allowSplitString && arg.startsWith("--split-string=")) {
      const splitArgs = splitEnvCommandString(arg.slice("--split-string=".length));

      return parseEnvCommand([...splitArgs, ...args.slice(index + 1)], false, env);
    }

    if (optionsWithValues.has(arg)) {
      index += 2;
      continue;
    }

    if (
      arg.startsWith("--unset=") ||
      arg.startsWith("--chdir=") ||
      arg.startsWith("--path=") ||
      arg.startsWith("--argv0=")
    ) {
      index += 1;
      continue;
    }

    if (arg.startsWith("-")) {
      index += 1;
      continue;
    }

    if (arg.length > 0 && arg.includes("=")) {
      const equalsIndex = arg.indexOf("=");

      if (equalsIndex > 0) {
        env.set(arg.slice(0, equalsIndex), arg.slice(equalsIndex + 1));
      }

      index += 1;
      continue;
    }

    return {
      command: arg,
      args: args.slice(index + 1),
      env
    };
  }

  return {
    command: undefined,
    args: [],
    env
  };
}

function isDestructiveEnvWrappedCommand(args: string[], depth = 0, context = emptyRiskContext): boolean {
  if (depth >= 8) {
    return true;
  }

  const envCommand = parseEnvCommand(args, true, context.env);
  if (envCommand.command === undefined) {
    return false;
  }

  return isDestructiveCommand(envCommand.command, envCommand.args, depth + 1, { env: envCommand.env });
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

function isGitAliasConfigKey(value: string): boolean {
  const normalizedValue = value.toLowerCase();

  return normalizedValue.startsWith("alias.") && normalizedValue.length > "alias.".length;
}

function isGitBangAliasConfig(value: string): boolean {
  const equalsIndex = value.indexOf("=");

  if (equalsIndex === -1) {
    return false;
  }

  return isGitAliasConfigKey(value.slice(0, equalsIndex)) && value.slice(equalsIndex + 1).trimStart().startsWith("!");
}

function getRiskEnvValue(name: string, context: RiskContext): string | undefined {
  return context.env.get(name) ?? process.env[name];
}

function isGitBangAliasConfigEnv(value: string, context: RiskContext): boolean {
  const equalsIndex = value.indexOf("=");

  if (equalsIndex === -1) {
    return false;
  }

  const envValue = getRiskEnvValue(value.slice(equalsIndex + 1), context) ?? "";

  return isGitAliasConfigKey(value.slice(0, equalsIndex)) && envValue.trimStart().startsWith("!");
}

function hasDestructiveGitConfigCountAlias(context: RiskContext): boolean {
  const countValue = getRiskEnvValue("GIT_CONFIG_COUNT", context);
  const count = Number.parseInt(countValue ?? "", 10);

  if (!Number.isSafeInteger(count) || count <= 0) {
    return false;
  }

  for (let index = 0; index < count; index += 1) {
    const key = getRiskEnvValue(`GIT_CONFIG_KEY_${index}`, context) ?? "";
    const value = getRiskEnvValue(`GIT_CONFIG_VALUE_${index}`, context) ?? "";

    if (isGitAliasConfigKey(key) && value.trimStart().startsWith("!")) {
      return true;
    }
  }

  return false;
}

function hasDestructiveGitAliasConfig(args: string[], context: RiskContext): boolean {
  if (hasDestructiveGitConfigCountAlias(context)) {
    return true;
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "-c") {
      const config = args[index + 1] ?? "";
      const splitValue = args[index + 2] ?? "";

      if (isGitBangAliasConfig(config) || (isGitAliasConfigKey(config) && splitValue.trimStart().startsWith("!"))) {
        return true;
      }

      index += 1;
      continue;
    }

    if (arg.startsWith("-c") && arg.length > 2 && isGitBangAliasConfig(arg.slice(2))) {
      return true;
    }

    if (arg === "--config-env") {
      if (isGitBangAliasConfigEnv(args[index + 1] ?? "", context)) {
        return true;
      }

      index += 1;
      continue;
    }

    if (arg.startsWith("--config-env=") && isGitBangAliasConfigEnv(arg.slice("--config-env=".length), context)) {
      return true;
    }
  }

  return false;
}

function isDestructiveGitCommand(args: string[], context: RiskContext): boolean {
  const destructiveSubcommands = new Set(["reset", "clean", "checkout", "restore", "rm", "switch"]);

  if (hasDestructiveGitAliasConfig(args, context)) {
    return true;
  }

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

  if (subcommand === "tag") {
    return subcommandArgs.some(
      (arg) =>
        arg === "-d" ||
        arg === "--delete" ||
        (arg.startsWith("-") && !arg.startsWith("--") && (arg.includes("d") || arg.includes("D")))
    );
  }

  if (subcommand === "push") {
    return subcommandArgs.some(
      (arg) =>
        arg === "--delete" ||
        arg === "-d" ||
        arg === "-D" ||
        arg === "--mirror" ||
        arg === "--prune" ||
        arg === "--force" ||
        arg.startsWith("--force=") ||
        arg.startsWith("--force-") ||
        arg.startsWith(":") ||
        arg.startsWith("+") ||
        hasShortOption(arg, "d") ||
        hasShortOption(arg, "D") ||
        hasShortOption(arg, "f")
    );
  }

  return false;
}

function isDestructiveCommand(command: string, args: string[], envDepth = 0, context = emptyRiskContext): boolean {
  const normalizedCommand = normalizeCommandNameForRisk(command);

  if (isShellCommand(normalizedCommand) && hasShellCommandStringOption(normalizedCommand, args)) {
    return true;
  }

  if (normalizedCommand === "env") {
    return isDestructiveEnvWrappedCommand(args, envDepth, context);
  }

  if (normalizedCommand === "git" && isDestructiveGitCommand(args, context)) {
    return true;
  }

  return destructiveCommands.has(normalizedCommand) || hasForceFlag(args);
}

function isSafeGitCommand(args: string[]): boolean {
  return args[0] === "status" && (args.length === 1 || (args.length === 2 && args[1] === "--short"));
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
  if (isDestructiveCommand(command, args)) {
    return "destructive";
  }

  if (command === "node" && isSafeNodeCommand(args)) {
    return "safe";
  }

  if (command === "npm" && isSafeNpmCommand(args)) {
    return "safe";
  }

  if (command === "git" && isSafeGitCommand(args)) {
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
