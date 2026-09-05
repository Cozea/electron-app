// @ts-nocheck
import { describe, expect, it } from "vitest";
import {
  computeMessageDurationStart,
  deriveActiveTurnHeaderIndex,
  deriveTurnHeaderIndex,
  deriveGenerationStatusPhase,
  normalizeCompactToolLabel,
} from "@/features/assistant/chat/MessagesTimeline.logic";

describe("deriveActiveTurnHeaderIndex", () => {
  const message = (id, role, turnId) => ({
    id: `entry:${id}`,
    kind: "message",
    createdAt: "2026-01-01T00:00:00.000Z",
    message: { id, role, turnId, text: "", createdAt: "2026-01-01T00:00:00.000Z" },
  });

  it("places the active status after streamed text", () => {
    const entries = [
      message("old", "assistant", "turn-old"),
      message("user", "user"),
      message("live", "assistant", "turn-live"),
    ];
    expect(deriveActiveTurnHeaderIndex(entries, "turn-live")).toBe(3);
  });

  it("places the active status after the active turn's latest tool", () => {
    const entries = [
      message("user", "user"),
      {
        id: "entry:tool",
        kind: "work",
        createdAt: "2026-01-01T00:00:01.000Z",
        entry: { id: "tool", turnId: "turn-live" },
      },
    ];
    expect(deriveActiveTurnHeaderIndex(entries, "turn-live")).toBe(2);
  });

  it("keeps the active status at the bottom as narration and work accumulate", () => {
    const entries = [
      message("user", "user"),
      message("narration-1", "assistant", "turn-live"),
      {
        id: "entry:tool",
        kind: "work",
        createdAt: "2026-01-01T00:00:01.000Z",
        entry: { id: "tool", turnId: "turn-live" },
      },
      message("narration-2", "assistant", "turn-live"),
    ];

    expect(deriveActiveTurnHeaderIndex(entries, "turn-live")).toBe(entries.length);
  });

  it("places a pending turn status at the timeline bottom", () => {
    const entries = [
      message("old-user", "user"),
      message("old", "assistant", "turn-old"),
      message("new-user", "user"),
      message("projected-answer", "assistant", "turn-live"),
    ];
    expect(deriveActiveTurnHeaderIndex(entries, null)).toBe(4);
  });

  it("keeps a stale previous-turn id from pulling the status above new activity", () => {
    const entries = [
      message("old-user", "user"),
      message("old-answer", "assistant", "turn-old"),
      message("new-user", "user"),
      message("new-answer", "assistant", "turn-live"),
    ];

    expect(deriveActiveTurnHeaderIndex(entries, "turn-old")).toBe(4);
  });

  it("keeps a completed historical turn pinned after its own user message", () => {
    const entries = [
      message("first-user", "user"),
      message("first-answer", "assistant", "turn-first"),
      message("second-user", "user"),
      message("second-answer", "assistant", "turn-second"),
    ];
    expect(deriveTurnHeaderIndex(entries, "turn-first")).toBe(1);
    expect(deriveTurnHeaderIndex(entries, "turn-second")).toBe(3);
  });
});

