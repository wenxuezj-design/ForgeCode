import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

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

function parseDirtyPaths(stdout: string): Set<string> {
  const dirtyPaths = new Set<string>();

  for (const line of stdout.split(/\r?\n/)) {
    const path = parseDirtyPath(line);

    if (path) {
      dirtyPaths.add(path);
    }
  }

  return dirtyPaths;
}

export async function readGitState(cwd: string): Promise<GitState> {
  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams;

    try {
      child = spawn("git", ["status", "--porcelain"], { cwd, shell: false });
    } catch {
      resolve(emptyGitState());
      return;
    }

    let stdout = "";
    let settled = false;

    function finish(state: GitState): void {
      if (settled) {
        return;
      }

      settled = true;
      resolve(state);
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.on("error", () => {
      finish(emptyGitState());
    });

    child.on("close", (exitCode) => {
      if (exitCode !== 0) {
        finish(emptyGitState());
        return;
      }

      finish({
        available: true,
        dirtyPaths: parseDirtyPaths(stdout)
      });
    });
  });
}
