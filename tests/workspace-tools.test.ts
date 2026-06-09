import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createWorkspaceTools } from "../dist/tools/workspace-tools.js";
import { createWorkspace } from "../dist/workspace/workspace.js";

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

test("workspace write tool allows repeat writes to files it already wrote", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-workspace-"));
  await writeFile(join(root, "README.md"), "# Old\n");
  const workspace = createWorkspace(root);
  const dirtyPathsAtStart = new Set<string>();
  const tools = createWorkspaceTools(workspace, { dirtyPathsAtStart });

  const first = await tools.writeFile.execute({ path: "README.md", content: "# First\n" });
  dirtyPathsAtStart.add("README.md");
  const second = await tools.writeFile.execute({ path: "README.md", content: "# Second\n" });

  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.deepEqual(second.metadata?.modifiedFiles, ["README.md"]);
  assert.match(String(second.metadata?.diff), /-# First/);
  assert.match(String(second.metadata?.diff), /\+# Second/);
  assert.equal(await readFile(join(root, "README.md"), "utf8"), "# Second\n");
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