describe("computeMessageDurationStart", () => {
  it("returns message createdAt when there is no preceding user message", () => {
    const result = computeMessageDurationStart([
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:05Z",
        completedAt: "2026-01-01T00:00:10Z",
      },
    ]);
    expect(result).toEqual(new Map([["a1", "2026-01-01T00:00:05Z"]]));
  });

  it("uses the user message createdAt for the first assistant response", () => {
    const result = computeMessageDurationStart([
      { id: "u1", role: "user", createdAt: "2026-01-01T00:00:00Z" },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        completedAt: "2026-01-01T00:00:30Z",
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
      ]),
    );
  });

  it("uses the previous assistant completedAt for subsequent assistant responses", () => {
    const result = computeMessageDurationStart([
      { id: "u1", role: "user", createdAt: "2026-01-01T00:00:00Z" },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        completedAt: "2026-01-01T00:00:30Z",
      },
      {
        id: "a2",
        role: "assistant",
        createdAt: "2026-01-01T00:00:55Z",
        completedAt: "2026-01-01T00:00:55Z",
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
        ["a2", "2026-01-01T00:00:30Z"],
      ]),
    );
  });

  it("does not advance the boundary for a streaming message without completedAt", () => {
    const result = computeMessageDurationStart([
      { id: "u1", role: "user", createdAt: "2026-01-01T00:00:00Z" },
      { id: "a1", role: "assistant", createdAt: "2026-01-01T00:00:30Z" },
      {
        id: "a2",
        role: "assistant",
        createdAt: "2026-01-01T00:00:55Z",
        completedAt: "2026-01-01T00:00:55Z",
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
        ["a2", "2026-01-01T00:00:00Z"],
      ]),
    );
  });

  it("resets the boundary on a new user message", () => {
    const result = computeMessageDurationStart([
      { id: "u1", role: "user", createdAt: "2026-01-01T00:00:00Z" },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        completedAt: "2026-01-01T00:00:30Z",
      },
      { id: "u2", role: "user", createdAt: "2026-01-01T00:01:00Z" },
      {
        id: "a2",
        role: "assistant",
        createdAt: "2026-01-01T00:01:20Z",
        completedAt: "2026-01-01T00:01:20Z",
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
        ["u2", "2026-01-01T00:01:00Z"],
        ["a2", "2026-01-01T00:01:00Z"],
      ]),
    );
  });

  it("handles system messages without affecting the boundary", () => {
    const result = computeMessageDurationStart([
      { id: "u1", role: "user", createdAt: "2026-01-01T00:00:00Z" },
      { id: "s1", role: "system", createdAt: "2026-01-01T00:00:01Z" },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        completedAt: "2026-01-01T00:00:30Z",
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["s1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
      ]),
    );
  });

  it("returns empty map for empty input", () => {
    expect(computeMessageDurationStart([])).toEqual(new Map());
  });
});

describe("normalizeCompactToolLabel", () => {
  it("removes trailing completion wording from command labels", () => {
    expect(normalizeCompactToolLabel("Ran command complete")).toBe("Ran command");
  });

  it("removes trailing completion wording from other labels", () => {
    expect(normalizeCompactToolLabel("Read file completed")).toBe("Read file");
  });
});

describe("deriveGenerationStatusPhase", () => {
  const marker = (kind, sequence, turnId = "turn-1") => ({
    id: `${kind}:${sequence}`,
    kind,
    tone: "info",
    summary: kind,
    payload: {},
    turnId,
    sequence,
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  it("shows Working when the provider has not emitted a reasoning signal", () => {
    expect(deriveGenerationStatusPhase([], "turn-1")).toBe("working");
    expect(deriveGenerationStatusPhase([marker("reasoning.started", 1, "turn-2")], "turn-1")).toBe(
      "working",
    );
  });
  it("does not let child-agent reasoning start or settle the parent's Thinking phase", () => {
    for (const payload of [{ agentId: "child" }, { timelineBypass: true }]) {
      expect(deriveGenerationStatusPhase([{ ...marker("reasoning.started", 1), payload }], "turn-1")).toBe("working");
      expect(deriveGenerationStatusPhase([
        marker("reasoning.started", 1),
        { ...marker("reasoning.completed", 2), payload },
      ], "turn-1")).toBe("thinking");
    }
  });

  it("shows Working after explicit reasoning completes", () => {
    expect(
      deriveGenerationStatusPhase(
        [marker("reasoning.started", 1), marker("reasoning.completed", 2)],
        "turn-1",
      ),
    ).toBe("working");
  });

  it("orders persisted markers by sequence instead of snapshot array order", () => {
    expect(
      deriveGenerationStatusPhase(
        [marker("reasoning.completed", 2), marker("reasoning.started", 1)],
        "turn-1",
      ),
    ).toBe("working");
  });

  it("treats completion as later when markers share a timestamp without sequences", () => {
    const started = { ...marker("reasoning.started", undefined), sequence: undefined };
    const completed = { ...marker("reasoning.completed", undefined), sequence: undefined };
    expect(deriveGenerationStatusPhase([completed, started], "turn-1")).toBe("working");
  });

  it("shows Thinking while an explicit provider reasoning marker is unmatched", () => {
    expect(deriveGenerationStatusPhase([marker("reasoning.started", 1)], "turn-1")).toBe(
      "thinking",
    );
    expect(
      deriveGenerationStatusPhase(
        [
          marker("reasoning.started", 1),
          marker("reasoning.completed", 2),
          marker("reasoning.started", 3),
        ],
        "turn-1",
      ),
    ).toBe("thinking");
  });

  it("defaults to Working before the active turn projection is available", () => {
    expect(deriveGenerationStatusPhase([marker("reasoning.started", 1)], null)).toBe("working");
  });
});
