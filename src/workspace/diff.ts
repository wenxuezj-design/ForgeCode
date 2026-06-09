export interface TextDiffInput {
  path: string;
  before: string;
  after: string;
  isNewFile?: boolean;
}

const MAX_DETAILED_DIFF_LINES = 1_000;
const MAX_DETAILED_DIFF_CELLS = 250_000;
const MAX_DETAILED_DIFF_CHARS = 200_000;

type DiffOperation =
  | { kind: "context"; line: string }
  | { kind: "removed"; line: string }
  | { kind: "added"; line: string };

interface SplitText {
  lines: string[];
  endsWithNewline: boolean;
}

function splitText(text: string): SplitText {
  if (text.length === 0) {
    return {
      lines: [],
      endsWithNewline: false
    };
  }

  const lines = text.split("\n");
  const endsWithNewline = text.endsWith("\n");

  if (endsWithNewline) {
    lines.pop();
  }

  return {
    lines,
    endsWithNewline
  };
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

function linesEqual(beforeLines: string[], afterLines: string[]): boolean {
  if (beforeLines.length !== afterLines.length) {
    return false;
  }

  return beforeLines.every((line, index) => line === afterLines[index]);
}

function buildOperations(before: SplitText, after: SplitText): DiffOperation[] {
  if (
    before.endsWithNewline !== after.endsWithNewline &&
    before.lines.length > 0 &&
    linesEqual(before.lines, after.lines)
  ) {
    return [
      ...before.lines.slice(0, -1).map((line): DiffOperation => ({ kind: "context", line })),
      { kind: "removed", line: before.lines[before.lines.length - 1] },
      { kind: "added", line: after.lines[after.lines.length - 1] }
    ];
  }

  return diffLines(before.lines, after.lines);
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

function findLastOperationIndex(operations: DiffOperation[], kind: DiffOperation["kind"]): number {
  for (let index = operations.length - 1; index >= 0; index -= 1) {
    if (operations[index].kind === kind) {
      return index;
    }
  }

  return -1;
}

function formatOperations(operations: DiffOperation[], before: SplitText, after: SplitText): string[] {
  const lines: string[] = [];
  const lastRemovedIndex = findLastOperationIndex(operations, "removed");
  const lastAddedIndex = findLastOperationIndex(operations, "added");

  operations.forEach((operation, index) => {
    lines.push(formatOperation(operation));

    if (index === lastRemovedIndex && before.lines.length > 0 && !before.endsWithNewline) {
      lines.push("\\ No newline at end of file");
    }

    if (index === lastAddedIndex && after.lines.length > 0 && !after.endsWithNewline) {
      lines.push("\\ No newline at end of file");
    }
  });

  return lines;
}

function formatRange(lines: string[], emptyStart: number): string {
  if (lines.length === 0) {
    return `${emptyStart},0`;
  }

  return `1,${lines.length}`;
}

function shouldOmitDetailedDiff(input: TextDiffInput, before: SplitText, after: SplitText): boolean {
  if (input.before === input.after) {
    return false;
  }

  return (
    before.lines.length + after.lines.length > MAX_DETAILED_DIFF_LINES ||
    before.lines.length * after.lines.length > MAX_DETAILED_DIFF_CELLS ||
    input.before.length + input.after.length > MAX_DETAILED_DIFF_CHARS
  );
}

export function createTextDiff(input: TextDiffInput): string {
  if (input.before === input.after && !input.isNewFile) {
    return "";
  }

  const before = splitText(input.before);
  const after = splitText(input.after);
  const beforePath = input.isNewFile ? "/dev/null" : input.path;
  const hunkHeader = `@@ -${formatRange(before.lines, 0)} +${formatRange(after.lines, 1)} @@`;

  if (shouldOmitDetailedDiff(input, before, after)) {
    return [
      `--- ${beforePath}`,
      `+++ ${input.path}`,
      hunkHeader,
      ` Diff omitted for ${input.path}: change is too large for inline diff (${before.lines.length} before lines, ${after.lines.length} after lines).`
    ].join("\n");
  }

  const operations = buildOperations(before, after);

  return [
    `--- ${beforePath}`,
    `+++ ${input.path}`,
    hunkHeader,
    ...formatOperations(operations, before, after)
  ].join("\n");
}
