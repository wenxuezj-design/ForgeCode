import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createCommandTool } from "../dist/tools/command-tool.js";
import { createToolRegistry } from "../dist/tools/registry.js";

function assertApprovalBlocked(
  result: Awaited<ReturnType<ReturnType<typeof createCommandTool>["execute"]>>,
  command: string,
  reason = "Destructive command requires approval.",
  risk = "destructive"
): void {
  assert.equal(result.success, false);
  assert.match(result.content, /requires approval/i);
  assert.equal(result.metadata?.risk, risk);
  assert.deepEqual(result.metadata?.blockedAction, {
    kind: "approval",
    reason,
    command
  });
}

test("registry rejects duplicate tool names and executes registered tools", async () => {
  const registry = createToolRegistry();

  registry.register({
    name: "echo",
    description: "Echo input.",
    async execute(input) {
      return { content: JSON.stringify(input) };
    }
  });

  assert.throws(
    () => registry.register({
      name: "echo",
      description: "Duplicate echo.",
      async execute() {
        return { content: "" };
      }
    }),
    /already registered/
  );
  assert.deepEqual(await registry.execute("echo", { value: 1 }), { content: "{\"value\":1}" });
});

test("registry rejects unknown tools during execution", async () => {
  const registry = createToolRegistry();

  await assert.rejects(
    () => registry.execute("missing_tool", {}),
    /Unknown tool: missing_tool/
  );
});

test("registry preserves structured tool result metadata", async () => {
  const registry = createToolRegistry();

  registry.register({
    name: "structured",
    description: "Return metadata.",
    async execute() {
      return {
        success: true,
        content: "ok",
        metadata: {
          kind: "diff",
          path: "README.md"
        }
      };
    }
  });

  assert.deepEqual(await registry.execute("structured", {}), {
    success: true,
    content: "ok",
    metadata: {
      kind: "diff",
      path: "README.md"
    }
  });
});

test("command tool captures stdout, stderr, and exit code", async () => {
  const tool = createCommandTool({ cwd: process.cwd() });

  const result = await tool.execute({ command: "node", args: ["--version"] });

  assert.match(result.content, /exitCode=0/);
  assert.match(result.content, /stdout=v/);
  assert.match(result.content, /stderr=/);
});

test("command tool returns structured command metadata", async () => {
  const tool = createCommandTool({ cwd: process.cwd() });

  const result = await tool.execute({ command: "node", args: ["--version"] });

  assert.equal(result.success, true);
  assert.equal(result.metadata?.risk, "safe");
  assert.deepEqual(result.metadata?.verification, {
    command: "node --version",
    exitCode: 0,
    passed: true,
    output: result.content
  });
});

test("command tool refuses destructive commands by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "rm", args: ["sentinel.txt"] });

  assertApprovalBlocked(result, "rm sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses path-qualified rm by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "/bin/rm", args: ["sentinel.txt"] });

  assertApprovalBlocked(result, "/bin/rm sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses uppercase path-qualified rm by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "/bin/RM", args: ["sentinel.txt"] });

  assertApprovalBlocked(result, "/bin/RM sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses rmdir by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const target = join(root, "target");
  await mkdir(target);
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "rmdir", args: ["target"] });

  assertApprovalBlocked(result, "rmdir target");
  assert.equal((await stat(target)).isDirectory(), true);
});

test("command tool refuses mv by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const source = join(root, "old.txt");
  await writeFile(source, "old\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "mv", args: ["old.txt", "new.txt"] });

  assertApprovalBlocked(result, "mv old.txt new.txt");
  assert.equal(await readFile(source, "utf8"), "old\n");
});

test("command tool refuses path-qualified mv by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const source = join(root, "old.txt");
  await writeFile(source, "old\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "/bin/mv", args: ["old.txt", "new.txt"] });

  assertApprovalBlocked(result, "/bin/mv old.txt new.txt");
  assert.equal(await readFile(source, "utf8"), "old\n");
});

