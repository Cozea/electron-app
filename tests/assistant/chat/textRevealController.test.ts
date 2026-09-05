import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageId } from "@cozea/assistant-contracts";
import { TextRevealController } from "@/features/assistant/chat/textRevealController";
import { markLiveText, markSnapshotText } from "@/features/assistant/model/messageTextArrival";
import type { ChatMessage } from "@/features/assistant/model/types";

let now = 0;
let nextHandle = 0;
let frames: Map<number, () => void>;
const scheduler = {
  now: () => now,
  requestFrame: (callback: () => void) => {
    const handle = ++nextHandle;
    frames.set(handle, callback);
    return handle;
  },
  cancelFrame: (handle: number) => {
    frames.delete(handle);
  },
};
function step(ms: number) {
  now += ms;
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach((callback) => callback());
}
function message(text: string, id = "answer", streaming = true): ChatMessage {
  return {
    id: MessageId.makeUnsafe(id),
    role: "assistant",
    text,
    streaming,
    createdAt: "2026-09-05T00:00:00Z",
  };
}
function live(text: string, previous?: ChatMessage, streaming = true, id = "answer") {
  const next = message(text, id, streaming);
  markLiveText(next, previous);
  return next;
}

beforeEach(() => {
  now = 0;
  nextHandle = 0;
  frames = new Map();
  vi.spyOn(performance, "now").mockImplementation(() => now);
});
afterEach(() => vi.restoreAllMocks());

