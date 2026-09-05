import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const controller = source(
  "apps/desktop/src/features/workbench/assistant/useWorkbenchAssistantTileController.tsx",
);

describe("history integration safety contracts", () => {
  it("creates runtime conversations only inside explicit first-send handling", () => {
    expect(controller.match(/type: "thread\.create"/g)).toHaveLength(1);
    const send = controller.slice(controller.indexOf("const sendTurn ="));
    expect(send).toContain('type: "thread.create"');
    expect(controller).toContain("currentTile.threadId && !selectAssistantThreadById");
    expect(controller).toContain("This saved conversation is unavailable.");
  });

  it("captures the submitted content revision before asynchronous preflight", () => {
    const send = controller.slice(controller.indexOf("const sendTurn ="));
    expect(send.indexOf("const submittedRevision")).toBeLessThan(
      send.indexOf("await validateConversationContext()"),
    );
    expect(send.indexOf("flushWorkbenchStorage()")).toBeLessThan(send.indexOf("await adoption"));
    expect(send).toContain("Message sent, but the saved draft could not be cleared");
  });

  it("treats approval/input and every tracked operation as busy", () => {
    const busy = controller.split("historyBusy:").at(-1)!.split("\n")[0]!;
    for (const guard of [
      "threadOperationCount",
      "isRunning",
      "isSending",
      "isPreparingSend",
      "isBinding",
      "isTurnStartPending",
      "pendingApprovals.length",
      'pendingUserInputs.some((request) => request.responseMode !== "message")',
      "activeRequestKey",
      "memoryUpdateInFlight",
      "isRevertingCheckpoint",
    ])
      expect(busy).toContain(guard);
  });

  it("uses one native header action with stale-menu and storage guards", () => {
    const button = source(
      "apps/desktop/src/features/workbench/assistant/AssistantHistoryButton.tsx",
    );
    expect(button).toContain("showDesktopContextMenu(items, anchor)");
    expect(button).toContain("event.stopPropagation()");
    expect(button).toContain("if (opening.current) return");
    expect(button).toContain("await latest.current.flushDraft()");
    expect(button).toContain("if (!isCurrent()) return");
    expect(button).not.toContain('type: "thread.turn.start"');
  });

  it("resets conversation-local state only at an intentional identity switch", () => {
    const tile = source("apps/desktop/src/features/workbench/WorkbenchAssistantChatTile.tsx");
    expect(tile).toContain("key={props.tile.draftId ?? props.tile.id}");
    const registry = source("apps/desktop/src/features/workbench/workbenchDockHeaderControls.tsx");
    expect(registry).toContain("return useSyncExternalStore(");
    const drafts = source("apps/desktop/src/features/assistant/history/useAssistantContentDraft.ts");
    expect(drafts.indexOf("useLayoutEffect(() =>")).toBeLessThan(drafts.indexOf("URL.createObjectURL(image.blob)"));
    expect(drafts).toContain("URL.revokeObjectURL(image.previewUrl)");
  });
});
