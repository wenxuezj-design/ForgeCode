export interface TextDiffInput {
  path: string;
  before: string;
  after: string;
}

type DiffOperation =
  | { kind: "context"; line: string }
  | { kind: "removed"; line: string }
  | { kind: "added"; line: string };

function splitTextLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }

  const lines = text.replace(/\r\n/g, "\n").split("\n");

  if (lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines;
}

function buildLcsTable(beforeLines: string[], afterLines: string[]): number[][] {
  const table = Array.from({ length: beforeLines.length + 1 }, () =>
    Array<number>(afterLines.length + 1).fill(0)
  );

  for (let beforeIndex = beforeLines.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = afterLines.length - 1; afterIndex >= 0; afterIndex -= 1) {
      table[beforeIndex][afterIndex] =
        beforeLines[beforeIndex] === afterLines[afterIndex]
          ? table[beforeIndex + 1][afterIndex + 1] + 1
          : Math.max(table[beforeIndex + 1][afterIndex], table[beforeIndex][afterIndex + 1]);
    }
  }

  return table;
}

function diffLines(beforeLines: string[], afterLines: string[]): DiffOperation[] {
  const table = buildLcsTable(beforeLines, afterLines);
  const operations: DiffOperation[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;

  while (beforeIndex < beforeLines.length && afterIndex < afterLines.length) {
    if (beforeLines[beforeIndex] === afterLines[afterIndex]) {
      operations.push({ kind: "context", line: beforeLines[beforeIndex] });
      beforeIndex += 1;
      afterIndex += 1;
      continue;
    }

    if (table[beforeIndex + 1][afterIndex] >= table[beforeIndex][afterIndex + 1]) {
      operations.push({ kind: "removed", line: beforeLines[beforeIndex] });
      beforeIndex += 1;
      continue;
    }

    operations.push({ kind: "added", line: afterLines[afterIndex] });
    afterIndex += 1;
  }

  while (beforeIndex < beforeLines.length) {
    operations.push({ kind: "removed", line: beforeLines[beforeIndex] });
    beforeIndex += 1;
  }

  while (afterIndex < afterLines.length) {
    operations.push({ kind: "added", line: afterLines[afterIndex] });
    afterIndex += 1;
  }

  return operations;
}

function formatOperation(operation: DiffOperation): string {
  if (operation.kind === "context") {
    return ` ${operation.line}`;
  }

  if (operation.kind === "removed") {
    return `-${operation.line}`;
  }

  return `+${operation.line}`;
}

export function createTextDiff(input: TextDiffInput): string {
  if (input.before === input.after) {
    return "";
  }

  const beforeLines = splitTextLines(input.before);
  const afterLines = splitTextLines(input.after);

  return [
    `--- ${input.path}`,
    `+++ ${input.path}`,
    "@@",
    ...diffLines(beforeLines, afterLines).map(formatOperation)
  ].join("\n");
}
