export interface AgentEvent {
  type: "user_task" | "assistant_message" | "tool_call" | "tool_result";
  content: string;
}

export interface AgentSession {
  task: string;
  events: AgentEvent[];
}

export interface CreateAgentSessionOptions {
  task: string;
}

export function createAgentSession(options: CreateAgentSessionOptions): AgentSession {
  return {
    task: options.task,
    events: [
      {
        type: "user_task",
        content: options.task
      }
    ]
  };
}
