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

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd, env: safeGitEnv() });
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

test("workspace write tool returns bounded diff metadata for large changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-workspace-"));
  const before = Array.from({ length: 700 }, (_, index) => `old ${index}`).join("\n");
  const after = Array.from({ length: 700 }, (_, index) => `new ${index}`).join("\n");
  await writeFile(join(root, "large.txt"), before);
  const workspace = createWorkspace(root);
  const tools = createWorkspaceTools(workspace);

  const result = await tools.writeFile.execute({ path: "large.txt", content: after });

  assert.equal(result.success, true);
  assert.equal(await readFile(join(root, "large.txt"), "utf8"), after);
  assert.deepEqual(result.metadata?.modifiedFiles, ["large.txt"]);
  assert.match(String(result.metadata?.diff), /--- large\.txt/);
  assert.match(String(result.metadata?.diff), /\+\+\+ large\.txt/);
  assert.match(String(result.metadata?.diff), /omitted/i);
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
  assert.match(String(result.metadata?.diff), /@@ -0,0 \+1,1 @@/);
  assert.match(String(result.metadata?.diff), /\+hello/);
});

test("text diff reports empty new files as creation diffs", () => {
  const diff = createTextDiff({ path: "empty.txt", before: "", after: "", isNewFile: true });

  assert.match(diff, /--- \/dev\/null/);
  assert.match(diff, /\+\+\+ empty\.txt/);
  assert.match(diff, /@@ -0,0 \+1,0 @@/);
});

test("text diff reports full-file unified hunk ranges for modifications", () => {
  const diff = createTextDiff({ path: "README.md", before: "# Old\n", after: "# New\n" });

  assert.match(diff, /@@ -1,1 \+1,1 @@/);
});

test("text diff shows CRLF-to-LF line ending changes", () => {
  const diff = createTextDiff({ path: "README.md", before: "hello\r\n", after: "hello\n" });

  assert.match(diff, /-hello\r/);
  assert.match(diff, /\+hello/);
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

test("workspace write tool treats bare dirty directory paths as protecting children", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-workspace-"));
  await mkdir(join(root, "sub"));
  await writeFile(join(root, "sub", "file.txt"), "user\n");
  const workspace = createWorkspace(root);
  const tools = createWorkspaceTools(workspace, {
    dirtyPathsAtStart: new Set(["sub"])
  });

  const result = await tools.writeFile.execute({ path: "sub/file.txt", content: "forge\n" });

  assert.equal(result.success, false);
  assert.deepEqual(result.metadata?.blockedAction, {
    kind: "user_changes",
    reason: "Refusing to overwrite user-modified file.",
    path: "sub/file.txt"
  });
  assert.equal(await readFile(join(root, "sub", "file.txt"), "utf8"), "user\n");
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

test("readGitState parses non-ASCII dirty paths from porcelain z output", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-git-state-"));
  await runGit(root, ["init", "--quiet"]);
  await writeFile(join(root, "é.txt"), "user\n");

  const gitState = await readGitState(root);

  assert.equal(gitState.available, true);
  assert.deepEqual([...gitState.dirtyPaths].sort(), ["é.txt"]);
});

test("readGitState uses rename targets containing arrows from porcelain z output", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-git-state-"));
  await runGit(root, ["init", "--quiet"]);
  await writeFile(join(root, "original.txt"), "old\n");
  await runGit(root, ["add", "original.txt"]);
  await runGit(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--quiet", "-m", "init"]);
  await runGit(root, ["mv", "original.txt", "target -> file.txt"]);

  const gitState = await readGitState(root);

  assert.equal(gitState.available, true);
  assert.deepEqual([...gitState.dirtyPaths].sort(), ["original.txt", "target -> file.txt"]);
});

test("readGitState protects both old and new paths for renames", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-git-state-"));
  await runGit(root, ["init", "--quiet"]);
  await writeFile(join(root, "original.txt"), "old\n");
  await runGit(root, ["add", "original.txt"]);
  await runGit(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--quiet", "-m", "init"]);
  await runGit(root, ["mv", "original.txt", "target.txt"]);

  const gitState = await readGitState(root);
  const workspace = createWorkspace(root);
  const tools = createWorkspaceTools(workspace, {
    dirtyPathsAtStart: gitState.dirtyPaths
  });
  const result = await tools.writeFile.execute({ path: "original.txt", content: "forge\n" });

  assert.equal(gitState.available, true);
  assert.deepEqual([...gitState.dirtyPaths].sort(), ["original.txt", "target.txt"]);
  assert.equal(result.success, false);
  assert.deepEqual(result.metadata?.blockedAction, {
    kind: "user_changes",
    reason: "Refusing to overwrite user-modified file.",
    path: "original.txt"
  });
  await assert.rejects(() => readFile(join(root, "original.txt"), "utf8"), /ENOENT/);
});

test("readGitState protects ignored local files at task start", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-git-state-"));
  await runGit(root, ["init", "--quiet"]);
  await writeFile(join(root, ".gitignore"), "secret.txt\nsecrets/\n");
  await runGit(root, ["add", ".gitignore"]);
  await runGit(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--quiet", "-m", "ignore secrets"]);
  await writeFile(join(root, "secret.txt"), "user secret\n");
  await mkdir(join(root, "secrets"));
  await writeFile(join(root, "secrets", "nested.txt"), "nested secret\n");

  const gitState = await readGitState(root);
  const workspace = createWorkspace(root);
  const tools = createWorkspaceTools(workspace, {
    dirtyPathsAtStart: gitState.dirtyPaths
  });
  const result = await tools.writeFile.execute({ path: "secret.txt", content: "forge secret\n" });
  const nestedResult = await tools.writeFile.execute({ path: "secrets/nested.txt", content: "forge nested\n" });

  assert.equal(gitState.available, true);
  assert.ok(gitState.dirtyPaths.has("secret.txt"));
  assert.ok(
    [...gitState.dirtyPaths].some(
      (dirtyPath) => dirtyPath === "secrets/nested.txt" || dirtyPath === "secrets/"
    )
  );
  assert.equal(result.success, false);
  assert.deepEqual(result.metadata?.blockedAction, {
    kind: "user_changes",
    reason: "Refusing to overwrite user-modified file.",
    path: "secret.txt"
  });
  assert.equal(nestedResult.success, false);
  assert.deepEqual(nestedResult.metadata?.blockedAction, {
    kind: "user_changes",
    reason: "Refusing to overwrite user-modified file.",
    path: "secrets/nested.txt"
  });
  assert.equal(await readFile(join(root, "secret.txt"), "utf8"), "user secret\n");
  assert.equal(await readFile(join(root, "secrets", "nested.txt"), "utf8"), "nested secret\n");
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

test("readGitState ignores git ceiling directory overrides while probing from subdirectories", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-git-state-"));
  const workspaceRoot = join(root, "sub");
  await mkdir(workspaceRoot);
  await runGit(root, ["init", "--quiet"]);
  await writeFile(join(workspaceRoot, "file.txt"), "user\n");

  await withGitEnv(
    {
      GIT_CEILING_DIRECTORIES: root
    },
    async () => {
      const gitState = await readGitState(workspaceRoot);

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
