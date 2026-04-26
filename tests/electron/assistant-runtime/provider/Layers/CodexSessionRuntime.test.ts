import { describe, expect, it } from "vitest";

import {
  buildCodexSendTurnInput,
  buildCodexStartSessionInput,
} from "../../../../../electron/assistant-runtime/provider/Layers/CodexSessionRuntime.ts";

describe("CodexSessionRuntime", () => {
  it("builds Codex session start inputs from generic model selections", () => {
    expect(
      buildCodexStartSessionInput({
        threadId: "thread-1",
        cwd: "/tmp/project",
        runtimeMode: "full-access",
        binaryPath: "/opt/homebrew/bin/codex",
        homePath: "/Users/test/.codex",
        modelSelection: {
          provider: "codex",
          model: "gpt-5.4",
          options: {
            reasoningEffort: "high",
            fastMode: true,
          },
        },
      }),
    ).toEqual({
      threadId: "thread-1",
      provider: "codex",
      cwd: "/tmp/project",
      runtimeMode: "full-access",
      binaryPath: "/opt/homebrew/bin/codex",
      homePath: "/Users/test/.codex",
      model: "gpt-5.4",
      serviceTier: "fast",
    });
  });

  it("builds Codex turn inputs with canonicalized effort/service-tier selections", () => {
    expect(
      buildCodexSendTurnInput({
        threadId: "thread-1",
        input: "Ship it",
        modelSelection: {
          provider: "codex",
          model: "gpt-5.4",
          options: [
            { id: "effort", value: "xhigh" },
            { id: "fastMode", value: true },
          ],
        },
        interactionMode: "plan",
        attachments: [{ type: "image", url: "data:image/png;base64,abc" }],
      }),
    ).toEqual({
      threadId: "thread-1",
      input: "Ship it",
      model: "gpt-5.4",
      effort: "xhigh",
      serviceTier: "fast",
      interactionMode: "plan",
      attachments: [{ type: "image", url: "data:image/png;base64,abc" }],
    });
  });

  it("ignores provider-native Codex fields for non-Codex model selections", () => {
    expect(
      buildCodexSendTurnInput({
        threadId: "thread-1",
        modelSelection: {
          provider: "claudeAgent",
          model: "claude-sonnet-4-6",
          options: {
            fastMode: true,
            effort: "max",
          },
        },
      }),
    ).toEqual({
      threadId: "thread-1",
    });
  });
});
