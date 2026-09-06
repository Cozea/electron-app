import { beforeEach, describe, expect, it } from "vitest";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ServerProvider,
  type ModelSelection,
} from "@cozea/assistant-contracts";
import { useStore, type ThreadShell } from "@/features/assistant/model/assistantStore";
import {
  backfillAssistantHistory,
  conversationContextMatches,
  useAssistantHistoryStore,
  type AssistantProjectAssociation,
} from "@/features/assistant/history/assistantHistoryStore";
import {
  buildAssistantHistoryMenu,
  historyPlacement,
  selectAssistantHistory,
  type AssistantHistoryEntry,
} from "@/features/assistant/history/assistantHistory";
import type { AssistantContentDraft } from "@/features/assistant/history/assistantDraftRepository";

const context: AssistantProjectAssociation = {
  projectId: "cozea-a",
  workspaceId: "workspace-a",
  laneId: "main",
  rootPath: "/repo/a",
  branch: "main",
  assistantProjectId: "runtime-a",
};
function thread(id: string, patch: Partial<ThreadShell> = {}): ThreadShell {
  return {
    id: ThreadId.make(id),
    projectId: ProjectId.make("runtime-a"),
    codexThreadId: null,
    title: id,
    modelSelection: {
      provider: "codex",
      instanceId: ProviderInstanceId.make("codex"),
      model: "model",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    error: null,
    branch: "main",
    worktreePath: null,
    createdAt: "2026-09-04T20:00:00Z",
    updatedAt: "2026-09-04T20:00:00Z",
    ...patch,
  };
}
function state(threads: ThreadShell[]) {
  return {
    ...useStore.getInitialState(),
    projectById: {
      "runtime-a": {
        id: ProjectId.make("runtime-a"),
        name: "repo",
        cwd: "/repo/a",
        defaultModelSelection: null,
        expanded: true,
        scripts: [],
      },
    },
    threadShellById: Object.fromEntries(threads.map((entry) => [entry.id, entry])),
    threadIdsByProjectId: {
      "runtime-a": threads
        .filter((entry) => entry.projectId === "runtime-a")
        .map((entry) => entry.id),
    },
  };
}
function entries(threads: ThreadShell[], drafts: Record<string, AssistantContentDraft> = {}) {
  return selectAssistantHistory({
    projectId: "cozea-a",
    provider: "codex",
    state: state(threads),
    projects: { "runtime-a": context },
    conversations: {},
    drafts,
  });
}

describe("project/provider chat history", () => {
  beforeEach(() => useAssistantHistoryStore.setState({ projects: {}, conversations: {} }));

  it("includes closed-tile conversations without mixing projects or providers", () => {
    expect(
      entries([
        thread("mine"),
        thread("other-project", { projectId: ProjectId.make("runtime-b") }),
        thread("claude", {
          modelSelection: {
            provider: "claudeAgent",
            instanceId: ProviderInstanceId.make("claude"),
            model: "claude-model",
          },
        }),
      ]).map((entry) => entry.title),
    ).toEqual(["mine"]);
  });

  it("keeps multiple provider instances, with deterministic latest-first ordering", () => {
    const list = entries([
      thread("b"),
      thread("a"),
      thread("new", {
        updatedAt: "2026-09-04T21:00:00Z",
        modelSelection: {
          provider: "codex",
          instanceId: ProviderInstanceId.make("second"),
          model: "other",
        },
      }),
    ]);
    expect(list.map((entry) => entry.title)).toEqual(["new", "a", "b"]);
    expect(
      buildAssistantHistoryMenu(list, 0, "thread:a", "/repo/a").find(
        (item) => item.id === "thread:a",
      )?.checked,
    ).toBe(true);
    expect(
      buildAssistantHistoryMenu(list, 0, "", "/repo/a").find((item) => item.id === "thread:new")
        ?.sublabel,
    ).toContain("second");
  });

  it("paginates at 20 without losing the oldest conversation", () => {
    const list = entries(
      Array.from({ length: 45 }, (_, index) => thread(String(index).padStart(2, "0"))),
    );
    const first = buildAssistantHistoryMenu(list, 0, "", "/repo/a");
    expect(first.filter((item) => item.type === "checkbox")).toHaveLength(20);
    expect(first.some((item) => item.id === "older")).toBe(true);
    const last = buildAssistantHistoryMenu(list, 2, "", "/repo/a");
    expect(last.filter((item) => item.type === "checkbox")).toHaveLength(5);
    expect(last.some((item) => item.id === "newer")).toBe(true);
    expect(last.some((item) => item.id === "older")).toBe(false);
  });

  it("lists nonempty local drafts but not untouched empty tiles", () => {
    const base: AssistantContentDraft = {
      ...context,
      key: "draft:d",
      threadId: null,
      text: "Keep my draft\nDetails",
      cursor: 0,
      images: [],
      annotations: [],
      modelSelection: thread("t").modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      revision: 1,
      updatedAt: "2026-09-04T21:00:00Z",
    };
    const list = entries([], {
      d: base,
      empty: { ...base, key: "draft:empty", text: "" },
      bound: { ...base, key: "thread:t", threadId: "t" },
    });
    expect(list).toHaveLength(1);
    expect(list[0]?.title).toBe("Keep my draft");
    expect(list[0]?.status).toBe("Draft");
  });

  it("backfills exact catalog roots even when there are no open tiles", () => {
    backfillAssistantHistory(state([thread("closed")]), [context], {});
    expect(useAssistantHistoryStore.getState().conversations.closed?.projectId).toBe("cozea-a");
  });

  it("resolves instance-only wire selections through the exact driver, never another instance", () => {
    const wireSelection = {
      instanceId: ProviderInstanceId.make("work-account"),
      model: "model",
    } as ModelSelection;
    const list = selectAssistantHistory({
      projectId: "cozea-a",
      provider: "codex",
      state: state([thread("wire", { modelSelection: wireSelection })]),
      projects: { "runtime-a": context },
      conversations: {},
      drafts: {},
      providers: [
        {
          instanceId: ProviderInstanceId.make("work-account"),
          driver: "codex",
          displayName: "Work account",
        } as ServerProvider,
      ],
    });
    expect(list[0]?.modelSelection).toEqual({ ...wireSelection, provider: "codex" });
    expect(list[0]?.instanceLabel).toBe("Work account");
    expect(entries([thread("missing", { modelSelection: wireSelection })])).toEqual([]);
  });

  it("keeps a worktree's exact workspace identity instead of the project's base checkout", () => {
    backfillAssistantHistory(
      state([thread("worktree", { worktreePath: "/trees/a", branch: "feature" })]),
      [
        context,
        {
          ...context,
          rootPath: "/trees/a",
          workspaceId: "tree-workspace",
          laneId: "feature",
          branch: "feature",
        },
      ],
      {},
    );
    expect(useAssistantHistoryStore.getState().conversations.worktree).toMatchObject({
      rootPath: "/trees/a",
      workspaceId: "tree-workspace",
      laneId: "feature",
      branch: "feature",
    });
  });

  it("does not backfill ambiguous roots or directory-prefix matches", () => {
    backfillAssistantHistory(
      state([thread("closed")]),
      [context, { ...context, projectId: "cozea-b" }],
      {},
    );
    expect(useAssistantHistoryStore.getState().conversations).toEqual({});
    backfillAssistantHistory(state([thread("closed")]), [{ ...context, rootPath: "/repo" }], {});
    expect(useAssistantHistoryStore.getState().conversations).toEqual({});
  });

  it("preserves identity across relocation, but cannot execute in a different checkout", () => {
    const store = useAssistantHistoryStore.getState();
    store.rememberConversation("t", context);
    store.rememberConversation("t", { ...context, rootPath: "/renamed" });
    expect(useAssistantHistoryStore.getState().conversations.t?.rootPath).toBe("/repo/a");
    expect(conversationContextMatches(context, { ...context, rootPath: "/renamed" })).toBe(false);
    expect(conversationContextMatches(context, { ...context, branch: "other" })).toBe(false);
    expect(conversationContextMatches(context, context)).toBe(true);
  });

  it("does not reassign a runtime project to a different Cozea project", () => {
    const store = useAssistantHistoryStore.getState();
    store.rememberConversation("t", context);
    store.rememberConversation("other", { ...context, projectId: "cozea-b" });
    expect(useAssistantHistoryStore.getState().conversations.other).toBeUndefined();
    store.forgetProject("cozea-a");
    expect(useAssistantHistoryStore.getState().projects).toEqual({});
    expect(useAssistantHistoryStore.getState().conversations).toEqual({});
  });
});

describe("history placement", () => {
  const target = entries([thread("t")])[0] as AssistantHistoryEntry;
  it.each([
    ["t", null, false, "current"],
    ["other", "tile-t", false, "focus"],
    ["other", "tile-t", true, "focus"],
    ["other", null, false, "replace"],
    ["other", null, true, "tab"],
  ] as const)(
    "resolves %s, existing %s, busy %s to %s",
    (currentThreadId, existingTileId, busy, expected) => {
      expect(
        historyPlacement({
          currentThreadId,
          currentDraftId: "draft",
          target,
          existingTileId,
          busy,
        }),
      ).toBe(expected);
    },
  );
});
