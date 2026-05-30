import type { ModelProvider } from "../providers/model-provider.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { Workspace } from "../workspace/workspace.js";

export interface CoreApp {
  provider: ModelProvider;
  tools: ToolRegistry;
  workspace: Workspace;
}

export interface CreateCoreAppOptions {
  provider: ModelProvider;
  tools: ToolRegistry;
  workspace: Workspace;
}

export function createCoreApp(options: CreateCoreAppOptions): CoreApp {
  return {
    provider: options.provider,
    tools: options.tools,
    workspace: options.workspace
  };
}
