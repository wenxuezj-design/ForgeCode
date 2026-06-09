import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { createWorkspaceTools } from "../dist/tools/workspace-tools.js";
import { createTextDiff } from "../dist/workspace/diff.js";
import { readGitState } from "../dist/workspace/git-state.js";
import { createWorkspace } from "../dist/workspace/workspace.js";

const execFileAsync = promisify(execFile);

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function withGitEnv<T>(
  overrides: Record<string, string>,
  callback: () => Promise<T>
): Promise<T> {
  const originalValues = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(overrides)) {
    originalValues.set(key, process.env[key]);
    process.env[key] = value;
  }

  try {
    return await callback();
  } finally {
    for (const [key, value] of originalValues) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("workspace tools list, read, and write files inside the root", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-workspace-"));
  await writeFile(join(root, "README.md"), "# Demo\n");
  const workspace = createWorkspace(root);
  const tools = createWorkspaceTools(workspace);

  assert.deepEqual(await tools.listFiles.execute({}), { content: "README.md" });
  assert.deepEqual(await tools.readFile.execute({ path: "README.md" }), { content: "# Demo\n" });

  await tools.writeFile.execute({ path: "notes.txt", content: "hello" });
  assert.equal(await readFile(join(root, "notes.txt"), "utf8"), "hello");
});

test("workspace write tool returns diff metadata for clean files", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-workspace-"));
  await writeFile(join(root, "README.md"), "# Old\n");
  const workspace = createWorkspace(root);
  const tools = createWorkspaceTools(workspace);

  const result = await tools.writeFile.execute({ path: "README.md", content: "# New\n" });

  assert.equal(result.success, true);
  assert.deepEqual(result.metadata?.modifiedFiles, ["README.md"]);
  assert.match(String(result.metadata?.diff), /--- README\.md/);
  assert.match(String(result.metadata?.diff), /\+\+\+ README\.md/);
  assert.match(String(result.metadata?.diff), /-# Old/);
  assert.match(String(result.metadata?.diff), /\+# New/);
});

test("workspace write tool reports new file diffs from /dev/null", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-workspace-"));
  const workspace = createWorkspace(root);
  const tools = createWorkspaceTools(workspace);

  const result = await tools.writeFile.execute({ path: "notes.txt", content: "hello\n" });

  assert.equal(result.success, true);
  assert.deepEqual(result.metadata?.modifiedFiles, ["notes.txt"]);
  assert.match(String(result.metadata?.diff), /--- \/dev\/null/);
  assert.match(String(result.metadata?.diff), /\+\+\+ notes\.txt/);
  assert.match(String(result.metadata?.diff), /\+hello/);
});

test("text diff shows newline-only changes", () => {
  const diff = createTextDiff({ path: "README.md", before: "hello\n", after: "hello" });

  assert.match(diff, /-hello/);
  assert.match(diff, /\+hello/);
  assert.match(diff, /\\ No newline at end of file/);
});

test("workspace write tool refuses files dirty at task start", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-workspace-"));
  await writeFile(join(root, "README.md"), "# User change\n");
  const workspace = createWorkspace(root);
  const tools = createWorkspaceTools(workspace, {
    dirtyPathsAtStart: new Set(["README.md"])
  });

  const result = await tools.writeFile.execute({ path: "README.md", content: "# ForgeCode change\n" });

  assert.equal(result.success, false);
  assert.match(result.content, /user changes/i);
  assert.deepEqual(result.metadata?.blockedAction, {
    kind: "user_changes",
    reason: "Refusing to overwrite user-modified file.",
    path: "README.md"
  });
  assert.equal(await readFile(join(root, "README.md"), "utf8"), "# User change\n");
});

