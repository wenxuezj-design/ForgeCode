import { readdir, readFile, writeFile } from "node:fs/promises";
import type { Workspace } from "../workspace/workspace.js";
import type { Tool } from "./registry.js";

export interface WorkspaceTools {
  listFiles: Tool;
  readFile: Tool;
  writeFile: Tool;
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

export function createWorkspaceTools(workspace: Workspace): WorkspaceTools {
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
      async execute(input) {
        const path = readStringInput(input, "path");
        const content = readStringInput(input, "content");

        await writeFile(workspace.resolvePath(path), content);

        return {
          content: `Wrote ${path}`
        };
      }
    }
  };
}
