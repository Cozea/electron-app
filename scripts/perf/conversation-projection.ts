/**
 * Pure canonical projection benchmark (not a DOM/Electron profile).
 * Run: bun scripts/perf/conversation-projection.ts
 * Fixtures never contact providers or mutate workspace state.
 */
import { projectConversation } from "@/features/assistant/chat/conversationProjection";
import { createConversationRowProjector } from "@/features/assistant/chat/conversationRowProjector";
import { deriveTimelineEntries } from "@/features/assistant/chat/session-logic";
import { mergeActivityEntries } from "@/features/assistant/chat/conversationActivityEntries";
import {
  buildConversationRows,
  reuseConversationRows,
  type ConversationRowsInput,
} from "@/features/assistant/chat/conversationRows";
import type { TimelineEntry } from "@/features/assistant/chat/session-logic";
import type { MessageId, TurnId } from "@shared/assistant-contracts";

const stamp = "2026-09-05T00:00:00.000Z";
const liveTurn = "live" as TurnId;
function message(id: string, turnId: TurnId, streaming = false): TimelineEntry {
  return {
    kind: "message",
    id,
    createdAt: stamp,
    message: {
      id: id as MessageId,
      role: "assistant",
      turnId,
      text: "Canonical response",
      streaming,
      createdAt: stamp,
      completedAt: streaming ? undefined : stamp,
    },
  };
}
function fixture(historySize: number, largeFold: boolean): ConversationRowsInput {
  const entries: TimelineEntry[] = [];
  const expanded: Record<string, boolean> = {};
  for (let i = 0; i < historySize; i++) {
    const turnId = (largeFold ? "history" : "history-" + Math.floor(i / 4)) as TurnId;
    entries.push(message("history-message-" + i, turnId));
    if (largeFold) expanded["turn-fold:" + turnId] = true;
  }
  entries.push({
    kind: "message",
    id: "live-user",
    createdAt: stamp,
    message: {
      id: "live-user" as MessageId,
      role: "user",
      text: "Continue",
      streaming: false,
      createdAt: stamp,
    },
  });
  entries.push(message("live-message", liveTurn, true));
  return {
    entries,
    runningTurnId: liveTurn,
    isWorking: true,
    activeWorkStartedAt: stamp,
    generationStatusPhase: "working",
    expanded,
    latestTurn: { turnId: liveTurn, state: "running", startedAt: stamp, completedAt: null },
  };
}
function percentile(values: number[], p: number) {
  return [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.floor(values.length * p))
  ]!;
}
const results = [];
for (const freshWrappers of [false, true]) {
  for (const largeFold of [false, true]) {
    for (const historySize of [100, 1000, 10000]) {
      let input = fixture(historySize, largeFold);
      let rows = buildConversationRows(input);
      let fullBuilds = 0;
      const incremental = createConversationRowProjector((input) => {
        fullBuilds++;
        return buildConversationRows(input);
      });
      incremental.project(input);
      const projectionMs: number[] = [],
        buildMs: number[] = [],
        reuseMs: number[] = [],
        incrementalMs: number[] = [],
        derivationMs: number[] = [];
      const activity = { entries: [], tasks: new Map(), plans: new Map() };
      let stableRows = 0;
      for (let chunk = 0; chunk < 70; chunk++) {
        const last = input.entries.at(-1)!;
        if (last.kind !== "message") throw new Error("Missing live message");
        input = {
          ...input,
          entries: [
            ...input.entries.slice(0, -1),
            { ...last, message: { ...last.message, text: last.message.text + " chunk" } },
          ],
        };
        const derivationStart = performance.now();
        if (freshWrappers) {
          const messages = input.entries.flatMap((entry) =>
            entry.kind === "message" ? [entry.message] : [],
          );
          input = {
            ...input,
            entries: mergeActivityEntries(deriveTimelineEntries(messages, [], []), activity),
            latestTurn: { ...input.latestTurn! },
          };
        }
        const start = performance.now();
        projectConversation(input);
        const projected = performance.now();
        const fresh = buildConversationRows(input);
        const built = performance.now();
        const next = reuseConversationRows(rows, fresh);
        const reused = performance.now();
        incremental.project(input);
        const incremented = performance.now();
        stableRows = next.filter((row, index) => row === rows[index]).length;
        rows = next;
        if (chunk >= 20) {
          projectionMs.push(projected - start);
          buildMs.push(built - projected);
          reuseMs.push(reused - built);
          incrementalMs.push(incremented - reused);
          derivationMs.push(start - derivationStart);
        }
      }
      const metric = (values: number[]) => ({
        medianMs: +percentile(values, 0.5).toFixed(3),
        p95Ms: +percentile(values, 0.95).toFixed(3),
      });
      results.push({
        scenario: largeFold ? "one-expanded-history-fold" : "many-collapsed-history-folds",
        wrappers: freshWrappers ? "deriveTimelineEntries + mergeActivityEntries" : "stable",
        historyEntries: historySize,
        samples: 50,
        projection: metric(projectionMs),
        buildIncludingProjection: metric(buildMs),
        reuse: metric(reuseMs),
        buildAndReuse: metric(buildMs.map((value, i) => value + reuseMs[i]!)),
        incremental: metric(incrementalMs),
        derivation: metric(derivationMs),
        derivationAndIncremental: metric(incrementalMs.map((value, i) => value + derivationMs[i]!)),
        incrementalFullBuilds: fullBuilds,
        stableTopLevelRows: stableRows,
        topLevelRows: rows.length,
        folds: rows.filter((row) => row.kind === "turn-fold").length,
        foldedChildren: rows.reduce(
          (count, row) =>
            count +
            (row.kind === "turn-fold" || row.kind === "turn-fold-content"
              ? row.children.length
              : 0),
          0,
        ),
      });
    }
  }
}
console.log(
  JSON.stringify(
    {
      runtime: Bun.version,
      scope:
        "Pure projection + row construction; excludes canonical reducer, React, DOM, layout and paint",
      results,
    },
    null,
    2,
  ),
);