test("workspace write tool treats dirty directories as protecting children", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-workspace-"));
  await mkdir(join(root, "dir"));
  await writeFile(join(root, "dir", "file.txt"), "user\n");
  const workspace = createWorkspace(root);
  const tools = createWorkspaceTools(workspace, {
    dirtyPathsAtStart: new Set(["dir/"])
  });

  const result = await tools.writeFile.execute({ path: "dir/file.txt", content: "forge\n" });

  assert.equal(result.success, false);
  assert.deepEqual(result.metadata?.blockedAction, {
    kind: "user_changes",
    reason: "Refusing to overwrite user-modified file.",
    path: "dir/file.txt"
  });
  assert.equal(await readFile(join(root, "dir", "file.txt"), "utf8"), "user\n");
});

test("workspace write tool snapshots dirty paths at creation", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-workspace-"));
  await writeFile(join(root, "README.md"), "# User change\n");
  const workspace = createWorkspace(root);
  const dirtyPathsAtStart = new Set(["README.md"]);
  const tools = createWorkspaceTools(workspace, { dirtyPathsAtStart });
  dirtyPathsAtStart.clear();

  const result = await tools.writeFile.execute({ path: "README.md", content: "# ForgeCode change\n" });

  assert.equal(result.success, false);
  assert.deepEqual(result.metadata?.blockedAction, {
    kind: "user_changes",
    reason: "Refusing to overwrite user-modified file.",
    path: "README.md"
  });
  assert.equal(await readFile(join(root, "README.md"), "utf8"), "# User change\n");
});

test("workspace write tool allows repeat writes to files it already wrote", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-workspace-"));
  await writeFile(join(root, "README.md"), "# Old\n");
  const workspace = createWorkspace(root);
  const tools = createWorkspaceTools(workspace);

  const first = await tools.writeFile.execute({ path: "README.md", content: "# First\n" });
  const second = await tools.writeFile.execute({ path: "README.md", content: "# Second\n" });

  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.deepEqual(second.metadata?.modifiedFiles, ["README.md"]);
  assert.match(String(second.metadata?.diff), /-# First/);
  assert.match(String(second.metadata?.diff), /\+# Second/);
  assert.equal(await readFile(join(root, "README.md"), "utf8"), "# Second\n");
});

test("readGitState returns dirty paths relative to a repository subdirectory workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-git-state-"));
  const workspaceRoot = join(root, "sub");
  await mkdir(workspaceRoot);
  await runGit(root, ["init", "--quiet"]);
  await writeFile(join(workspaceRoot, "file.txt"), "user\n");

  const gitState = await readGitState(workspaceRoot);
  const workspace = createWorkspace(workspaceRoot);
  const tools = createWorkspaceTools(workspace, {
    dirtyPathsAtStart: gitState.dirtyPaths
  });
  const result = await tools.writeFile.execute({ path: "file.txt", content: "forge\n" });

  assert.equal(gitState.available, true);
  assert.deepEqual([...gitState.dirtyPaths].sort(), ["file.txt"]);
  assert.equal(result.success, false);
  assert.deepEqual(result.metadata?.blockedAction, {
    kind: "user_changes",
    reason: "Refusing to overwrite user-modified file.",
    path: "file.txt"
  });
  assert.equal(await readFile(join(workspaceRoot, "file.txt"), "utf8"), "user\n");
});

test("readGitState ignores git environment overrides while probing status", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-git-state-"));
  await runGit(root, ["init", "--quiet"]);
  await writeFile(join(root, "file.txt"), "user\n");

  await withGitEnv(
    {
      GIT_DIR: join(root, "not-a-git-dir"),
      GIT_WORK_TREE: join(root, "wrong-work-tree"),
      GIT_INDEX_FILE: join(root, "wrong-index"),
      GIT_CONFIG_COUNT: "not-a-number"
    },
    async () => {
      const gitState = await readGitState(root);

      assert.equal(gitState.available, true);
      assert.deepEqual([...gitState.dirtyPaths].sort(), ["file.txt"]);
    }
  );
});

test("workspace tools reject paths outside the root", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-workspace-"));
  const workspace = createWorkspace(root);
  const tools = createWorkspaceTools(workspace);

  await assert.rejects(
    () => tools.readFile.execute({ path: "../secret.txt" }),
    /outside the workspace/
  );
});
