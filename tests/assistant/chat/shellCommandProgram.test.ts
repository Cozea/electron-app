import { describe, expect, it } from "vitest";

import {
  commandProgramName,
  tokenizeShellCommand,
} from "@/features/projects/components/assistant/chat/shellCommandProgram";

describe("tokenizeShellCommand", () => {
  it("splits on unquoted whitespace", () => {
    expect(tokenizeShellCommand("bun run build")).toEqual(["bun", "run", "build"]);
    expect(tokenizeShellCommand("  bun   test  ")).toEqual(["bun", "test"]);
  });

  it("keeps quoted spans together and drops the quotes", () => {
    expect(tokenizeShellCommand(`echo "hello world"`)).toEqual(["echo", "hello world"]);
    expect(tokenizeShellCommand(`echo 'hello world'`)).toEqual(["echo", "hello world"]);
  });

  it("preserves an empty quoted argument", () => {
    expect(tokenizeShellCommand(`git commit -m ""`)).toEqual(["git", "commit", "-m", ""]);
  });

  it("keeps a command substitution as one token", () => {
    expect(tokenizeShellCommand("echo $(git rev-parse HEAD)")).toEqual([
      "echo",
      "$(git rev-parse HEAD)",
    ]);
  });

  it("treats a windows drive backslash as a literal, not an escape", () => {
    expect(tokenizeShellCommand("C:\\Program\\node.exe --version")).toEqual([
      "C:\\Program\\node.exe",
      "--version",
    ]);
  });

  it("returns null rather than guessing at unbalanced input", () => {
    expect(tokenizeShellCommand(`echo "unterminated`)).toBeNull();
    expect(tokenizeShellCommand("echo $(unclosed")).toBeNull();
    expect(tokenizeShellCommand("trailing\\")).toBeNull();
  });

  it("returns an empty list for blank input", () => {
    expect(tokenizeShellCommand("   ")).toEqual([]);
  });
});

describe("commandProgramName", () => {
  it("names the program for a plain command", () => {
    expect(commandProgramName("bun run build")).toBe("bun");
  });

  it("strips the directory from an absolute path", () => {
    expect(commandProgramName("/usr/local/bin/node script.js")).toBe("node");
    expect(commandProgramName("C:\\tools\\node.exe script.js")).toBe("node.exe");
  });

  it("skips leading environment assignments", () => {
    expect(commandProgramName("NODE_ENV=production bun run start")).toBe("bun");
    expect(commandProgramName("A=1 B=2 pytest -q")).toBe("pytest");
  });

  it("unwraps env and sudo", () => {
    expect(commandProgramName("env bun test")).toBe("bun");
    expect(commandProgramName("sudo systemctl restart nginx")).toBe("systemctl");
    expect(commandProgramName("/usr/bin/env python3 -m http.server")).toBe("python3");
  });

  it("handles env options that consume a value", () => {
    expect(commandProgramName("env -C /repo bun test")).toBe("bun");
    expect(commandProgramName("env -u PATH bun test")).toBe("bun");
  });

  it("recurses through --split-string in both spellings", () => {
    expect(commandProgramName("env -S bun test")).toBe("bun");
    expect(commandProgramName("env --split-string=bun test")).toBe("bun");
  });

  it("stops unwrapping at an explicit --", () => {
    expect(commandProgramName("sudo -- bun test")).toBe("bun");
  });

  it("unwraps nested wrappers", () => {
    expect(commandProgramName("sudo env bun test")).toBe("bun");
  });

  it("returns null when the command cannot be parsed", () => {
    expect(commandProgramName(`echo "unterminated`)).toBeNull();
    expect(commandProgramName("")).toBeNull();
    expect(commandProgramName("env")).toBeNull();
  });

  it("returns null for an unrecognized wrapper flag rather than guessing", () => {
    expect(commandProgramName("sudo --definitely-not-a-flag bun test")).toBeNull();
  });

  it("returns null when a wrapper option is missing its value", () => {
    expect(commandProgramName("env -C")).toBeNull();
  });
});
