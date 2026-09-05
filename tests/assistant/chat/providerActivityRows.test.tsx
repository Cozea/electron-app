import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ProviderTaskRow } from "@/features/assistant/chat/ProviderTaskRow";
import { ProviderPlanSteps } from "@/features/assistant/chat/ProviderPlanSteps";
import type { ProviderTaskActivity } from "@/features/assistant/chat/providerActivity";
import { makeActivity } from "./activityFixture";

it("renders one owned lifecycle disclosure with final failure and original payloads", () => {
  const html = renderToStaticMarkup(
    createElement(ProviderTaskRow, {
      task: {
        ...task,
        activities: [
          makeActivity({
            sequence: 1,
            kind: "tool.started",
            summary: "Reading child file",
            payload: { toolCallId: "call", agentId: "child", status: "running" },
          }),
          makeActivity({
            sequence: 2,
            kind: "tool.completed",
            summary: "Child read failed",
            payload: {
              toolCallId: "call",
              agentId: "child",
              status: "failed",
              error: "Native denied",
            },
          }),
        ],
      },
      expanded: true,
      onToggle: () => {},
    }),
  );
  expect(html).toContain("Child read failed");
  expect(html).not.toContain("Native denied");
  expect(html).not.toContain("<pre");
  expect(html.match(/<summary/g)).toHaveLength(2);
  expect(html).not.toContain("tool.started");
});

const task: ProviderTaskActivity = {
  taskId: "task",
  turnId: null,
  title: "Review files",
  status: "running",
  agentId: "child",
  parentAgentId: "parent",
  detail: "Checking imports",
  payload: { taskId: "task", error: "Native error detail" },
};
const renderTask = (status: string, expanded = false, isActive = true) =>
  renderToStaticMarkup(
    createElement(ProviderTaskRow, {
      task: { ...task, status },
      expanded,
      isActive,
      onToggle: () => {},
    }),
  );
it("defers diagnostics serialization and places expanded animation on active owned actions only", () => {
  const html = renderToStaticMarkup(
    createElement(ProviderTaskRow, {
      task: {
        ...task,
        payload: {
          toJSON() {
            throw new Error("closed diagnostics serialized");
          },
        },
        activities: [
          makeActivity({
            sequence: 1,
            kind: "tool.started",
            summary: "Reading",
            payload: { toolCallId: "read", status: "running" },
          }),
          makeActivity({
            sequence: 2,
            kind: "tool.completed",
            summary: "Declined",
            payload: { toolCallId: "declined", status: "declined" },
          }),
        ],
      },
      expanded: true,
      onToggle: () => {},
    }),
  );
  expect(html.match(/cozea-live-shimmer-focus/g)).toHaveLength(1);
  expect(html).not.toContain("<pre");
  expect(html).toContain('title="Reading"');
  expect(html).toContain("declined");
});
it("renders a scoped accessible disclosure with native ownership and diagnostics", () => {
  expect(renderTask("failed")).toContain('aria-expanded="false"');
  expect(renderTask("failed")).not.toContain("Native error detail");
  const expanded = renderTask("failed", true);
  expect(expanded).toContain('aria-expanded="true"');
  expect(expanded).toContain("Checking imports");
  expect(expanded).toContain("child");
  expect(expanded).toContain("parent");
  expect(expanded).not.toContain("Native error detail");
  expect(expanded).not.toContain("href=");
  expect(expanded).toContain("motion-reduce:transition-none");
});
it("shimmers the collapsed title or expanded active status with no completion checkmark", () => {
  expect(renderTask("running")).toContain("cozea-live-shimmer-focus");
  for (const status of ["completed", "failed", "stopped", "cancelled", "paused", "unknown"]) {
    const html = renderTask(status);
    expect(html).not.toContain("cozea-live-shimmer-focus");
    expect(html.match(/<svg/g)).toHaveLength(1);
    expect(html).toContain(status);
  }
  expect(renderTask("running", true).match(/cozea-live-shimmer-focus/g)).toHaveLength(1);
  expect(renderTask("running", false, false)).not.toContain("cozea-live-shimmer-focus");
});
it("renders actual native plan statuses and disables live animation for hidden or settled chat", () => {
  const plan = {
    createdAt: "2026-09-05T00:00:00Z",
    turnId: null,
    explanation: "Provider explanation",
    steps: [
      { step: "Inspect", status: "completed" as const },
      { step: "Implement", status: "inProgress" as const },
      { step: "Verify", status: "pending" as const },
    ],
  };
  const html = renderToStaticMarkup(createElement(ProviderPlanSteps, { plan }));
  expect(html).toContain("Provider explanation");
  expect(html).toContain("Completed");
  expect(html).toContain("In progress");
  expect(html).toContain("Pending");
  expect(html.match(/cozea-live-shimmer-focus/g)).toHaveLength(1);
  expect(html).not.toContain("<svg");
  expect(
    renderToStaticMarkup(createElement(ProviderPlanSteps, { plan, isActive: false })),
  ).not.toContain("cozea-live-shimmer-focus");
});
