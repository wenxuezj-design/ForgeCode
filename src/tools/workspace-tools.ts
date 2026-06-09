import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { relative, sep } from "node:path";
import { createTextDiff } from "../workspace/diff.js";
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
  return path.split(sep).join("/");
}

function workspaceRelativePath(workspace: Workspace, absolutePath: string): string {
  return normalizeWorkspacePath(relative(workspace.resolvePath("."), absolutePath));
}

function hasDirtyPath(dirtyPaths: Set<string>, path: string): boolean {
  const normalizedPath = normalizeWorkspacePath(path);

  for (const dirtyPath of dirtyPaths) {
    if (normalizeWorkspacePath(dirtyPath) === normalizedPath) {
      return true;
    }
  }

  return false;
}

export function createWorkspaceTools(
  workspace: Workspace,
  options: CreateWorkspaceToolsOptions = {}
): WorkspaceTools {
  const dirtyPathsAtStart = options.dirtyPathsAtStart ?? new Set<string>();
  const writtenPaths = new Set<string>();

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

        return {
          content: await readFile(workspace.resolvePath(path), "utf8")
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
        const workspacePath = workspaceRelativePath(workspace, absolutePath);

        if (hasDirtyPath(dirtyPathsAtStart, workspacePath) && !writtenPaths.has(workspacePath)) {
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

        const before = existsSync(absolutePath) ? await readFile(absolutePath, "utf8") : "";
        await writeFile(absolutePath, content);
        writtenPaths.add(workspacePath);

        return {
          success: true,
          content: `Wrote ${workspacePath}`,
          metadata: {
            modifiedFiles: [workspacePath],
            diff: createTextDiff({ path: workspacePath, before, after: content })
          }
        };
      }
    }
  };
}
