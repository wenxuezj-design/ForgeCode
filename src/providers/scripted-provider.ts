import {
  createModelProvider,
  type AgentAction,
  type AgentActionContext,
  type ModelMessage,
  type ModelProvider
} from "./model-provider.js";

export function createScriptedProvider(actions: AgentAction[]): ModelProvider {
  const fallback = createModelProvider({ name: "scripted" });
  const queue = [...actions];

  return {
    name: "scripted",
    complete(messages: ModelMessage[]) {
      return fallback.complete(messages);
    },
    async nextAction(_context: AgentActionContext) {
      return queue.shift() ?? {
        kind: "final",
        content: "Script complete."
      };
    }
  };
}