test("command tool resolves spawn errors with structured verification metadata", async () => {
  const tool = createCommandTool({ cwd: process.cwd() });

  const result = await tool.execute({ command: "definitely-not-a-real-forgecode-command", args: [] });

  assert.equal(result.success, false);
  assert.match(result.content, /exitCode=1/);
  assert.match(result.content, /stdout=/);
  assert.match(result.content, /stderr=.*definitely-not-a-real-forgecode-command/);
  assert.equal(result.metadata?.risk, "unknown");
  assert.deepEqual(result.metadata?.verification, {
    command: "definitely-not-a-real-forgecode-command",
    exitCode: 1,
    passed: false,
    output: result.content
  });
});

test("command tool refuses unknown commands with allow-safe policy", async () => {
  const tool = createCommandTool({ cwd: process.cwd(), approvalPolicy: "allow-safe" });

  const result = await tool.execute({ command: "definitely-not-a-real-forgecode-command", args: [] });

  assertApprovalBlocked(
    result,
    "definitely-not-a-real-forgecode-command",
    "Command risk is not safe.",
    "unknown"
  );
  assert.equal(result.metadata?.risk, "unknown");
});

test("command tool refuses node eval with allow-safe policy", async () => {
  const tool = createCommandTool({ cwd: process.cwd(), approvalPolicy: "allow-safe" });

  const result = await tool.execute({ command: "node", args: ["-e", ""] });

  assertApprovalBlocked(result, "node -e ", "Command risk is not safe.", "unknown");
});

test("command tool refuses path-qualified node safe names with allow-safe policy", async () => {
  const tool = createCommandTool({ cwd: process.cwd(), approvalPolicy: "allow-safe" });

  const result = await tool.execute({ command: "./node", args: ["--version"] });

  assertApprovalBlocked(result, "./node --version", "Command risk is not safe.", "unknown");
});

test("command tool does not refuse read-only git commands by default", async () => {
  const tool = createCommandTool({ cwd: process.cwd() });

  const result = await tool.execute({ command: "git", args: ["status", "--short"] });

  assert.equal(result.success, true);
  assert.equal(result.metadata?.blockedAction, undefined);
});

test("command tool allows read-only git status with allow-safe policy", async () => {
  const tool = createCommandTool({ cwd: process.cwd(), approvalPolicy: "allow-safe" });

  const result = await tool.execute({ command: "git", args: ["status", "--short"] });

  assert.equal(result.success, true);
  assert.equal(result.metadata?.risk, "safe");
  assert.equal(result.metadata?.blockedAction, undefined);
});

test("command tool refuses git status with global config under allow-safe policy", async () => {
  const tool = createCommandTool({ cwd: process.cwd(), approvalPolicy: "allow-safe" });

  const result = await tool.execute({
    command: "git",
    args: ["-c", "core.fsmonitor=/tmp/hook", "status", "--short"]
  });

  assertApprovalBlocked(
    result,
    "git -c core.fsmonitor=/tmp/hook status --short",
    "Command risk is not safe.",
    "unknown"
  );
});

test("command tool refuses path-qualified git safe names with allow-safe policy", async () => {
  const tool = createCommandTool({ cwd: process.cwd(), approvalPolicy: "allow-safe" });

  const result = await tool.execute({ command: "./git", args: ["status", "--short"] });

  assertApprovalBlocked(result, "./git status --short", "Command risk is not safe.", "unknown");
});

test("command tool refuses undocumented git status shorthand with allow-safe policy", async () => {
  const tool = createCommandTool({ cwd: process.cwd(), approvalPolicy: "allow-safe" });

  const result = await tool.execute({ command: "git", args: ["status", "-s"] });

  assertApprovalBlocked(result, "git status -s", "Command risk is not safe.", "unknown");
});

test("command tool refuses git status porcelain with allow-safe policy", async () => {
  const tool = createCommandTool({ cwd: process.cwd(), approvalPolicy: "allow-safe" });

  const result = await tool.execute({ command: "git", args: ["status", "--porcelain"] });

  assertApprovalBlocked(result, "git status --porcelain", "Command risk is not safe.", "unknown");
});

test("command tool refuses force flags by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "node", args: ["--force"] });

  assertApprovalBlocked(result, "node --force");
});

test("command tool refuses force flag variants by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "node", args: ["--force-with-lease"] });

  assertApprovalBlocked(result, "node --force-with-lease");
});

