import assert from "node:assert/strict";
import { test } from "node:test";

import { createAgentSession } from "../dist/agent/session.js";
import { createTraceRecorder } from "../dist/agent/trace.js";

test("records ordered trace events with timestamps", () => {
  const trace = createTraceRecorder(() => "2026-05-30T00:00:00.000Z");

  trace.record({ type: "plan", message: "Inspect project" });
  trace.record({ type: "tool_call", message: "list_files" });

  assert.deepEqual(trace.events.map((event) => event.type), ["plan", "tool_call"]);
  assert.equal(trace.events[0]?.timestamp, "2026-05-30T00:00:00.000Z");
  assert.equal(trace.events[1]?.message, "list_files");
});

test("agent sessions own a trace recorder", () => {
  const session = createAgentSession({ task: "Fix test" });

  session.trace.record({ type: "final", message: "Done" });

  assert.equal(session.trace.events.at(-1)?.type, "final");
  assert.equal(session.events[0]?.type, "user_task");
});

test("records trace metadata for v0.2 events", () => {
  const trace = createTraceRecorder(() => "2026-06-08T00:00:00.000Z");

  trace.record({
    type: "summary",
    message: "Runtime summary",
    metadata: {
      modifiedFiles: ["README.md"],
      verification: [{ command: "npm test", passed: true }]
    }
  });

  assert.equal(trace.events[0]?.type, "summary");
  assert.deepEqual(trace.events[0]?.metadata, {
    modifiedFiles: ["README.md"],
    verification: [{ command: "npm test", passed: true }]
  });
});
