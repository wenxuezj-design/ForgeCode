import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { createInterface } from "node:readline";
import type { Workspace } from "../workspace/workspace.js";
import type { Tool, ToolResult } from "./registry.js";

interface SearchTextInput {
  query: string;
  maxResults: number;
}

interface SearchMatch {
  path: string;
  lineNumber: number;
  line: string;
}

const defaultMaxResults = 20;
const skippedDirectoryNames = new Set(["node_modules", "dist", ".git", ".worktrees", "coverage"]);

function normalizeWorkspacePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .split(sep)
    .join("/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "");
}

function workspaceRelativePath(rootPath: string, absolutePath: string): string {
  return normalizeWorkspacePath(relative(rootPath, absolutePath));
}

function readInput(input: unknown): SearchTextInput {
  if (!input || typeof input !== "object") {
    throw new Error("Missing object input.");
  }

  const query = (input as Record<string, unknown>).query;

  if (typeof query !== "string" || query.trim().length === 0) {
    throw new Error("Missing nonempty string input: query");
  }

  const maxResults = (input as Record<string, unknown>).maxResults ?? defaultMaxResults;

  if (
    typeof maxResults !== "number" ||
    !Number.isFinite(maxResults) ||
    !Number.isInteger(maxResults) ||
    maxResults < 1
  ) {
    throw new Error("Invalid positive integer input: maxResults");
  }

  return {
    query,
    maxResults
  };
}

async function searchFile(
  absolutePath: string,
  relativePath: string,
  query: string,
  maxMatches: number
): Promise<SearchMatch[]> {
  if (maxMatches < 1) {
    return [];
  }

  const stream = createReadStream(absolutePath, { encoding: "utf8" });
  const lineReader = createInterface({ input: stream, crlfDelay: Infinity });
  const matches: SearchMatch[] = [];
  let lineNumber = 0;
  let stoppedEarly = false;
  let binaryFile = false;

  try {
    for await (const line of lineReader) {
      lineNumber += 1;

      if (line.includes("\0")) {
        binaryFile = true;
        stoppedEarly = true;
        lineReader.close();
        stream.destroy();
        break;
      }

      if (line.includes(query)) {
        matches.push({
          path: relativePath,
          lineNumber,
          line: line.trim()
        });

        if (matches.length >= maxMatches) {
          stoppedEarly = true;
          lineReader.close();
          stream.destroy();
          break;
        }
      }
    }
  } catch {
    if (!stoppedEarly) {
      return [];
    }
  } finally {
    lineReader.close();
    stream.destroy();
  }

  if (binaryFile) {
    return [];
  }

  return matches;
}

async function searchDirectory(
  rootPath: string,
  absolutePath: string,
  query: string,
  maxResults: number,
  matches: SearchMatch[]
): Promise<void> {
  let entries;

  try {
    entries = await readdir(absolutePath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries.sort((first, second) => first.name.localeCompare(second.name))) {
    if (matches.length >= maxResults) {
      return;
    }

    if (entry.isSymbolicLink()) {
      continue;
    }

    const entryPath = join(absolutePath, entry.name);

    if (entry.isDirectory()) {
      if (!skippedDirectoryNames.has(entry.name)) {
        await searchDirectory(rootPath, entryPath, query, maxResults, matches);
      }

      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const relativePath = workspaceRelativePath(rootPath, entryPath);
    const remainingResults = maxResults - matches.length;
    const fileMatches = await searchFile(entryPath, relativePath, query, remainingResults);

    for (const match of fileMatches) {
      if (matches.length >= maxResults) {
        return;
      }

      matches.push(match);
    }
  }
}

export function createSearchTextTool(workspace: Workspace): Tool {
  return {
    name: "search_text",
    description: "search text files in workspace before reading files",
    async execute(input): Promise<ToolResult> {
      const { query, maxResults } = readInput(input);
      const rootPath = workspace.resolvePath(".");
      const matches: SearchMatch[] = [];

      await searchDirectory(rootPath, rootPath, query, maxResults, matches);

      const files = [...new Set(matches.map((match) => match.path))].sort();
      const content = matches.length > 0
        ? matches
          .map((match) => `${match.path}:${match.lineNumber}:${match.line}`)
          .join("\n")
        : `No matches for ${query}`;

      return {
        success: true,
        content,
        metadata: {
          context: {
            query,
            resultCount: matches.length,
            files
          }
        }
      };
    }
  };
}
