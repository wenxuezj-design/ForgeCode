import { createAgentSession } from "../agent/session.js";
import type { JsonValue, TraceEvent, TraceMetadata, TraceRecorder } from "../agent/trace.js";
import type { ModelProvider } from "../providers/model-provider.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { Workspace } from "../workspace/workspace.js";
import {
  createRunSummaryEvidence,
  type BlockedActionEvidence,
  type RunSummaryEvidence,
  type VerificationEvidence
} from "./run-summary.js";

export interface RunTaskTodo {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export type RunTaskEvent =
  | { type: "plan_started"; message: string }
  | { type: "todo_updated"; message: string; todos: RunTaskTodo[] }
  | { type: "tool_started"; message: string; toolName: string }
  | { type: "tool_finished"; message: string; toolName: string; success: boolean }
  | { type: "approval_required"; message: string }
  | { type: "diff_available"; message: string; path: string }
  | { type: "verification_result"; message: string; passed: boolean }
  | { type: "final_summary"; message: string; summary: RunSummaryEvidence };

export interface RunTaskOptions {
  task: string;
  provider: ModelProvider;
  tools: ToolRegistry;
  workspace: Workspace;
  maxSteps?: number;
  onEvent?: (event: RunTaskEvent) => void;
}

export interface RunTaskResult {
  exitCode: number;
  summary: string;
  trace: TraceRecorder;
  summaryEvidence: RunSummaryEvidence;
}

export function planToTodos(plan: string): RunTaskTodo[] {
  return plan
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replace(/^- \[[ xX]\]\s+/, "")
        .replace(/^[-*]\s+/, "")
        .replace(/^\d+[.)]\s+/, "")
        .trim()
    )
    .filter((line) => line.length > 0)
    .map((content, index) => ({
      content,
      status: index === 0 ? "in_progress" : "pending"
    }));
}

function emit(options: RunTaskOptions, event: RunTaskEvent): void {
  options.onEvent?.(event);
}

function cloneJsonValue<T extends JsonValue>(value: T): T {
  return structuredClone(value);
}

function snapshotTraceEvents(events: TraceEvent[]): TraceEvent[] {
  return events.map((event) => ({
    ...event,
    metadata: event.metadata ? cloneJsonValue(event.metadata) : undefined
  }));
}

