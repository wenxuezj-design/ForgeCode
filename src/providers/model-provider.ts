export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface ModelProvider {
  name: string;
  complete(messages: ModelMessage[]): Promise<ModelMessage>;
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
    }
  };
}
