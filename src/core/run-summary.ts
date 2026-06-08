import type { JsonValue, TraceEvent } from "../agent/trace.js";

export interface VerificationEvidence {
  command: string;
  exitCode?: number;
  passed: boolean;
}

export interface BlockedActionEvidence {
  reason: string;
  action?: string;
  command?: string;
  toolName?: string;
}

export interface RunSummaryEvidence {
  task: string;
  providerFinal: string;
  modifiedFiles: string[];
  verification: VerificationEvidence[];
  blockedActions: BlockedActionEvidence[];
  remainingRisks: string[];
  traceEventCount: number;
}

type JsonObject = { [key: string]: JsonValue };

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asJsonValues(value: JsonValue | undefined): JsonValue[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function addUnique<T>(items: T[], item: T, key: string, seen: Set<string>): void {
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  items.push(item);
}

function toVerificationEvidence(value: JsonValue): VerificationEvidence | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }

  const exitCode = typeof value.exitCode === "number" ? value.exitCode : undefined;
  const passed = typeof value.passed === "boolean" ? value.passed : exitCode === 0;
  const command = typeof value.command === "string" ? value.command : "unknown verification";
  const evidence: VerificationEvidence = { command, passed };

  if (exitCode !== undefined) {
    evidence.exitCode = exitCode;
  }

  return evidence;
}

function toBlockedActionEvidence(value: JsonValue): BlockedActionEvidence | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }

  const reason =
    typeof value.reason === "string"
      ? value.reason
      : typeof value.message === "string"
        ? value.message
        : "Action was blocked.";
  const evidence: BlockedActionEvidence = { reason };

  if (typeof value.action === "string") {
    evidence.action = value.action;
  }

  if (typeof value.command === "string") {
    evidence.command = value.command;
  }

  if (typeof value.toolName === "string") {
    evidence.toolName = value.toolName;
  }

  return evidence;
}

function collectModifiedFiles(events: TraceEvent[]): string[] {
  const files = new Set<string>();

  for (const event of events) {
    const modifiedFiles = event.metadata?.modifiedFiles;

    if (!Array.isArray(modifiedFiles)) {
      continue;
    }

    for (const file of modifiedFiles) {
      if (typeof file === "string") {
        files.add(file);
      }
    }
  }

  return [...files].sort();
}

export function createRunSummaryEvidence(
  task: string,
  providerFinal: string,
  events: TraceEvent[]
): RunSummaryEvidence {
  const modifiedFiles = collectModifiedFiles(events);
  const verification: VerificationEvidence[] = [];
  const blockedActions: BlockedActionEvidence[] = [];
  const remainingRisks: string[] = [];
  const seenVerification = new Set<string>();
  const seenBlockedActions = new Set<string>();
  const seenRemainingRisks = new Set<string>();

  for (const event of events) {
    for (const value of asJsonValues(event.metadata?.verification)) {
      const evidence = toVerificationEvidence(value);

      if (evidence) {
        addUnique(verification, evidence, JSON.stringify(evidence), seenVerification);
      }
    }

    for (const value of asJsonValues(event.metadata?.blockedAction)) {
      const evidence = toBlockedActionEvidence(value);

      if (evidence) {
        addUnique(blockedActions, evidence, JSON.stringify(evidence), seenBlockedActions);
      }
    }

    for (const value of asJsonValues(event.metadata?.remainingRisks)) {
      if (typeof value === "string") {
        addUnique(remainingRisks, value, value, seenRemainingRisks);
      }
    }
  }

  for (const action of blockedActions) {
    addUnique(remainingRisks, action.reason, action.reason, seenRemainingRisks);
  }

  if (verification.some((item) => !item.passed)) {
    addUnique(
      remainingRisks,
      "One or more verification commands failed.",
      "One or more verification commands failed.",
      seenRemainingRisks
    );
  }

  if (
    modifiedFiles.length === 0 &&
    blockedActions.length === 0 &&
    verification.length === 0 &&
    remainingRisks.length === 0
  ) {
    addUnique(
      remainingRisks,
      "No verification command was recorded.",
      "No verification command was recorded.",
      seenRemainingRisks
    );
  }

  return {
    task,
    providerFinal,
    modifiedFiles,
    verification,
    blockedActions,
    remainingRisks,
    traceEventCount: events.length
  };
}
