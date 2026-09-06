import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const timeline = source("apps/desktop/src/features/assistant/chat/MessagesTimeline.tsx");
const surface = source("apps/desktop/src/features/assistant/chat/CozeaChatSurface.tsx");
const rows = source("apps/desktop/src/features/assistant/chat/conversationRows.ts");
const controller = source(
  "apps/desktop/src/features/workbench/assistant/useWorkbenchAssistantTileController.tsx",
);
const tile = source("apps/desktop/src/features/workbench/WorkbenchAssistantChatTile.tsx");
const changedFiles = source("apps/desktop/src/features/assistant/chat/ChangedFilesTree.tsx");
const media = source("apps/desktop/src/features/assistant/chat/ChatMedia.tsx");
const pendingUserInput = source(
  "apps/desktop/src/features/assistant/chat/ComposerPendingUserInputPanel.tsx",
);

describe("agent chat motion stability invariants", () => {
  it("keeps scroll ownership in the timeline", () => {
    expect(controller).not.toContain("timeline.scrollTop = timeline.scrollHeight");
    expect(timeline).toContain("scrollDistanceFromBottom(scrollViewNode)");
    expect(timeline).toContain("scrollTopForBottomDistance(");
    expect(timeline).toContain('scrollViewNode.addEventListener("pointerdown", stopFollowing');
  });

  it("measures the composer intrinsic target rather than its animated max-height", () => {
    expect(surface).toContain("const intrinsicContentHeight = Math.max(dockContent.scrollHeight");
    expect(surface).not.toContain("frameRect.bottom - dockContent.getBoundingClientRect().top");
    expect(surface).toContain(
      "transition-[max-height,transform,opacity] duration-200 ease-out motion-reduce:transition-none",
    );
  });

  it("keeps the model picker mounted for its exit transition", () => {
    expect(surface).toContain("{shouldRenderModelPicker ? (");
    expect(surface).toContain(
      'isModelPickerVisible\n              ? "translate-y-0 scale-100 opacity-100"',
    );
    expect(surface).toContain('"pointer-events-none translate-y-1 scale-[0.985] opacity-0"');
  });

  it("persists automatic changed-file expansion and resets reused turns before paint", () => {
    expect(changedFiles).toContain("automaticExpansionPersistedRef");
    expect(changedFiles).toContain("onExpandedChange(true)");
    expect(changedFiles).toMatch(
      /useLayoutEffect\(\(\) => \{\s*if \(renderedTurnIdRef\.current !== turnId\)/,
    );
  });

  it("scopes late media reveal state to the current source", () => {
    expect(media).toContain("const [revealedSrc, setRevealedSrc] = useState<string | null>");
    expect(media).toContain(
      "const mediaRevealed = revealedSrc === src || revealedMarkdownMedia.has(src)",
    );
    expect(media).toContain("setRevealedSrc(src)");
  });

  it("restores keyboard focus when a pending question advances", () => {
    expect(pendingUserInput).toContain("const questionCardRef = useRef<HTMLDivElement>(null)");
    expect(pendingUserInput).toContain("previousQuestionIdRef");
    expect(pendingUserInput).toContain("questionCardRef.current?.focus({ preventScroll: true })");
  });

  it("treats Working, Thinking and Waiting as one active-tail slot", () => {
    expect(rows).toContain('const lifecycleRowId = "active-turn-lifecycle-row"');
    expect(timeline).toContain('? "turn-lifecycle"');
    expect(timeline).toContain('row.kind !== "input-waiting"');
  });

  it("hides the submitted composer presentation without clearing the durable draft early", () => {
    expect(controller).toContain('composer: isSending || isTurnStartPending ? "" : composer');
    expect(controller).toContain(
      "composerImages: isSending || isTurnStartPending ? [] : composerImages",
    );
    expect(controller).toContain("assistantDrafts.clearSubmitted");
  });

  it("animates the first thread-only header action into its final slot safely", () => {
    expect(tile).toMatch(
      /props\.tile\.threadId\s*\?\s*"w-7 opacity-100"\s*:\s*"pointer-events-none w-0 opacity-0"/,
    );
    expect(tile).toContain("disabled={!props.tile.threadId}");
    expect(tile).toContain("artifactsButtonRef.current?.focus({ preventScroll: true })");
  });
});
