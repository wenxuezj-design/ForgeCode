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
    key === "GIT_CEILING_DIRECTORIES" ||
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
  const records = stdout.split("\0");

  function addDirtyPath(repoRelativePath: string): void {
    const workspaceRelativePath = toWorkspaceRelativePath(repoRoot, cwd, repoRelativePath);

    if (workspaceRelativePath) {
      dirtyPaths.add(workspaceRelativePath);
    }
  }

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];

    if (!record) {
      continue;
    }

    const status = record.slice(0, 2);
    const repoRelativePath = record.slice(3);

    if (!repoRelativePath) {
      continue;
    }

    addDirtyPath(repoRelativePath);

    if (status.includes("R") || status.includes("C")) {
      const originalRepoRelativePath = records[index + 1];

      if (originalRepoRelativePath) {
        addDirtyPath(originalRepoRelativePath);
      }

      index += 1;
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

    const stdoutChunks: Buffer[] = [];
    let settled = false;

    function finish(exitCode: number): void {
      if (settled) {
        return;
      }

      settled = true;
      resolve({
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString("utf8")
      });
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    child.on("error", () => {
      finish(1);
    });

    child.on("close", (exitCode) => {
      finish(exitCode ?? 1);
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
      "--porcelain=v1",
      "-z",
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
