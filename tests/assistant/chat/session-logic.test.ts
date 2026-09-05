import { type OrchestrationThreadActivity, TurnId } from "@cozea/assistant-contracts";
import { describe, expect, it } from "vitest";

import {
  deriveActiveWorkStartedAt,
  derivePendingApprovals,
  derivePendingUserInputs,
  derivePhase,
  formatDuration,
  hasToolActivityForTurn,
} from "@/features/assistant/chat/session-logic";
import type { ThreadSession } from "@/features/assistant/model/types";

import { makeActivity } from "./activityFixture";

describe("formatDuration", () => {
  it("uses whole seconds without millisecond or decimal output", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(250)).toBe("1s");
    expect(formatDuration(1_049)).toBe("1s");
    expect(formatDuration(1_950)).toBe("2s");
  });
});


describe("pending request derivation", () => {
  it("clears pending approvals after stale provider response failures", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "approval-requested",
        kind: "approval.requested",
        tone: "approval",
        payload: {
          requestId: "approval-1",
          requestKind: "command",
          detail: "bun test",
        },
      }),
      makeActivity({
        id: "approval-failed",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "provider.approval.respond.failed",
        tone: "error",
        payload: {
          requestId: "approval-1",
          detail: "No active provider session is bound to this thread.",
        },
      }),
    ];

    expect(derivePendingApprovals(activities)).toEqual([]);
  });

  it("clears pending user-input requests after startup stale markers", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "user-input-requested",
        kind: "user-input.requested",
        tone: "info",
        payload: {
          requestId: "input-1",
          questions: [
            {
              id: "scope",
              header: "Scope",
              question: "Which scope?",
              options: [{ label: "Small", description: "Small scope" }],
            },
          ],
        },
      }),
      makeActivity({
        id: "user-input-failed",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "provider.user-input.respond.failed",
        tone: "error",
        payload: {
          requestId: "input-1",
          detail:
            "Stale pending user-input request: input-1. Provider callback state does not survive app restarts.",
        },
      }),
    ];

    expect(derivePendingUserInputs(activities)).toEqual([]);
  });
});

describe("hasToolActivityForTurn", () => {
  it("returns false when turn id is missing", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({ id: "tool-1", turnId: "turn-1", kind: "tool.completed", tone: "tool" }),
    ];

    expect(hasToolActivityForTurn(activities, undefined)).toBe(false);
    expect(hasToolActivityForTurn(activities, null)).toBe(false);
  });

  it("returns true only for matching tool activity in the target turn", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({ id: "tool-1", turnId: "turn-1", kind: "tool.completed", tone: "tool" }),
      makeActivity({ id: "info-1", turnId: "turn-2", kind: "turn.completed", tone: "info" }),
    ];

    expect(hasToolActivityForTurn(activities, TurnId.makeUnsafe("turn-1"))).toBe(true);
    expect(hasToolActivityForTurn(activities, TurnId.makeUnsafe("turn-2"))).toBe(false);
  });
});

describe("derivePhase", () => {
  function makeSession(status: ThreadSession["status"]): ThreadSession {
    return {
      provider: "codex",
      status,
      orchestrationStatus:
        status === "connecting" ? "starting" : status === "closed" ? "idle" : status,
      createdAt: "2026-02-23T00:00:00.000Z",
      updatedAt: "2026-02-23T00:00:00.000Z",
    };
  }

  it("preserves interrupted, stopped, and error states", () => {
    expect(derivePhase(makeSession("interrupted"))).toBe("interrupted");
    expect(derivePhase(makeSession("stopped"))).toBe("stopped");
    expect(derivePhase(makeSession("error"))).toBe("error");
  });
});

describe("deriveActiveWorkStartedAt", () => {
  it("prefers the pending send timestamp when the previous turn is already settled", () => {
    const startedAt = deriveActiveWorkStartedAt(
      {
        turnId: TurnId.makeUnsafe("turn-previous"),
        startedAt: "2026-02-23T00:00:00.000Z",
        completedAt: "2026-02-23T00:00:05.000Z",
      },
      // deriveActiveWorkStartedAt reads the orchestration status and nothing
      // else; the provider, connection status and timestamps this literal used
      // to carry were never read and no longer typecheck against the narrowed
      // parameter.
      { orchestrationStatus: "idle" },
      "2026-02-23T00:00:07.000Z",
    );

    expect(startedAt).toBe("2026-02-23T00:00:07.000Z");
  });
});
 it("retains old async questions and native option IDs through turn completion and transient resume failure", () => {
   const activities = [makeActivity({ kind: "user-input.requested", sequence: 1, payload: {
     requestId: "async", responseMode: "message", questions: [{ id: "choice", header: "Choice", question: "Which?", options: [{ label: "First", description: "", value: "native-1" }], allowCustomAnswer: false }, { id: "text", header: "Text", question: "Why?", options: [] }],
   } }), ...Array.from({ length: 600 }, (_, index) => makeActivity({ sequence: index + 2 })),
   makeActivity({ kind: "turn.completed", sequence: 603 }),
   makeActivity({ kind: "provider.user-input.respond.failed", sequence: 604, payload: { requestId: "async", detail: "No active provider session is bound to this thread." } })];
   const pending = derivePendingUserInputs(activities);
   expect(pending).toHaveLength(1);
   expect(pending[0]?.responseMode).toBe("message");
   expect(pending[0]?.questions[0]?.options[0]?.value).toBe("native-1");
   expect(pending[0]?.questions[0]?.allowCustomAnswer).toBe(false);
   expect(pending[0]?.questions[1]?.options).toEqual([]);
   expect(derivePendingUserInputs([...activities, makeActivity({ kind: "user-input.resolved", sequence: 605, payload: { requestId: "async" } })])).toEqual([]);
 });

it("preserves OpenCode workspace-grant labels and warnings through a failed reply", () => {
  const options = [{ decision: "accept", label: "Allow once" }, { decision: "acceptForSession", label: "Allow for workspace", warning: "Applies to other sessions in this workspace." }, { decision: "decline", label: "Deny" }];
  const activities = [makeActivity({ kind: "approval.requested", sequence: 1, payload: { requestId: "permission", requestKind: "command", detail: "bash", options } }), makeActivity({ kind: "provider.approval.respond.failed", sequence: 2, payload: { requestId: "permission", detail: "Connection lost" } })];
  expect(derivePendingApprovals(activities)[0]?.options).toEqual(options);
  expect(derivePendingApprovals([...activities, makeActivity({ kind: "approval.resolved", sequence: 3, payload: { requestId: "permission" } })])).toEqual([]);
});
it("keeps unknown approval kinds visible without inventing permission options", () => {
  const result = derivePendingApprovals([makeActivity({ kind: "approval.requested", payload: { requestId: "new-permission", requestType: "future_security_prompt", options: [{ decision: "unknown-grant", label: "Grant" }] } })]);
  expect(result[0]?.requestKind).toBe("other");
  expect(result[0]?.options).toEqual([]);
});
it("retains app identity, exact approval choices, warnings, and full details", () => {
  const options = [{ decision: "accept" as const, label: "Allow this request", warning: "Access to private files" }];
  const approvals = derivePendingApprovals([makeActivity({ kind: "approval.requested", payload: {
    requestId: "app-permission", requestKind: "mcp-elicitation", appName: "Connected Drive",
    detail: "Read the selected folder\nIncluding nested files", options,
  } })]);
  expect(approvals[0]).toMatchObject({ appName: "Connected Drive", detail: "Read the selected folder\nIncluding nested files", options });
});
