import assert from "node:assert/strict";
import { test } from "node:test";

import { createAgentSession } from "../dist/agent/session.js";
import { createCoreApp } from "../dist/core/app.js";
import { createModelProvider } from "../dist/providers/model-provider.js";
import { createToolRegistry } from "../dist/tools/registry.js";
import { createWorkspace } from "../dist/workspace/workspace.js";

test("creates a core app from provider, tools, and workspace boundaries", () => {
  const workspace = createWorkspace("/tmp/forgecode");
  const provider = createModelProvider({ name: "stub" });
  const tools = createToolRegistry();

  const app = createCoreApp({ provider, tools, workspace });

  assert.equal(app.provider.name, "stub");
  assert.equal(app.workspace.rootPath, "/tmp/forgecode");
  assert.deepEqual(app.tools.list(), []);
});

test("registers tools by name", () => {
  const registry = createToolRegistry();

  registry.register({
    name: "read_file",
    description: "Read a file from the workspace.",
    execute: async () => ({ content: "hello" })
  });

  assert.deepEqual(registry.list(), ["read_file"]);
  assert.equal(registry.get("read_file")?.description, "Read a file from the workspace.");
});

test("creates an agent session with an initial user task", () => {
  const session = createAgentSession({ task: "Build the project skeleton" });

  assert.equal(session.task, "Build the project skeleton");
  assert.equal(session.events[0]?.type, "user_task");
  assert.equal(session.events[0]?.content, "Build the project skeleton");
});
