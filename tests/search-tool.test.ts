import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createSearchTextTool } from "../dist/tools/search-tool.js";
import { createWorkspace } from "../dist/workspace/workspace.js";

test("search text returns matching workspace lines and skips generated output", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-search-tool-"));
  await writeFile(join(root, "README.md"), "ForgeCode local agent\n");
  await mkdir(join(root, "dist"));
  await writeFile(join(root, "dist", "bundle.js"), "ForgeCode generated\n");
  const tool = createSearchTextTool(createWorkspace(root));

  const result = await tool.execute({ query: "ForgeCode" });

  assert.equal(result.success, true);
  assert.match(result.content, /README\.md:1:ForgeCode local agent/);
  assert.doesNotMatch(result.content, /bundle\.js/);
  assert.deepEqual(result.metadata?.context, {
    query: "ForgeCode",
    resultCount: 1,
    files: ["README.md"]
  });
});

test("search text caps returned matches with maxResults", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-search-tool-"));
  await writeFile(join(root, "a.txt"), "Needle first\nNeedle second\n");
  await writeFile(join(root, "z.txt"), "Needle third\n");
  const tool = createSearchTextTool(createWorkspace(root));

  const result = await tool.execute({ query: "Needle", maxResults: 2 });

  assert.equal(result.success, true);
  assert.equal(result.content, "a.txt:1:Needle first\na.txt:2:Needle second");
  assert.deepEqual(result.metadata?.context, {
    query: "Needle",
    resultCount: 2,
    files: ["a.txt"]
  });
});

test("search text validates query and maxResults inputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-search-tool-"));
  const tool = createSearchTextTool(createWorkspace(root));

  await assert.rejects(() => tool.execute({ query: "" }), /query/);
  await assert.rejects(() => tool.execute({ query: "ForgeCode", maxResults: 0 }), /maxResults/);
});

test("search text skips generated and vendor directories at any depth", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-search-tool-"));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "src", "dist"), { recursive: true });
  await mkdir(join(root, "packages", "app", "node_modules"), { recursive: true });
  await writeFile(join(root, "src", "notes.txt"), "ForgeCode source\n");
  await writeFile(join(root, "src", "dist", "bundle.js"), "ForgeCode generated\n");
  await writeFile(join(root, "packages", "app", "node_modules", "dep.txt"), "ForgeCode vendor\n");
  const tool = createSearchTextTool(createWorkspace(root));

  const result = await tool.execute({ query: "ForgeCode" });

  assert.equal(result.success, true);
  assert.equal(result.content, "src/notes.txt:1:ForgeCode source");
  assert.deepEqual(result.metadata?.context, {
    query: "ForgeCode",
    resultCount: 1,
    files: ["src/notes.txt"]
  });
});

test("search text skips binary files without failing the search", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-search-tool-"));
  await writeFile(join(root, "binary.bin"), Buffer.from([0, 70, 111, 114, 103, 101]));
  await writeFile(join(root, "notes.txt"), "ForgeCode text\n");
  const tool = createSearchTextTool(createWorkspace(root));

  const result = await tool.execute({ query: "ForgeCode" });

  assert.equal(result.success, true);
  assert.equal(result.content, "notes.txt:1:ForgeCode text");
  assert.deepEqual(result.metadata?.context, {
    query: "ForgeCode",
    resultCount: 1,
    files: ["notes.txt"]
  });
});
