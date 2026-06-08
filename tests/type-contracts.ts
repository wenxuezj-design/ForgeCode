import type {
  ApprovalPolicy,
  CommandRisk,
  JsonValue,
  RunSummaryEvidence,
  RunTaskEvent,
  RunTaskTodo,
  TraceEvent,
  TraceMetadata,
  ToolResult
} from "../src/index.js";

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

const runTaskTodo = {
  content: "Inspect README",
  status: "in_progress"
} satisfies RunTaskTodo;

const runSummaryEvidence = {
  task: "Inspect README",
  providerFinal: "Done.",
  modifiedFiles: [],
  verification: [],
  blockedActions: [],
  remainingRisks: [],
  traceEventCount: 1
} satisfies RunSummaryEvidence;

const runTaskEvent = {
  type: "final_summary",
  message: "Done.",
  summary: runSummaryEvidence
} satisfies RunTaskEvent;

const approvalPolicy: ApprovalPolicy = "allow-safe";
const commandRisk: CommandRisk = "destructive";

const jsonValue: JsonValue = {
  summaryType: summaryEvent.type,
  toolSucceeded: toolResult.success ?? null,
  metadata: traceMetadata,
  todoStatus: runTaskTodo.status,
  runTaskEventType: runTaskEvent.type,
  approvalPolicy,
  commandRisk
};

void jsonValue;
