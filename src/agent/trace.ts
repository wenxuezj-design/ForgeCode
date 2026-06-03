export type TraceEventType = "plan" | "tool_call" | "tool_result" | "verification" | "final";

export interface TraceEvent {
  type: TraceEventType;
  message: string;
  timestamp: string;
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