test("command tool refuses shell -c commands by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "sh", args: ["-c", "rm sentinel.txt"] });

  assertApprovalBlocked(result, "sh -c rm sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses combined shell -lc commands by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "bash", args: ["-lc", "rm sentinel.txt"] });

  assertApprovalBlocked(result, "bash -lc rm sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses path-qualified combined shell -lc commands by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "/bin/bash", args: ["-lc", "rm sentinel.txt"] });

  assertApprovalBlocked(result, "/bin/bash -lc rm sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses bash.exe command strings by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "bash.exe", args: ["-c", "rm sentinel.txt"] });

  assertApprovalBlocked(result, "bash.exe -c rm sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses path-qualified dash command strings by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "/bin/dash", args: ["-c", "rm sentinel.txt"] });

  assertApprovalBlocked(result, "/bin/dash -c rm sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses uppercase path-qualified shell command strings by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "/bin/SH", args: ["-c", "rm sentinel.txt"] });

  assertApprovalBlocked(result, "/bin/SH -c rm sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses fish command strings by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "fish", args: ["--command", "rm sentinel.txt"] });

  assertApprovalBlocked(result, "fish --command rm sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses fish init command strings by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "fish", args: ["-C", "rm sentinel.txt"] });

  assertApprovalBlocked(result, "fish -C rm sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses fish long init command strings by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "fish", args: ["--init-command", "rm sentinel.txt"] });

  assertApprovalBlocked(result, "fish --init-command rm sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses powershell command strings by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "pwsh", args: ["-Command", "rm sentinel.txt"] });

  assertApprovalBlocked(result, "pwsh -Command rm sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses powershell encoded command strings by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "pwsh", args: ["-EncodedCommand", "AAA="] });

  assertApprovalBlocked(result, "pwsh -EncodedCommand AAA=");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses powershell encoded command alias by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "pwsh", args: ["-e", "AAA="] });

  assertApprovalBlocked(result, "pwsh -e AAA=");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses powershell.exe command strings by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "powershell.exe", args: ["-Command", "rm sentinel.txt"] });

  assertApprovalBlocked(result, "powershell.exe -Command rm sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses cmd command strings by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "cmd", args: ["/c", "del sentinel.txt"] });

  assertApprovalBlocked(result, "cmd /c del sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses cmd.exe command strings by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "cmd.exe", args: ["/c", "del sentinel.txt"] });

  assertApprovalBlocked(result, "cmd.exe /c del sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses cmd.exe attached slash command strings by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "cmd.exe", args: ["/Cdel sentinel.txt"] });

  assertApprovalBlocked(result, "cmd.exe /Cdel sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses cmd.exe combined slash command strings by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "cmd.exe", args: ["/Q/Cdel sentinel.txt"] });

  assertApprovalBlocked(result, "cmd.exe /Q/Cdel sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses uppercase cmd.exe command strings by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "CMD.EXE", args: ["/c", "del sentinel.txt"] });

  assertApprovalBlocked(result, "CMD.EXE /c del sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses cmd keepalive command strings by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "cmd", args: ["/k", "del sentinel.txt"] });

  assertApprovalBlocked(result, "cmd /k del sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses env-wrapped shell command strings by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "/usr/bin/env", args: ["bash", "-lc", "rm sentinel.txt"] });

  assertApprovalBlocked(result, "/usr/bin/env bash -lc rm sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses env-wrapped bash.exe command strings by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "/usr/bin/env", args: ["bash.exe", "-c", "rm sentinel.txt"] });

  assertApprovalBlocked(result, "/usr/bin/env bash.exe -c rm sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses env-wrapped dash command strings by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "/usr/bin/env", args: ["/bin/dash", "-c", "rm sentinel.txt"] });

  assertApprovalBlocked(result, "/usr/bin/env /bin/dash -c rm sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses env-wrapped uppercase shell command strings by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "/usr/bin/env", args: ["/bin/SH", "-c", "rm sentinel.txt"] });

  assertApprovalBlocked(result, "/usr/bin/env /bin/SH -c rm sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses env-wrapped destructive utilities by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "/usr/bin/env", args: ["rm", "sentinel.txt"] });

  assertApprovalBlocked(result, "/usr/bin/env rm sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses env argv0 destructive utilities by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "/usr/bin/env", args: ["-a", "fake", "rm", "sentinel.txt"] });

  assertApprovalBlocked(result, "/usr/bin/env -a fake rm sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses env argv0 equals destructive utilities by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "/usr/bin/env", args: ["--argv0=fake", "rm", "sentinel.txt"] });

  assertApprovalBlocked(result, "/usr/bin/env --argv0=fake rm sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses env attached argv0 destructive utilities by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "/usr/bin/env", args: ["-afake", "rm", "sentinel.txt"] });

  assertApprovalBlocked(result, "/usr/bin/env -afake rm sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses env split-string destructive utilities by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "/usr/bin/env", args: ["-S", "rm sentinel.txt"] });

  assertApprovalBlocked(result, "/usr/bin/env -S rm sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses env-wrapped destructive git commands by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "/usr/bin/env", args: ["git", "reset", "--hard"] });

  assertApprovalBlocked(result, "/usr/bin/env git reset --hard");
});

test("command tool refuses nested env-wrapped shell command strings by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({
    command: "/usr/bin/env",
    args: ["/usr/bin/env", "sh", "-c", "rm sentinel.txt"]
  });

  assertApprovalBlocked(result, "/usr/bin/env /usr/bin/env sh -c rm sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses env wrapper chains that exceed scan depth by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });
  const envChain = Array.from({ length: 8 }, () => "/usr/bin/env");

  const result = await tool.execute({
    command: "/usr/bin/env",
    args: [...envChain, "sh", "-c", "rm sentinel.txt"]
  });

  assertApprovalBlocked(result, `/usr/bin/env ${envChain.join(" ")} sh -c rm sentinel.txt`);
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses env split-string shell command strings by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "/usr/bin/env", args: ["-S", "bash -lc rm sentinel.txt"] });

  assertApprovalBlocked(result, "/usr/bin/env -S bash -lc rm sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses env attached split-string shell command strings by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "/usr/bin/env", args: ["-Ssh -c rm sentinel.txt"] });

  assertApprovalBlocked(result, "/usr/bin/env -Ssh -c rm sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses env combined split-string shell command strings by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "/usr/bin/env", args: ["-iSsh -c rm sentinel.txt"] });

  assertApprovalBlocked(result, "/usr/bin/env -iSsh -c rm sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses env unset shell command strings by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "/usr/bin/env", args: ["-uSHELL", "sh", "-c", "rm sentinel.txt"] });

  assertApprovalBlocked(result, "/usr/bin/env -uSHELL sh -c rm sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses env split-string shell commands after assignments by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "/usr/bin/env", args: ["-S", "FOO=bar sh -c rm sentinel.txt"] });

  assertApprovalBlocked(result, "/usr/bin/env -S FOO=bar sh -c rm sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses env chdir shell command strings by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: process.cwd() });

  const result = await tool.execute({ command: "/usr/bin/env", args: ["-C", root, "sh", "-c", "rm sentinel.txt"] });

  assertApprovalBlocked(result, `/usr/bin/env -C ${root} sh -c rm sentinel.txt`);
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses env path shell command strings by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "/usr/bin/env", args: ["-P", "/bin", "sh", "-c", "rm sentinel.txt"] });

  assertApprovalBlocked(result, "/usr/bin/env -P /bin sh -c rm sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses combined shell -ec commands by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "sh", args: ["-ec", "rm sentinel.txt"] });

  assertApprovalBlocked(result, "sh -ec rm sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses path-qualified shell -c commands by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "keep me\n");
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "/bin/sh", args: ["-c", "rm sentinel.txt"] });

  assertApprovalBlocked(result, "/bin/sh -c rm sentinel.txt");
  assert.equal(await readFile(sentinel, "utf8"), "keep me\n");
});

test("command tool refuses destructive git commands after global options", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "git", args: ["-C", root, "clean"] });

  assertApprovalBlocked(result, `git -C ${root} clean`);
});

test("command tool refuses destructive git reset and checkout by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const tool = createCommandTool({ cwd: root });

  const reset = await tool.execute({ command: "git", args: ["reset", "--hard"] });
  const checkout = await tool.execute({ command: "git", args: ["checkout", "README.md"] });

  assertApprovalBlocked(reset, "git reset --hard");
  assertApprovalBlocked(checkout, "git checkout README.md");
});

test("command tool refuses destructive git restore by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const tool = createCommandTool({ cwd: root });

  const result = await tool.execute({ command: "git", args: ["restore", "README.md"] });

  assertApprovalBlocked(result, "git restore README.md");
});

test("command tool refuses destructive git rm and switch by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const tool = createCommandTool({ cwd: root });

  const remove = await tool.execute({ command: "git", args: ["rm", "README.md"] });
  const switchBranch = await tool.execute({ command: "git", args: ["switch", "feature"] });

  assertApprovalBlocked(remove, "git rm README.md");
  assertApprovalBlocked(switchBranch, "git switch feature");
});

test("command tool refuses destructive git branch deletes by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const tool = createCommandTool({ cwd: root });

  const forceDelete = await tool.execute({ command: "git", args: ["branch", "-D", "feature"] });
  const deleteBranch = await tool.execute({ command: "git", args: ["branch", "-d", "feature"] });
  const longDelete = await tool.execute({ command: "git", args: ["branch", "--delete", "feature"] });
  const combinedDelete = await tool.execute({ command: "git", args: ["branch", "-df", "feature"] });

  assertApprovalBlocked(forceDelete, "git branch -D feature");
  assertApprovalBlocked(deleteBranch, "git branch -d feature");
  assertApprovalBlocked(longDelete, "git branch --delete feature");
  assertApprovalBlocked(combinedDelete, "git branch -df feature");
});

test("command tool refuses destructive git tag deletes by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const tool = createCommandTool({ cwd: root });

  const shortDelete = await tool.execute({ command: "git", args: ["tag", "-d", "v1"] });
  const longDelete = await tool.execute({ command: "git", args: ["tag", "--delete", "v1"] });
  const combinedDelete = await tool.execute({ command: "git", args: ["tag", "-df", "v1"] });

  assertApprovalBlocked(shortDelete, "git tag -d v1");
  assertApprovalBlocked(longDelete, "git tag --delete v1");
  assertApprovalBlocked(combinedDelete, "git tag -df v1");
});

test("command tool refuses destructive git push deletes by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const tool = createCommandTool({ cwd: root });

  const deleteFlag = await tool.execute({ command: "git", args: ["push", "origin", "--delete", "feature"] });
  const shortDelete = await tool.execute({ command: "git", args: ["push", "origin", "-d", "feature"] });
  const forceDelete = await tool.execute({ command: "git", args: ["push", "origin", "-D", "feature"] });
  const refDelete = await tool.execute({ command: "git", args: ["push", "origin", ":feature"] });
  const forcedRefDelete = await tool.execute({ command: "git", args: ["push", "origin", "+:feature"] });
  const groupedForce = await tool.execute({ command: "git", args: ["push", "-uf", "origin", "main"] });
  const forcedRefUpdate = await tool.execute({ command: "git", args: ["push", "origin", "+HEAD:feature"] });
  const mirror = await tool.execute({ command: "git", args: ["push", "--mirror", "origin"] });
  const prune = await tool.execute({ command: "git", args: ["push", "--prune", "origin"] });

  assertApprovalBlocked(deleteFlag, "git push origin --delete feature");
  assertApprovalBlocked(shortDelete, "git push origin -d feature");
  assertApprovalBlocked(forceDelete, "git push origin -D feature");
  assertApprovalBlocked(refDelete, "git push origin :feature");
  assertApprovalBlocked(forcedRefDelete, "git push origin +:feature");
  assertApprovalBlocked(groupedForce, "git push -uf origin main");
  assertApprovalBlocked(forcedRefUpdate, "git push origin +HEAD:feature");
  assertApprovalBlocked(mirror, "git push --mirror origin");
  assertApprovalBlocked(prune, "git push --prune origin");
});

test("command tool records allow-all approval metadata for destructive commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecode-command-tool-"));
  const tool = createCommandTool({ cwd: root, approvalPolicy: "allow-all" });

  const result = await tool.execute({ command: "node", args: ["--force", "-e", ""] });
  const verification = result.metadata?.verification as { command?: string } | undefined;

  assert.equal(result.metadata?.risk, "destructive");
  assert.deepEqual(result.metadata?.approval, { policy: "allow-all" });
  assert.equal(verification?.command, "node --force -e ");
});
