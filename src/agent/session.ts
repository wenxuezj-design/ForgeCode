import { createTraceRecorder, type TraceRecorder } from "./trace.js";

export interface AgentEvent {
  type: "user_task" | "assistant_message" | "tool_call" | "tool_result";
  content: string;
}

export interface AgentSession {
  task: string;
  events: AgentEvent[];
  trace: TraceRecorder;
}

export interface CreateAgentSessionOptions {
  task: string;
}

export function createAgentSession(options: CreateAgentSessionOptions): AgentSession {
  return {
    task: options.task,
    trace: createTraceRecorder(),
    events: [
      {
        type: "user_task",
        content: options.task
      }
    ]
  };
}
