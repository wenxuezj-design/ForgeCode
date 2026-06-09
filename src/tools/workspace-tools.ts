import { existsSync, realpathSync, statSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import {
  createOmittedTextDiff,
  createTextDiff,
  MAX_DETAILED_DIFF_CHARS
} from "../workspace/diff.js";
import type { Workspace } from "../workspace/workspace.js";
import type { Tool, ToolResult } from "./registry.js";

export interface WorkspaceTools {
  listFiles: Tool;
  readFile: Tool;
  writeFile: Tool;
}

export interface CreateWorkspaceToolsOptions {
  dirtyPathsAtStart?: Set<string>;
}

function readStringInput(input: unknown, key: string): string {
  if (!input || typeof input !== "object") {
    throw new Error(`Missing string input: ${key}`);
  }

  const value = (input as Record<string, unknown>)[key];

  if (typeof value !== "string") {
    throw new Error(`Missing string input: ${key}`);
  }

  return value;
}

function normalizeWorkspacePath(path: string): string {
  const normalized = path
    .replace(/\\/g, "/")
    .split(sep)
    .join("/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "");

  return normalized === "" ? "." : normalized;
}

function workspaceRelativePath(workspace: Workspace, absolutePath: string): string {
  return normalizeWorkspacePath(relative(workspace.resolvePath("."), absolutePath));
}

function normalizeAbsolutePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function dirtyPathForResolve(path: string): string {
  if (path === ".") {
    return ".";
  }

  return path.endsWith("/") ? path.slice(0, -1) : path;
}

function realPathForExistingPath(absolutePath: string): string | undefined {
  try {
    return normalizeAbsolutePath(realpathSync.native(absolutePath));
  } catch {
    return undefined;
  }
}

function realPathThroughNearestExistingAncestor(absolutePath: string): string | undefined {
  let currentPath = absolutePath;
  const missingParts: string[] = [];

  while (true) {
    const realPath = realPathForExistingPath(currentPath);

    if (realPath) {
      return normalizeAbsolutePath(join(realPath, ...missingParts.reverse()));
    }

    const parentPath = dirname(currentPath);

    if (parentPath === currentPath) {
      return undefined;
    }

    missingParts.push(basename(currentPath));
    currentPath = parentPath;
  }
}

function fileIdentityForExistingPath(absolutePath: string): string | undefined {
  try {
    const stats = statSync(absolutePath);

    return `${stats.dev}:${stats.ino}`;
  } catch {
    return undefined;
  }
}

function isExistingDirectory(absolutePath: string): boolean {
  try {
    return statSync(absolutePath).isDirectory();
  } catch {
    return false;
  }
}

function withTrailingSlash(path: string): string {
  return path.endsWith("/") ? path : `${path}/`;
}

function isRealPathInsideRoot(rootRealPath: string, targetRealPath: string): boolean {
  const normalizedRoot = normalizeAbsolutePath(rootRealPath);
  const normalizedTarget = normalizeAbsolutePath(targetRealPath);

  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(withTrailingSlash(normalizedRoot));
}

function assertResolvedPathInsideWorkspace(rootRealPath: string, absolutePath: string, requestedPath: string): void {
  const targetRealPath = realPathThroughNearestExistingAncestor(absolutePath);

  if (!targetRealPath || !isRealPathInsideRoot(rootRealPath, targetRealPath)) {
    throw new Error(`Path resolves outside the workspace: ${requestedPath}`);
  }
}

interface DirtyPathSnapshot {
  paths: Set<string>;
  fileIdentities: Set<string>;
  realPaths: Set<string>;
  realPathPrefixes: Set<string>;
}

function createDirtyPathSnapshot(
  workspace: Workspace,
  dirtyPaths: Set<string> | undefined
): DirtyPathSnapshot {
  const snapshot: DirtyPathSnapshot = {
    paths: new Set(),
    fileIdentities: new Set(),
    realPaths: new Set(),
    realPathPrefixes: new Set()
  };

  for (const dirtyPath of dirtyPaths ?? new Set<string>()) {
    const normalizedDirtyPath = normalizeWorkspacePath(dirtyPath);
    snapshot.paths.add(normalizedDirtyPath);

    try {
      const absoluteDirtyPath = workspace.resolvePath(dirtyPathForResolve(normalizedDirtyPath));
      const realDirtyPath = realPathForExistingPath(absoluteDirtyPath);
      const dirtyFileIdentity = fileIdentityForExistingPath(absoluteDirtyPath);

      if (dirtyFileIdentity) {
        snapshot.fileIdentities.add(dirtyFileIdentity);
      }

      if (!realDirtyPath) {
        continue;
      }

      snapshot.realPaths.add(realDirtyPath);

      if (
        normalizedDirtyPath === "." ||
        normalizedDirtyPath.endsWith("/") ||
        isExistingDirectory(absoluteDirtyPath)
      ) {
        snapshot.realPathPrefixes.add(withTrailingSlash(realDirtyPath));
      }
    } catch {
      continue;
    }
  }

  return snapshot;
}

function hasDirtyPath(snapshot: DirtyPathSnapshot, path: string, absolutePath: string): boolean {
  const normalizedPath = normalizeWorkspacePath(path);

  for (const dirtyPath of snapshot.paths) {
    const normalizedDirtyPath = normalizeWorkspacePath(dirtyPath);

    if (normalizedDirtyPath === "." || normalizedDirtyPath === normalizedPath) {
      return true;
    }

    if (normalizedDirtyPath.endsWith("/") && normalizedPath.startsWith(normalizedDirtyPath)) {
      return true;
    }

    if (normalizedPath.startsWith(`${normalizedDirtyPath}/`)) {
      return true;
    }
  }

  const fileIdentity = fileIdentityForExistingPath(absolutePath);

  if (fileIdentity && snapshot.fileIdentities.has(fileIdentity)) {
    return true;
  }

  const realPath = realPathThroughNearestExistingAncestor(absolutePath);

  if (realPath) {
    if (snapshot.realPaths.has(realPath)) {
      return true;
    }

    for (const realPathPrefix of snapshot.realPathPrefixes) {
      if (realPath.startsWith(realPathPrefix)) {
        return true;
      }
    }
  }

  return false;
}

function hasWrittenPath(
  writtenPaths: Set<string>,
  writtenRealPaths: Set<string>,
  writtenFileIdentities: Set<string>,
  path: string,
  absolutePath: string
): boolean {
  if (writtenPaths.has(path)) {
    return true;
  }

  const realPath = realPathForExistingPath(absolutePath);

  if (realPath !== undefined && writtenRealPaths.has(realPath)) {
    return true;
  }

  const fileIdentity = fileIdentityForExistingPath(absolutePath);

  return fileIdentity !== undefined && writtenFileIdentities.has(fileIdentity);
}

async function createDiffBeforeWrite(
  absolutePath: string,
  workspacePath: string,
  content: string
): Promise<string> {
  const fileExists = existsSync(absolutePath);
  const afterSizeBytes = Buffer.byteLength(content, "utf8");

  if (fileExists) {
    const beforeStats = await stat(absolutePath);

    if (beforeStats.size + afterSizeBytes > MAX_DETAILED_DIFF_CHARS) {
      return createOmittedTextDiff({
        path: workspacePath,
        beforeSizeBytes: beforeStats.size,
        afterSizeBytes
      });
    }

    const before = await readFile(absolutePath, "utf8");

    return createTextDiff({ path: workspacePath, before, after: content });
  }

  if (afterSizeBytes > MAX_DETAILED_DIFF_CHARS) {
    return createOmittedTextDiff({
      path: workspacePath,
      isNewFile: true,
      beforeSizeBytes: 0,
      afterSizeBytes
    });
  }

  return createTextDiff({ path: workspacePath, before: "", after: content, isNewFile: true });
}

export function createWorkspaceTools(
  workspace: Workspace,
  options: CreateWorkspaceToolsOptions = {}
): WorkspaceTools {
  const rootAbsolutePath = workspace.resolvePath(".");
  const rootRealPath = realPathForExistingPath(rootAbsolutePath) ?? normalizeAbsolutePath(rootAbsolutePath);
  const dirtyPathsAtStart = createDirtyPathSnapshot(workspace, options.dirtyPathsAtStart);
  const writtenPaths = new Set<string>();
  const writtenRealPaths = new Set<string>();
  const writtenFileIdentities = new Set<string>();

  return {
    listFiles: {
      name: "list_files",
      description: "List files in the workspace root.",
      async execute() {
        const entries = await readdir(workspace.rootPath);

        return {
          content: entries.sort().join("\n")
        };
      }
    },
    readFile: {
      name: "read_file",
      description: "Read a UTF-8 file from the workspace.",
      async execute(input) {
        const path = readStringInput(input, "path");
        const absolutePath = workspace.resolvePath(path);
        assertResolvedPathInsideWorkspace(rootRealPath, absolutePath, path);

        return {
          content: await readFile(absolutePath, "utf8")
        };
      }
    },
    writeFile: {
      name: "write_file",
      description: "Write a UTF-8 file inside the workspace.",
      async execute(input): Promise<ToolResult> {
        const path = readStringInput(input, "path");
        const content = readStringInput(input, "content");
        const absolutePath = workspace.resolvePath(path);
        assertResolvedPathInsideWorkspace(rootRealPath, absolutePath, path);
        const workspacePath = workspaceRelativePath(workspace, absolutePath);

        if (
          hasDirtyPath(dirtyPathsAtStart, workspacePath, absolutePath) &&
          !hasWrittenPath(
            writtenPaths,
            writtenRealPaths,
            writtenFileIdentities,
            workspacePath,
            absolutePath
          )
        ) {
          return {
            success: false,
            content: `Refusing to overwrite user changes in ${workspacePath}`,
            metadata: {
              blockedAction: {
                kind: "user_changes",
                reason: "Refusing to overwrite user-modified file.",
                path: workspacePath
              }
            }
          };
        }

        const diff = await createDiffBeforeWrite(absolutePath, workspacePath, content);
        await writeFile(absolutePath, content);
        writtenPaths.add(workspacePath);
        const writtenRealPath = realPathForExistingPath(absolutePath);

        if (writtenRealPath) {
          writtenRealPaths.add(writtenRealPath);
        }

        const writtenFileIdentity = fileIdentityForExistingPath(absolutePath);

        if (writtenFileIdentity) {
          writtenFileIdentities.add(writtenFileIdentity);
        }

        return {
          success: true,
          content: `Wrote ${workspacePath}`,
          metadata: {
            modifiedFiles: [workspacePath],
            diff
          }
        };
      }
    }
  };
}
