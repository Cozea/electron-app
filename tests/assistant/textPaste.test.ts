import { describe, expect, it } from "vitest";
import {
  isPasteAsTextShortcut,
  nextPastedTextFileName,
  pastedTextDisposition,
  replaceTextSelection,
  wouldTextPasteExceedLimit,
} from "../../apps/desktop/src/features/assistant/chat/textPaste";

describe("textPaste", () => {
  it("detects paste as text shortcut for mac and non-mac", () => {
    expect(
      isPasteAsTextShortcut(
        { key: "v", shiftKey: true, metaKey: true, ctrlKey: false, altKey: false },
        true,
      ),
    ).toBe(true);
    expect(
      isPasteAsTextShortcut(
        { key: "v", shiftKey: true, metaKey: false, ctrlKey: true, altKey: false },
        false,
      ),
    ).toBe(true);
    expect(
      isPasteAsTextShortcut(
        { key: "v", shiftKey: false, metaKey: true, ctrlKey: false, altKey: false },
        true,
      ),
    ).toBe(false);
  });

  it("determines attachment vs inline disposition based on size and lines", () => {
    expect(
      pastedTextDisposition({
        text: "short text",
        canAttach: true,
      }),
    ).toBe("inline");

    const longLines = Array.from({ length: 105 }, (_, i) => `line ${i}`).join("\n");
    expect(
      pastedTextDisposition({
        text: longLines,
        canAttach: true,
      }),
    ).toBe("attachment");

    const hugeText = "a".repeat(35 * 1024);
    expect(
      pastedTextDisposition({
        text: hugeText,
        canAttach: true,
      }),
    ).toBe("attachment");

    expect(
      pastedTextDisposition({
        text: hugeText,
        canAttach: true,
        bypassAutoAttachment: true,
      }),
    ).toBe("inline");
  });

  it("generates next sequential pasted-text file names", () => {
    expect(nextPastedTextFileName([])).toBe("pasted-text.txt");
    expect(nextPastedTextFileName(["pasted-text.txt"])).toBe("pasted-text-2.txt");
    expect(nextPastedTextFileName(["pasted-text.txt", "pasted-text-2.txt"])).toBe("pasted-text-3.txt");
  });

  it("replaces text selection correctly", () => {
    expect(
      replaceTextSelection({
        value: "hello world",
        selection: { start: 6, end: 11 },
        text: "there",
      }),
    ).toEqual({
      value: "hello there",
      cursor: 11,
    });
  });

  it("checks if text paste would exceed limit", () => {
    expect(
      wouldTextPasteExceedLimit({
        valueLength: 10,
        selection: { start: 0, end: 0 },
        textLength: 5,
        maxLength: 12,
      }),
    ).toBe(true);

    expect(
      wouldTextPasteExceedLimit({
        valueLength: 10,
        selection: { start: 0, end: 0 },
        textLength: 2,
        maxLength: 12,
      }),
    ).toBe(false);
  });
});
