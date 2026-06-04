import { createAgentSession } from "../agent/session.js";
import type { TraceRecorder } from "../agent/trace.js";
import type { ModelProvider } from "../providers/model-provider.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { Workspace } from "../workspace/workspace.js";

export interface RunTaskOptions {
  task: string;
  provider: ModelProvider;
  tools: ToolRegistry;
  workspace: Workspace;
  maxSteps?: number;
}

export interface RunTaskResult {
  exitCode: number;
  summary: string;
  trace: TraceRecorder;
}

export async function runTask(options: RunTaskOptions): Promise<RunTaskResult> {
  const session = createAgentSession({ task: options.task });
  const maxSteps = options.maxSteps ?? 20;

  for (let step = 0; step < maxSteps; step += 1) {
    const action = await options.provider.nextAction({
      task: options.task,
      events: session.trace.events
    });

    if (action.kind === "plan") {
      session.trace.record({ type: "plan", message: action.content });
      continue;
    }

    if (action.kind === "tool") {
      session.trace.record({ type: "tool_call", message: `${action.toolName} ${JSON.stringify(action.input)}` });
      const result = await options.tools.execute(action.toolName, action.input);
      session.trace.record({ type: "tool_result", message: result.content });
      continue;
    }

    session.trace.record({ type: "final", message: action.content });

    return {
      exitCode: 0,
      summary: action.content,
      trace: session.trace
    };
  }

  const summary = `Stopped after ${maxSteps} steps without a final answer.`;
  session.trace.record({ type: "final", message: summary });

  return {
    exitCode: 1,
    summary,
    trace: session.trace
  };
}
