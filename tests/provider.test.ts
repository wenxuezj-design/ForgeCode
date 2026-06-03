import assert from "node:assert/strict";
import { test } from "node:test";

import { createModelProvider } from "../dist/providers/model-provider.js";
import { createScriptedProvider } from "../dist/providers/scripted-provider.js";

test("scripted provider returns deterministic agent actions", async () => {
  const provider = createScriptedProvider([
    { kind: "plan", content: "Read README" },
    { kind: "tool", toolName: "read_file", input: { path: "README.md" } },
    { kind: "final", content: "Verified README" }
  ]);

  assert.deepEqual(await provider.nextAction({ task: "Inspect repo", events: [] }), {
    kind: "plan",
    content: "Read README"
  });
  assert.deepEqual(await provider.nextAction({ task: "Inspect repo", events: [] }), {
    kind: "tool",
    toolName: "read_file",
    input: { path: "README.md" }
  });
  assert.deepEqual(await provider.nextAction({ task: "Inspect repo", events: [] }), {
    kind: "final",
    content: "Verified README"
  });
});

test("scripted provider returns a final action when the script is exhausted", async () => {
  const provider = createScriptedProvider([]);

  assert.deepEqual(await provider.nextAction({ task: "Inspect repo", events: [] }), {
    kind: "final",
    content: "Script complete."
  });
});

test("stub model provider exposes a default final action", async () => {
  const provider = createModelProvider({ name: "stub" });

  assert.deepEqual(await provider.nextAction({ task: "Inspect repo", events: [] }), {
    kind: "final",
    content: "No provider actions configured."
  });
});
