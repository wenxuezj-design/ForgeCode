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

test("workspace tools reject paths outside the root", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-workspace-"));
  const workspace = createWorkspace(root);
  const tools = createWorkspaceTools(workspace);

  await assert.rejects(
    () => tools.readFile.execute({ path: "../secret.txt" }),
    /outside the workspace/
  );
});
