import { describe, expect, it } from "vitest";

import {
  computeNextRunAt,
  describeRecurrence,
  dueScheduledTasks,
  isScheduledTaskDue,
  isScheduledTaskStale,
  MAX_RUN_LATENESS_MS,
  normalizeRecurrence,
  RUN_ONCE,
  type ScheduledTask,
} from "@shared/scheduledTasks";

/** Local wall-clock instant, so calendar stepping is read the way a user reads it. */
function at(
  year: number,
  month: number,
  day: number,
  hour = 9,
  minute = 0,
): number {
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
    startAt: at(2026, 9, 1),
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

describe("scheduled task recurrence", () => {
  it("keeps a one-time task due until it has actually run", () => {
    const once = task({ startAt: at(2026, 9, 1) });

    expect(computeNextRunAt(once)).toBe(at(2026, 9, 1));
    expect(computeNextRunAt({ ...once, lastRunAt: at(2026, 9, 1) })).toBeNull();
  });

  it("owes its first slot until it has run, however long ago that was", () => {
    const daily = task({
      startAt: at(2026, 9, 1),
      recurrence: { unit: "days", interval: 1 },
    });

    // Overdue, not skipped forward: the runner decides what to do about it.
    expect(computeNextRunAt(daily)).toBe(at(2026, 9, 1));
  });

  it("steps hourly schedules by duration", () => {
    const hourly = task({
      startAt: at(2026, 9, 1, 9),
      recurrence: { unit: "hours", interval: 6 },
    });

    expect(computeNextRunAt({ ...hourly, lastRunAt: at(2026, 9, 1, 9) })).toBe(
      at(2026, 9, 1, 15),
    );
    expect(computeNextRunAt({ ...hourly, lastRunAt: at(2026, 9, 2, 2) })).toBe(
      at(2026, 9, 2, 3),
    );
  });

  it("holds the local time of day across days and weeks", () => {
    const daily = task({
      startAt: at(2026, 9, 1, 9, 30),
      recurrence: { unit: "days", interval: 1 },
    });
    const fortnightly = task({
      startAt: at(2026, 9, 1, 9, 30),
      recurrence: { unit: "weeks", interval: 2 },
    });

    expect(computeNextRunAt({ ...daily, lastRunAt: at(2026, 9, 1, 9, 30) })).toBe(
      at(2026, 9, 2, 9, 30),
    );
    // Across a daylight-saving change the wall-clock time is what holds.
    expect(computeNextRunAt({ ...daily, lastRunAt: at(2027, 3, 15, 9, 30) })).toBe(
      at(2027, 3, 16, 9, 30),
    );
    expect(computeNextRunAt({ ...fortnightly, lastRunAt: at(2026, 9, 1, 9, 30) })).toBe(
      at(2026, 9, 15, 9, 30),
    );
  });

  it("clamps a monthly task to the last day of a shorter month", () => {
    const monthly = task({
      startAt: at(2026, 1, 31, 8),
      recurrence: { unit: "months", interval: 1 },
    });

    expect(computeNextRunAt({ ...monthly, lastRunAt: at(2026, 1, 31, 8) })).toBe(
      at(2026, 2, 28, 8),
    );
    expect(computeNextRunAt({ ...monthly, lastRunAt: at(2026, 2, 28, 8) })).toBe(
      at(2026, 3, 31, 8),
    );
  });

  it("never returns a slot the task already ran", () => {
    const daily = task({
      startAt: at(2026, 9, 1),
      recurrence: { unit: "days", interval: 1 },
      lastRunAt: at(2026, 9, 4),
    });

    expect(computeNextRunAt(daily)).toBe(at(2026, 9, 5));
  });

  it("reports nothing for a paused task", () => {
    const paused = task({
      recurrence: { unit: "days", interval: 1 },
      enabled: false,
    });

    expect(computeNextRunAt(paused)).toBeNull();
  });

  it("falls back to a single run for a nonsense recurrence", () => {
    expect(normalizeRecurrence({ unit: "days", interval: 0 })).toEqual({
      unit: "days",
      interval: 1,
    });
    expect(normalizeRecurrence(null)).toEqual(RUN_ONCE);
    expect(normalizeRecurrence({ unit: "fortnights" as never, interval: 2 })).toEqual(RUN_ONCE);
  });

  it("says the schedule the way the card shows it", () => {
    expect(describeRecurrence(RUN_ONCE)).toBe("Once");
    expect(describeRecurrence({ unit: "days", interval: 1 })).toBe("Every day");
    expect(describeRecurrence({ unit: "hours", interval: 6 })).toBe("Every 6 hours");
    expect(describeRecurrence({ unit: "months", interval: 1 })).toBe("Every month");
  });
});

describe("the scheduled task queue", () => {
  it("picks up a task the moment it is due, and not before", () => {
    const daily = task({
      startAt: at(2026, 9, 1),
      recurrence: { unit: "days", interval: 1 },
      lastRunAt: at(2026, 9, 1),
    });

    expect(isScheduledTaskDue(daily, at(2026, 9, 2, 8, 59))).toBe(false);
    expect(isScheduledTaskDue(daily, at(2026, 9, 2, 9, 0))).toBe(true);
    expect(isScheduledTaskDue({ ...daily, enabled: false }, at(2026, 9, 2, 9))).toBe(false);
  });

  it("treats a long-missed run as skipped rather than replaying it", () => {
    const missed = task({ startAt: at(2026, 9, 1) });
    const justLate = at(2026, 9, 1) + MAX_RUN_LATENESS_MS - 60_000;
    const tooLate = at(2026, 9, 1) + MAX_RUN_LATENESS_MS + 60_000;

    expect(isScheduledTaskStale(missed, justLate)).toBe(false);
    expect(isScheduledTaskStale(missed, tooLate)).toBe(true);
  });

  it("runs the most overdue task first", () => {
    const now = at(2026, 9, 2, 12);
    const queue = dueScheduledTasks(
      [
        task({ id: "recent", startAt: at(2026, 9, 2, 11) }),
        task({ id: "not-due", startAt: at(2026, 9, 3) }),
        task({ id: "oldest", startAt: at(2026, 9, 2, 6) }),
      ],
      now,
    );

    expect(queue.map((entry) => entry.id)).toEqual(["oldest", "recent"]);
  });
});
