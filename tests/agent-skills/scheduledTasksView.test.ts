import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ComputerUseTag,
  describeCadence,
  describeNextRun,
  describeSchedule,
  draftFromSuggestion,
  joinLocalDateTime,
  matchesFilter,
  matchesTaskSearch,
  emptyDraftForTests,
  isReasoningDescriptor,
  modelChoicesFor,
  projectTargets,
  resolveProviderModelDefault,
  SCHEDULED_TASK_SUGGESTIONS,
  splitLocalDateTime,
} from "@/features/projects/pages/ScheduledTasksView";
import {
  RUN_ONCE,
  type ScheduledTask,
  type ScheduledTaskRun,
} from "@shared/scheduledTasks";
import {
  formatHistoryTime,
  RUN_STATUS_COPY,
  ScheduledTaskDetail,
} from "@/features/projects/pages/ScheduledTaskDetail";

function at(year: number, month: number, day: number, hour = 9, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

function task(overrides: Partial<ScheduledTask>): ScheduledTask {
  return {
    id: "task-1",
    name: "Nightly sweep",
    prompt: "Summarize what changed today.",
    provider: "claude",
    model: null,
    modelOptions: [],
    computerUse: false,
    project: null,
    startAt: at(2026, 9, 10),
    recurrence: RUN_ONCE,
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    lastRunAt: null,
    lastError: null,
    lastThreadId: null,
    runs: [],
    ...overrides,
  };
}

describe("scheduled tasks page", () => {
  it("round-trips a start time through the native date and time inputs", () => {
    const start = at(2026, 9, 10, 14, 5);
    const { date, time } = splitLocalDateTime(start);

    expect(date).toBe("2026-09-10");
    expect(time).toBe("14:05");
    expect(joinLocalDateTime(date, time)).toBe(start);
  });

  it("refuses half a date and time pair rather than inventing an instant", () => {
    expect(joinLocalDateTime("", "09:00")).toBeNull();
    expect(joinLocalDateTime("2026-09-10", "")).toBeNull();
    expect(joinLocalDateTime("not-a-date", "09:00")).toBeNull();
  });

  it("says how often a task runs and when that next is", () => {
    const daily = task({
      startAt: at(2026, 9, 10, 9),
      recurrence: { unit: "days", interval: 1 },
      lastRunAt: at(2026, 9, 11, 9),
    });

    expect(describeCadence(daily)).toBe("Daily at 9:00 AM");
    expect(describeNextRun(daily, at(2026, 9, 11, 10))).toBe("Next run in 23 hours");
    expect(describeSchedule(daily, at(2026, 9, 11, 10))).toBe(
      "Daily at 9:00 AM · Next run in 23 hours",
    );
    expect(describeNextRun({ ...daily, enabled: false }, at(2026, 9, 11))).toBe("Paused");
    expect(describeNextRun(task({}), at(2026, 9, 12))).toBe("Overdue");
    expect(describeNextRun(task({ lastRunAt: at(2026, 9, 10) }), at(2026, 9, 12))).toBe(
      "Completed",
    );
  });

  it("sorts tasks into the filter tabs the page offers", () => {
    const active = task({ recurrence: { unit: "days", interval: 1 } });
    const paused = task({ enabled: false });
    const completed = task({ lastRunAt: at(2026, 9, 10) });

    expect(matchesFilter(active, "active")).toBe(true);
    expect(matchesFilter(active, "completed")).toBe(false);
    expect(matchesFilter(paused, "paused")).toBe(true);
    // A paused task is neither active nor completed, whatever it owes.
    expect(matchesFilter(paused, "active")).toBe(false);
    expect(matchesFilter(paused, "completed")).toBe(false);
    expect(matchesFilter(completed, "completed")).toBe(true);
    expect(matchesFilter(completed, "active")).toBe(false);
    for (const candidate of [active, paused, completed]) {
      expect(matchesFilter(candidate, "all")).toBe(true);
    }
  });

  it("searches names, instructions and the project label", () => {
    const entry = task({
      name: "Nightly sweep",
      prompt: "Summarize what changed today.",
      project: { workspaceRoot: "/repos/alpha", label: "Alpha app" },
    });

    expect(matchesTaskSearch(entry, "nightly")).toBe(true);
    expect(matchesTaskSearch(entry, "summarize")).toBe(true);
    expect(matchesTaskSearch(entry, "alpha")).toBe(true);
    expect(matchesTaskSearch(entry, "")).toBe(true);
    expect(matchesTaskSearch(entry, "unrelated")).toBe(false);
  });

  it("starts a weekday suggestion on the day it names", () => {
    const friday = SCHEDULED_TASK_SUGGESTIONS.find((entry) => entry.id === "weekly-review");
    expect(friday?.weekday).toBe(5);

    // A Tuesday: the first run has to land on the coming Friday, not tomorrow.
    const draft = draftFromSuggestion(friday!, at(2026, 9, 8, 12));
    const start = new Date(draft.startAt);

    expect(start.getDay()).toBe(5);
    expect(start.getHours()).toBe(16);
    expect(draft.recurrence).toEqual({ unit: "weeks", interval: 1 });
    expect(draft.project).toBeNull();
  });

  it("tags a computer-use task so the list says what it can touch", () => {
    const markup = renderToStaticMarkup(createElement(ComputerUseTag, { available: true }));

    expect(markup).toContain("Computer use");
  });

  it("offers only projects the user actually has, with a local checkout", () => {
    const targets = projectTargets(
      [
        { _id: "p-zeta", name: "Zeta" },
        { _id: "p-alpha", name: "Alpha app" },
        { _id: "p-nolocal", name: "Never cloned here" },
      ],
      {
        "p-zeta": { status: "ready", workspace: { projectRootPath: "/repos/zeta" } },
        "p-alpha": { status: "ready", workspace: { projectRootPath: "/repos/alpha" } },
        // A folder this device remembers whose project the user does not have.
        "p-ghost": { status: "ready", workspace: { projectRootPath: "/repos/frontend" } },
        "p-broken": { status: "broken", workspace: { projectRootPath: "/repos/broken" } },
      },
    );

    expect(targets).toEqual([
      { workspaceRoot: "/repos/alpha", label: "Alpha app" },
      { workspaceRoot: "/repos/zeta", label: "Zeta" },
    ]);
  });

  it("offers nothing when the user has no projects", () => {
    expect(
      projectTargets([], {
        "p-ghost": { status: "ready", workspace: { projectRootPath: "/repos/frontend" } },
      }),
    ).toEqual([]);
    expect(projectTargets(undefined, {})).toEqual([]);
  });

  it("keeps the chosen model selectable when the catalog has not loaded", () => {
    const catalog = [
      { slug: "claude-sonnet-4-6", name: "Sonnet 4.6" },
      { slug: "claude-opus-5", name: "Opus 5" },
    ];

    expect(modelChoicesFor(catalog, "claude-opus-5")).toBe(catalog);
    // Runtime offline: the remembered model is still something you can pick.
    expect(modelChoicesFor([], "claude-opus-5")).toEqual([
      { slug: "claude-opus-5", name: "claude-opus-5" },
    ]);
    expect(modelChoicesFor(catalog, "claude-haiku-9")[0]).toEqual({
      slug: "claude-haiku-9",
      name: "claude-haiku-9",
    });
  });

  it("starts a provider on the model and reasoning level it was last used with", () => {
    const remembered = {
      claudeAgent: {
        model: "claude-opus-4-6",
        options: [{ id: "thinking", value: "high" }],
      },
      codex: { model: "gpt-5.6-sol", options: [{ id: "malformed" }] as never },
    };

    expect(resolveProviderModelDefault("claude", remembered)).toEqual({
      model: "claude-opus-4-6",
      modelOptions: [{ id: "thinking", value: "high" }],
    });
    // A malformed remembered option is dropped, not carried into a saved task.
    expect(resolveProviderModelDefault("codex", remembered)).toEqual({
      model: "gpt-5.6-sol",
      modelOptions: [],
    });
    // Never used: the provider's own default decides at run time.
    expect(resolveProviderModelDefault("cursor", remembered)).toEqual({
      model: null,
      modelOptions: [],
    });
  });

  it("offers the reasoning level and leaves the model's other knobs alone", () => {
    for (const id of ["effort", "reasoningEffort", "reasoning", "thinking"]) {
      expect(isReasoningDescriptor({ id })).toBe(true);
    }
    // A schedule is about how hard the run thinks, not how it is framed.
    expect(isReasoningDescriptor({ id: "contextWindow" })).toBe(false);
    expect(isReasoningDescriptor({ id: "fastMode" })).toBe(false);
  });
});

describe("a task's run history", () => {
  it("names each attempt the way the runner actually knows it", () => {
    expect(RUN_STATUS_COPY.started.label).toBe("Started");
    // The runner dispatches a turn; it never learns how the run turned out.
    expect(RUN_STATUS_COPY.started.detail).toContain("conversation");
    expect(RUN_STATUS_COPY.failed.label).toBe("Did not start");
    expect(RUN_STATUS_COPY.skipped.label).toBe("Skipped");
    expect(RUN_STATUS_COPY.skipped.detail).toContain("not replayed");
  });

  it("shows the newest run first, and falls back to it with no selection", () => {
    const runs: ScheduledTaskRun[] = [
      { id: "r2", ranAt: 2, status: "started", threadId: "t2", error: null, seenAt: null },
      { id: "r1", ranAt: 1, status: "failed", threadId: null, error: "boom", seenAt: null },
    ];
    const withRuns = task({ runs });

    const markup = renderToStaticMarkup(
      createElement(ScheduledTaskDetail, {
        task: withRuns,
        summary: "Daily at 9:00 AM · Next run in 3 hours",
        selectedRunId: null,
        onSelectRun: () => undefined,
      }),
    );

    expect(markup).toContain("Latest");
    expect(markup).toContain("Started");
    expect(markup).toContain("History");
    // Both attempts are listed, not just the one on show.
    expect(markup).toContain("Did not start");
  });

  it("meets an unrun task with an empty state instead of a blank pane", () => {
    const markup = renderToStaticMarkup(
      createElement(ScheduledTaskDetail, {
        task: task({ runs: [] }),
        summary: "Daily at 9:00 AM · Next run in 3 hours",
        selectedRunId: null,
        onSelectRun: () => undefined,
      }),
    );

    expect(markup).toContain("No runs yet");
    expect(markup).toContain("Nothing has run yet.");
    expect(markup).toContain("If Cozea reopens soon after a scheduled time");
    expect(markup).toContain("Older missed runs are marked skipped");
    expect(markup).not.toContain("marked skipped when you next open it");
  });

  it("says a paused task stays paused until it is started again", () => {
    const markup = renderToStaticMarkup(
      createElement(ScheduledTaskDetail, {
        task: task({ enabled: false, runs: [] }),
        summary: "Daily at 9:00 AM · Paused",
        selectedRunId: null,
        onSelectRun: () => undefined,
      }),
    );

    expect(markup).toContain("Paused");
    expect(markup).toContain("resumes only when you start it again");
  });

  it("names the recent days and only dates the older ones", () => {
    const now = at(2026, 9, 6, 12);

    expect(formatHistoryTime(at(2026, 9, 6, 7, 28), now)).toBe("Today at 7:28 AM");
    expect(formatHistoryTime(at(2026, 9, 5, 7, 28), now)).toBe("Yesterday at 7:28 AM");
    expect(formatHistoryTime(at(2026, 9, 4, 7, 18), now)).toBe("Sep 4 at 7:18 AM");
    // The year stops being obvious once it is not this one.
    expect(formatHistoryTime(at(2025, 8, 23, 7, 14), now)).toBe("Aug 23, 2025 at 7:14 AM");
  });

  it("marks unread runs and leaves read ones unmarked", () => {
    const unread: ScheduledTaskRun = {
      id: "r1",
      ranAt: at(2026, 9, 5, 7),
      status: "started",
      threadId: "t1",
      error: null,
      seenAt: null,
    };
    const read: ScheduledTaskRun = { ...unread, id: "r2", seenAt: at(2026, 9, 5, 8) };

    const unreadMarkup = renderToStaticMarkup(
      createElement(ScheduledTaskDetail, {
        task: task({ runs: [unread] }),
        summary: "Daily at 9:00 AM",
        selectedRunId: null,
        onSelectRun: () => undefined,
      }),
    );
    const readMarkup = renderToStaticMarkup(
      createElement(ScheduledTaskDetail, {
        task: task({ runs: [read] }),
        summary: "Daily at 9:00 AM",
        selectedRunId: null,
        onSelectRun: () => undefined,
      }),
    );

    expect(unreadMarkup).toContain("Unread");
    // A run that started and has been read carries no mark at all.
    expect(readMarkup).not.toContain("Unread");
  });

  it("names tomorrow rather than leaving a bare date to decode", () => {
    const now = at(2026, 9, 6, 10, 11);

    expect(formatHistoryTime(at(2026, 9, 7, 9, 0), now)).toBe("Tomorrow at 9:00 AM");
    expect(formatHistoryTime(at(2026, 9, 6, 9, 0), now)).toBe("Today at 9:00 AM");
  });

  it("starts a new task at the next 9am, today when the morning is still ahead", () => {
    // Before 9: the first run is this morning, not a day away.
    const early = new Date(emptyDraftForTests(at(2026, 9, 6, 7, 30)).startAt);
    expect(early.getDate()).toBe(6);
    expect(early.getHours()).toBe(9);

    // After 9: the next 9am is tomorrow.
    const late = new Date(emptyDraftForTests(at(2026, 9, 6, 10, 11)).startAt);
    expect(late.getDate()).toBe(7);
    expect(late.getHours()).toBe(9);
  });
});
