import assert from "node:assert/strict";
import { test } from "node:test";

import { createHelpMessage, createWelcomeMessage, runCli } from "../dist/app.js";

test("creates a welcome message with the project name and purpose", () => {
  const message = createWelcomeMessage();

  assert.match(message, /ForgeCode/);
  assert.match(message, /open coding agent/i);
  assert.match(message, /from first principles/i);
});

test("prints the welcome message when no command is provided", async () => {
  const result = await runCli([]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /ForgeCode/);
  assert.equal(result.stderr, "");
});

test("prints the current version", async () => {
  const result = await runCli(["--version"]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), "0.1.0");
  assert.equal(result.stderr, "");
});

test("creates help text with available commands", () => {
  const message = createHelpMessage();

  assert.match(message, /Usage: forgecode/);
  assert.match(message, /--help/);
  assert.match(message, /--version/);
});

test("prints help for --help and -h", async () => {
  for (const flag of ["--help", "-h"]) {
    const result = await runCli([flag]);

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Usage: forgecode/);
    assert.equal(result.stderr, "");
  }
});

test("returns an error for unknown commands", async () => {
  const result = await runCli(["frobnicate"]);

  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Unknown command: frobnicate/);
  assert.match(result.stderr, /forgecode --help/);
});

test("runs the agent loop for the run command", async () => {
  const result = await runCli(["run", "build", "a", "tool", "registry"]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Task complete/);
  assert.match(result.stdout, /build a tool registry/);
  assert.match(result.stdout, /No provider actions configured/);
  assert.equal(result.stderr, "");
});

test("requires a task for the run command", async () => {
  const result = await runCli(["run"]);

  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Missing task/);
  assert.match(result.stderr, /forgecode run/);
});