describe("assistant text reveal", () => {
  it("smooths a burst, preserves prefixes, and stops frames when caught up", () => {
    const controller = new TextRevealController(scheduler);
    const first = live("A".repeat(100));
    controller.sync([first]);
    expect(controller.getSnapshot("answer")).toEqual({ displayText: "", isRevealing: true });
    step(16);
    const shown = controller.getSnapshot("answer").displayText;
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(100);
    controller.sync([live(first.text + "B".repeat(100), first)]);
    expect(controller.getSnapshot("answer").displayText.startsWith(shown)).toBe(true);
    step(250);
    expect(controller.getSnapshot("answer")).toEqual({
      displayText: first.text + "B".repeat(100),
      isRevealing: false,
    });
    expect(frames.size).toBe(0);
  });

  it("does not bank time during provider pauses", () => {
    const controller = new TextRevealController(scheduler);
    const first = live("First.");
    controller.sync([first]);
    step(250);
    step(5_000);
    controller.sync([live(first.text + " Second paragraph.".repeat(10), first)]);
    expect(controller.getSnapshot("answer").displayText).toBe(first.text);
    expect(frames.size).toBe(1);
  });

  it("drains normal completion, including a response delivered in one event", () => {
    const controller = new TextRevealController(scheduler);
    controller.sync([live("Complete response".repeat(20), undefined, false)]);
    expect(controller.getSnapshot("answer").isRevealing).toBe(true);
    step(250);
    expect(controller.getSnapshot("answer").isRevealing).toBe(false);
  });

  it("does not reset the deadline when the provider finalizes unchanged text", () => {
    const controller = new TextRevealController(scheduler);
    const first = live("A".repeat(10_000));
    controller.sync([first]);
    step(200);
    controller.sync([live(first.text, first, false)]);
    step(50);
    expect(controller.getSnapshot("answer").displayText).toBe(first.text);
  });

  it("honors original receipt times when React coalesces multiple updates", () => {
    const controller = new TextRevealController(scheduler);
    const first = live("A".repeat(10_000));
    now = 240;
    const second = live(first.text + "B".repeat(10_000), first);
    controller.sync([second]);
    step(10);
    expect(controller.getSnapshot("answer").displayText.length).toBeGreaterThanOrEqual(
      first.text.length,
    );
    step(240);
    expect(controller.getSnapshot("answer").displayText).toBe(second.text);
  });

  it("reveals only complete known graphemes", () => {
    const controller = new TextRevealController(scheduler);
    const text = "👩🏽‍💻e\u0301🇲🇾✨".repeat(10);
    const boundaries = new Set([
      "",
      ...Array.from(
        new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
        (part) => text.slice(0, part.index + part.segment.length),
      ),
    ]);
    controller.sync([live(text)]);
    for (let index = 0; index < 20; index++) {
      step(16);
      expect(boundaries.has(controller.getSnapshot("answer").displayText)).toBe(true);
    }
    expect(controller.getSnapshot("answer").displayText).toBe(text);
  });

  it("joins combining marks received in separate chunks", () => {
    const controller = new TextRevealController(scheduler);
    const first = live("abc e");
    controller.sync([first]);
    step(250);
    const second = live("abc e\u0301 and 👩🏽‍💻", first);
    controller.sync([second]);
    step(16);
    expect(controller.getSnapshot("answer").displayText).not.toMatch(/\ud83d$/);
    step(250);
    expect(controller.getSnapshot("answer").displayText).toBe(second.text);
  });

  it("waits for a split surrogate without rendering a broken emoji or spinning", () => {
    const controller = new TextRevealController(scheduler);
    const first = live("Hello \ud83d");
    controller.sync([first]);
    step(250);
    expect(controller.getSnapshot("answer").displayText).toBe("Hello ");
    expect(frames.size).toBe(0);
    const next = live("Hello 😀", first);
    controller.sync([next]);
    step(250);
    expect(controller.getSnapshot("answer").displayText).toBe("Hello 😀");
    expect(frames.size).toBe(0);
  });

  it("shows existing and asynchronously loaded history immediately", () => {
    const old = live("Already received", undefined, false);
    const controller = new TextRevealController(scheduler, [old]);
    expect(controller.getSnapshot("answer").displayText).toBe(old.text);
    expect(controller.consumeEntrance("answer")).toBe(false);
    const historical = message("Streaming when opened", "history");
    markSnapshotText([historical]);
    controller.sync([old, historical]);
    expect(controller.getSnapshot("history").displayText).toBe(historical.text);
    expect(frames.size).toBe(0);
    controller.sync([old, live(historical.text + " live tail", historical, true, "history")]);
    expect(controller.getSnapshot("history").displayText).toBe(historical.text);
    expect(controller.getSnapshot("history").isRevealing).toBe(true);
  });

  it("seeds a snapshot and reveals only its live tail even in the same React batch", () => {
    const controller = new TextRevealController(scheduler);
    const snapshot = message("History.");
    markSnapshotText([snapshot]);
    controller.sync([live("History. Live text", snapshot)]);
    expect(controller.getSnapshot("answer")).toEqual({
      displayText: "History.",
      isRevealing: true,
    });
    expect(controller.consumeEntrance("answer")).toBe(false);
  });

  it("flushes on snapshot reconnect, interruption, failure, or hidden/reduced-motion state", () => {
    for (const reason of ["snapshot", "immediate", "disabled"] as const) {
      const controller = new TextRevealController(scheduler);
      const first = live("Queued response".repeat(50));
      controller.sync([first]);
      if (reason === "snapshot") {
        const snapshot = message(first.text);
        markSnapshotText([snapshot]);
        controller.sync([snapshot]);
      } else if (reason === "immediate") controller.sync([first], true);
      else controller.setEnabled(false);
      expect(controller.getSnapshot("answer").displayText).toBe(first.text);
      expect(controller.getSnapshot("answer").isRevealing).toBe(false);
      expect(controller.consumeEntrance("answer")).toBe(false);
      expect(frames.size).toBe(0);
    }
  });

  it("does not replay text received while hidden when the tile returns", () => {
    const controller = new TextRevealController(scheduler);
    controller.setEnabled(false);
    const first = live("While hidden");
    controller.sync([first]);
    controller.setEnabled(true);
    expect(controller.getSnapshot("answer").displayText).toBe(first.text);
    expect(controller.consumeEntrance("answer")).toBe(false);
    expect(frames.size).toBe(0);
  });

  it("adopts authoritative replacements and shorter text immediately", () => {
    const controller = new TextRevealController(scheduler);
    let current = live("Original answer".repeat(50));
    controller.sync([current]);
    step(16);
    current = live("Corrected answer", current, false);
    controller.sync([current]);
    expect(controller.getSnapshot("answer")).toEqual({
      displayText: current.text,
      isRevealing: false,
    });
    current = live("Corrected", current, false);
    controller.sync([current]);
    expect(controller.getSnapshot("answer").displayText).toBe("Corrected");
  });

  it("preserves progress and consumes entrance only once across row recycling", () => {
    const controller = new TextRevealController(scheduler);
    const listener = vi.fn();
    const unsubscribe = controller.subscribe("answer", listener);
    controller.sync([live("Response".repeat(50))]);
    step(16);
    expect(controller.consumeEntrance("answer")).toBe(true);
    const shown = controller.getSnapshot("answer").displayText;
    unsubscribe();
    step(16);
    controller.subscribe("answer", listener);
    expect(controller.getSnapshot("answer").displayText.startsWith(shown)).toBe(true);
    expect(controller.consumeEntrance("answer")).toBe(false);
    controller.stop();
    expect(frames.size).toBe(0);
  });

  it("notifies only the changing message and prunes removed messages", () => {
    const history = message("Stable history", "history", false);
    const controller = new TextRevealController(scheduler, [history]);
    const oldListener = vi.fn();
    const liveListener = vi.fn();
    controller.subscribe("history", oldListener);
    controller.subscribe("answer", liveListener);
    controller.sync([history, live("Long response".repeat(100))]);
    for (let i = 0; i < 20; i++) step(16);
    expect(oldListener).not.toHaveBeenCalled();
    expect(liveListener.mock.calls.length).toBeGreaterThan(2);
    controller.sync([history]);
    expect(controller.getSnapshot("answer").displayText).toBe("");
    expect(frames.size).toBe(0);
  });

  it("isolates timelines and resumes safely after StrictMode cleanup", () => {
    const first = new TextRevealController(scheduler);
    const response = live("Existing stream".repeat(100));
    first.sync([response]);
    step(16);
    first.stop();
    const shown = first.getSnapshot("answer").displayText;
    first.sync([response]);
    expect(first.getSnapshot("answer").displayText.startsWith(shown)).toBe(true);
    const reopened = new TextRevealController(scheduler, [response]);
    expect(reopened.getSnapshot("answer").displayText).toBe(response.text);
    expect(reopened.consumeEntrance("answer")).toBe(false);
    step(250);
    expect(first.getSnapshot("answer").displayText).toBe(response.text);
  });
});
