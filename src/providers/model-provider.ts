import type { TraceEvent } from "../agent/trace.js";

export type AgentAction =
  | { kind: "plan"; content: string }
  | { kind: "tool"; toolName: string; input: unknown }
  | { kind: "final"; content: string };

export interface AgentActionContext {
  task: string;
  events: TraceEvent[];
}

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface ModelProvider {
  name: string;
  complete(messages: ModelMessage[]): Promise<ModelMessage>;
  nextAction(context: AgentActionContext): Promise<AgentAction>;
}

export interface CreateModelProviderOptions {
  name: string;
}

export function createModelProvider(options: CreateModelProviderOptions): ModelProvider {
  return {
    name: options.name,
    async complete(messages) {
      const lastMessage = messages.at(-1);

      return {
        role: "assistant",
        content: lastMessage ? `Stub response to: ${lastMessage.content}` : "Stub response"
      };
    },
    async nextAction() {
      return {
        kind: "final",
        content: "No provider actions configured."
      };
    }
  };
}