function isJsonObject(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asJsonValues(value: JsonValue | undefined): JsonValue[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function inferFirstModifiedFile(metadata: TraceMetadata): string | undefined {
  const modifiedFiles = metadata.modifiedFiles;

  if (!Array.isArray(modifiedFiles)) {
    return undefined;
  }

  return modifiedFiles.find((file): file is string => typeof file === "string");
}

function readReason(value: JsonValue): string {
  if (!isJsonObject(value)) {
    return "Approval required.";
  }

  if (typeof value.reason === "string") {
    return value.reason;
  }

  if (typeof value.message === "string") {
    return value.message;
  }

  return "Approval required.";
}

function readVerificationMessage(value: JsonValue): string {
  if (!isJsonObject(value)) {
    return "Verification result";
  }

  const command = typeof value.command === "string" ? value.command : "verification";

  if (typeof value.exitCode === "number") {
    return `${command} exitCode=${value.exitCode}`;
  }

  if (typeof value.passed === "boolean") {
    return `${command} ${value.passed ? "passed" : "failed"}`;
  }

  return command;
}

function readVerificationPassed(value: JsonValue): boolean {
  if (!isJsonObject(value)) {
    return false;
  }

  if (typeof value.passed === "boolean") {
    return value.passed;
  }

  return value.exitCode === 0;
}

function todoToJson(todo: RunTaskTodo): JsonValue {
  return {
    content: todo.content,
    status: todo.status
  };
}

function verificationEvidenceToJson(evidence: VerificationEvidence): JsonValue {
  const value: Record<string, JsonValue> = {
    command: evidence.command,
    passed: evidence.passed
  };

  if (evidence.exitCode !== undefined) {
    value.exitCode = evidence.exitCode;
  }

  if (evidence.output !== undefined) {
    value.output = evidence.output;
  }

  return value;
}

function blockedActionEvidenceToJson(evidence: BlockedActionEvidence): JsonValue {
  const value: Record<string, JsonValue> = {
    reason: evidence.reason
  };

  if (evidence.action !== undefined) {
    value.action = evidence.action;
  }

  if (evidence.command !== undefined) {
    value.command = evidence.command;
  }

  if (evidence.kind !== undefined) {
    value.kind = evidence.kind;
  }

  if (evidence.path !== undefined) {
    value.path = evidence.path;
  }

  if (evidence.toolName !== undefined) {
    value.toolName = evidence.toolName;
  }

  return value;
}

function summaryEvidenceToMetadata(evidence: RunSummaryEvidence): TraceMetadata {
  return {
    task: evidence.task,
    providerFinal: evidence.providerFinal,
    modifiedFiles: evidence.modifiedFiles,
    verification: evidence.verification.map(verificationEvidenceToJson),
    blockedActions: evidence.blockedActions.map(blockedActionEvidenceToJson),
    remainingRisks: evidence.remainingRisks,
    traceEventCount: evidence.traceEventCount
  };
}

export async function runTask(options: RunTaskOptions): Promise<RunTaskResult> {
  const session = createAgentSession({ task: options.task });
  const maxSteps = options.maxSteps ?? 20;

  function finish(exitCode: number, summary: string): RunTaskResult {
    session.trace.record({ type: "final", message: summary });

    const summaryEvidence = {
      ...createRunSummaryEvidence(options.task, summary, session.trace.events),
      traceEventCount: session.trace.events.length + 1
    };

    session.trace.record({
      type: "summary",
      message: "Runtime summary",
      metadata: summaryEvidenceToMetadata(summaryEvidence)
    });
    emit(options, { type: "final_summary", message: summary, summary: summaryEvidence });

    return {
      exitCode,
      summary,
      trace: session.trace,
      summaryEvidence
    };
  }

  for (let step = 0; step < maxSteps; step += 1) {
    const action = await options.provider.nextAction({
      task: options.task,
      events: snapshotTraceEvents(session.trace.events)
    });

    if (action.kind === "plan") {
      session.trace.record({ type: "plan", message: action.content });
      emit(options, { type: "plan_started", message: action.content });

      const todos = planToTodos(action.content);

      session.trace.record({
        type: "todo",
        message: "Todo list updated",
        metadata: {
          todos: todos.map(todoToJson)
        }
      });
      emit(options, { type: "todo_updated", message: "Todo list updated", todos });
      continue;
    }

    if (action.kind === "tool") {
      const toolMessage = `${action.toolName} ${JSON.stringify(action.input)}`;

      session.trace.record({ type: "tool_call", message: toolMessage });
      emit(options, { type: "tool_started", message: `Starting ${action.toolName}`, toolName: action.toolName });
      const result = await options.tools.execute(action.toolName, action.input);
      const success = result.success ?? true;
      const toolResultMetadata: TraceMetadata = {
        ...(result.metadata ?? {}),
        toolName: action.toolName,
        toolSuccess: success
      };

      session.trace.record({ type: "tool_result", message: result.content, metadata: toolResultMetadata });
      emit(options, {
        type: "tool_finished",
        message: `${action.toolName} ${success ? "succeeded" : "failed"}`,
        toolName: action.toolName,
        success
      });

      if (result.metadata) {
        for (const blockedAction of asJsonValues(result.metadata.blockedAction)) {
          session.trace.record({
            type: "approval",
            message: readReason(blockedAction),
            metadata: { blockedAction }
          });
          emit(options, { type: "approval_required", message: readReason(blockedAction) });
        }

        if (typeof result.metadata.diff === "string") {
          const path = inferFirstModifiedFile(result.metadata);

          if (path) {
            session.trace.record({
              type: "diff",
              message: `Diff available for ${path}`,
              metadata: {
                path,
                diff: result.metadata.diff,
                modifiedFiles: [path]
              }
            });
            emit(options, { type: "diff_available", message: `Diff available for ${path}`, path });
          }
        }

        for (const verification of asJsonValues(result.metadata.verification)) {
          const message = readVerificationMessage(verification);

          session.trace.record({
            type: "verification",
            message,
            metadata: { verification }
          });
          emit(options, {
            type: "verification_result",
            message,
            passed: readVerificationPassed(verification)
          });
        }
      }
      continue;
    }

    return finish(0, action.content);
  }

  const summary = `Stopped after ${maxSteps} steps without a final answer.`;

  return finish(1, summary);
}
