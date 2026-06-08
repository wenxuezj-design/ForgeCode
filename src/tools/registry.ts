import type { TraceMetadata } from "../agent/trace.js";

export interface ToolResult {
  content: string;
  success?: boolean;
  metadata?: TraceMetadata;
}

export interface Tool {
  name: string;
  description: string;
  execute(input: unknown): Promise<ToolResult>;
}

export interface ToolRegistry {
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  list(): string[];
  execute(name: string, input: unknown): Promise<ToolResult>;
}

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, Tool>();

  return {
    register(tool) {
      if (tools.has(tool.name)) {
        throw new Error(`Tool already registered: ${tool.name}`);
      }

      tools.set(tool.name, tool);
    },
    get(name) {
      return tools.get(name);
    },
    list() {
      return [...tools.keys()].sort();
    },
    async execute(name, input) {
      const tool = tools.get(name);

      if (!tool) {
        throw new Error(`Unknown tool: ${name}`);
      }

      return tool.execute(input);
    }
  };
}
