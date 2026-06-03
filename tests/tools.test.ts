import assert from "node:assert/strict";
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

test("command tool captures stdout, stderr, and exit code", async () => {
  const tool = createCommandTool({ cwd: process.cwd() });

  const result = await tool.execute({ command: "node", args: ["--version"] });

  assert.match(result.content, /exitCode=0/);
  assert.match(result.content, /stdout=v/);
  assert.match(result.content, /stderr=/);
});
