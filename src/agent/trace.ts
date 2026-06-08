export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type TraceMetadata = Record<string, JsonValue>;

export type TraceEventType =
  | "plan"
  | "tool_call"
  | "tool_result"
  | "verification"
  | "final"
  | "todo"
  | "approval"
  | "diff"
  | "protection"
  | "context"
  | "summary";

export interface TraceEvent {
  type: TraceEventType;
  message: string;
  timestamp: string;
  metadata?: TraceMetadata;
}

export interface TraceRecorder {
  events: TraceEvent[];
  record(event: Omit<TraceEvent, "timestamp">): void;
}

export function createTraceRecorder(now = () => new Date().toISOString()): TraceRecorder {
  const events: TraceEvent[] = [];

  return {
    events,
    record(event) {
      events.push({
        ...event,
        timestamp: now()
      });
    }
  };
}
