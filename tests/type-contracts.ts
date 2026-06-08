import type { JsonValue, TraceEvent, TraceMetadata, ToolResult } from "../src/index.js";

const traceMetadata: TraceMetadata = {
  modifiedFiles: ["README.md"],
  verification: [{ command: "npm test", passed: true }]
};

const summaryEvent = {
  type: "summary",
  message: "Runtime summary",
  timestamp: "2026-06-08T00:00:00.000Z",
  metadata: traceMetadata
} satisfies TraceEvent;

const toolResult = {
  success: true,
  content: "ok",
  metadata: {
    kind: "diff",
    path: "README.md"
  }
} satisfies ToolResult;

const jsonValue: JsonValue = {
  summaryType: summaryEvent.type,
  toolSucceeded: toolResult.success ?? null,
  metadata: traceMetadata
};

void jsonValue;
