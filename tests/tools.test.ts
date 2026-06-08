import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createCommandTool } from "../dist/tools/command-tool.js";
import { createToolRegistry } from "../dist/tools/registry.js";

test("registry rejects duplicate tool names and executes registered tools", async () => {
  const registry = createToolRegistry();

  registry.register({
    name: "echo",
    description: "Echo input.",
    async execute(input) {
      return { content: JSON.stringify(input) };
    }
  });

  assert.throws(
    () => registry.register({
      name: "echo",
      description: "Duplicate echo.",
      async execute() {
        return { content: "" };
      }
    }),
    /already registered/
  );
  assert.deepEqual(await registry.execute("echo", { value: 1 }), { content: "{\"value\":1}" });
});

test("registry rejects unknown tools during execution", async () => {
  const registry = createToolRegistry();

  await assert.rejects(
    () => registry.execute("missing_tool", {}),
    /Unknown tool: missing_tool/
  );
});

test("registry preserves structured tool result metadata", async () => {
  const registry = createToolRegistry();

  registry.register({
    name: "structured",
    description: "Return metadata.",
    async execute() {
      return {
        success: true,
        content: "ok",
        metadata: {
          kind: "diff",
          path: "README.md"
        }
      };
    }
  });

  assert.deepEqual(await registry.execute("structured", {}), {
    success: true,
    content: "ok",
    metadata: {
      kind: "diff",
      path: "README.md"
    }
  });
});

test("command tool captures stdout, stderr, and exit code", async () => {
  const tool = createCommandTool({ cwd: process.cwd() });

  const result = await tool.execute({ command: "node", args: ["--version"] });

  assert.match(result.content, /exitCode=0/);
  assert.match(result.content, /stdout=v/);
  assert.match(result.content, /stderr=/);
});

test("command tool returns structured command metadata", async () => {
  const tool = createCommandTool({ cwd: process.cwd() });

  const result = await tool.execute({ command: "node", args: ["--version"] });

  assert.equal(result.success, true);
  assert.equal(result.metadata?.risk, "safe");
  assert.deepEqual(result.metadata?.verification, {
    command: "node --version",
    exitCode: 0,
    passed: true,
    output: result.content
  });
});

test("command tool refuses destructive commands by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "rm", args: ["sentinel.txt"] });

  assert.equal(result.success, false);
  assert.match(result.content, /requires approval/i);
  assert.deepEqual(result.metadata?.blockedAction, {
    kind: "approval",
    reason: "Destructive command requires approval.",
    command: "rm sentinel.txt"
  });
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool resolves spawn errors with structured verification metadata", async () => {
  const tool = createCommandTool({ cwd: process.cwd() });

  const result = await tool.execute({ command: "definitely-not-a-real-forgecode-command", args: [] });

  assert.equal(result.success, false);
  assert.match(result.content, /exitCode=1/);
  assert.match(result.content, /stdout=/);
  assert.match(result.content, /stderr=.*definitely-not-a-real-forgecode-command/);
  assert.equal(result.metadata?.risk, "unknown");
  assert.deepEqual(result.metadata?.verification, {
    command: "definitely-not-a-real-forgecode-command",
    exitCode: 1,
    passed: false,
    output: result.content
  });
});

test("command tool does not refuse read-only git commands by default", async () => {
  const tool = createCommandTool({ cwd: process.cwd() });

  const result = await tool.execute({ command: "git", args: ["status", "--short"] });

  assert.equal(result.success, true);
  assert.equal(result.metadata?.blockedAction, undefined);
});

test("command tool refuses force flags by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "node", args: ["--force"] });

  assert.equal(result.success, false);
  assert.match(result.content, /requires approval/i);
  assert.deepEqual(result.metadata?.blockedAction, {
    kind: "approval",
    reason: "Destructive command requires approval.",
    command: "node --force"
  });
});
