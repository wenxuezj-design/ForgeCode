import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";

export interface GitState {
  available: boolean;
  dirtyPaths: Set<string>;
}

function emptyGitState(): GitState {
  return {
    available: false,
    dirtyPaths: new Set()
  };
}

function conservativeGitState(): GitState {
  return {
    available: true,
    dirtyPaths: new Set(["."])
  };
}

function shouldClearGitEnv(key: string): boolean {
  return (
    key === "GIT_DIR" ||
    key === "GIT_WORK_TREE" ||
    key === "GIT_INDEX_FILE" ||
    key === "GIT_CONFIG" ||
    key.startsWith("GIT_CONFIG_")
  );
}

function safeGitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !shouldClearGitEnv(key)) {
      env[key] = value;
    }
  }

  return env;
}

function unquoteGitPath(path: string): string {
  if (!path.startsWith("\"") || !path.endsWith("\"")) {
    return path;
  }

  try {
    return JSON.parse(path) as string;
  } catch {
    return path.slice(1, -1);
  }
}

function parseDirtyPath(line: string): string | undefined {
  const path = line.slice(3).trim();

  if (!path) {
    return undefined;
  }

  const renameSeparator = " -> ";
  const finalPath = path.includes(renameSeparator)
    ? path.slice(path.lastIndexOf(renameSeparator) + renameSeparator.length)
    : path;

  return unquoteGitPath(finalPath);
}

function normalizeGitPath(path: string): string {
  return path.replace(/\\/g, "/");
}

function isOutsideWorkspace(relativePath: string): boolean {
  return relativePath === ".." || relativePath.startsWith("../") || resolve(relativePath) === relativePath;
}

function toWorkspaceRelativePath(repoRoot: string, cwd: string, repoRelativePath: string): string | undefined {
  const isDirectoryPrefix = repoRelativePath.endsWith("/");
  const absolutePath = resolve(repoRoot, repoRelativePath);
  const relativePath = normalizeGitPath(relative(cwd, absolutePath));

  if (isOutsideWorkspace(relativePath)) {
    return undefined;
  }

  if (relativePath === "") {
    return ".";
  }

  return isDirectoryPrefix && !relativePath.endsWith("/") ? `${relativePath}/` : relativePath;
}

function parseDirtyPaths(stdout: string, repoRoot: string, cwd: string): Set<string> {
  const dirtyPaths = new Set<string>();

  for (const line of stdout.split(/\r?\n/)) {
    const repoRelativePath = parseDirtyPath(line);

    if (!repoRelativePath) {
      continue;
    }

    const workspaceRelativePath = toWorkspaceRelativePath(repoRoot, cwd, repoRelativePath);

    if (workspaceRelativePath) {
      dirtyPaths.add(workspaceRelativePath);
    }
  }

  return dirtyPaths;
}

interface GitCommandResult {
  exitCode: number;
  stdout: string;
}

async function runGit(cwd: string, args: string[], env: NodeJS.ProcessEnv): Promise<GitCommandResult> {
  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams;

    try {
      child = spawn("git", args, { cwd, env, shell: false });
    } catch {
      resolve({ exitCode: 1, stdout: "" });
      return;
    }

    let stdout = "";
    let settled = false;

    function finish(result: GitCommandResult): void {
      if (settled) {
        return;
      }

      settled = true;
      resolve(result);
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.on("error", () => {
      finish({ exitCode: 1, stdout });
    });

    child.on("close", (exitCode) => {
      finish({ exitCode: exitCode ?? 1, stdout });
    });
  });
}

export async function readGitState(cwd: string): Promise<GitState> {
  const absoluteCwd = await realpath(cwd).catch(() => resolve(cwd));
  const env = safeGitEnv();
  const repoRootResult = await runGit(absoluteCwd, ["rev-parse", "--show-toplevel"], env);

  if (repoRootResult.exitCode !== 0) {
    return emptyGitState();
  }

  const repoRootPath = repoRootResult.stdout.trim();

  if (!repoRootPath) {
    return emptyGitState();
  }

  const repoRoot = await realpath(repoRootPath).catch(() => resolve(repoRootPath));

  const statusResult = await runGit(
    repoRoot,
    [
      "-c",
      "core.fsmonitor=",
      "-c",
      "core.untrackedCache=false",
      "status",
      "--porcelain",
      "--untracked-files=all"
    ],
    env
  );

  if (statusResult.exitCode !== 0) {
    return conservativeGitState();
  }

  return {
    available: true,
    dirtyPaths: parseDirtyPaths(statusResult.stdout, repoRoot, absoluteCwd)
  };
}
