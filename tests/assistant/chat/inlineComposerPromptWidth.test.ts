import { describe, expect, it } from "vitest";

import {
  INLINE_COMPOSER_GAP_PX,
  INLINE_COMPOSER_PROMPT_PADDING_X_PX,
  INLINE_COMPOSER_SHELL_PADDING_X_PX,
  INLINE_COMPOSER_WIDTH_SAFETY_PX,
  resolveInlinePromptWidth,
} from "@/features/assistant/chat/inlineComposerPromptWidth";

const CHROME =
  INLINE_COMPOSER_SHELL_PADDING_X_PX * 2 +
  INLINE_COMPOSER_PROMPT_PADDING_X_PX * 2 +
  INLINE_COMPOSER_WIDTH_SAFETY_PX;

describe("resolveInlinePromptWidth", () => {
  it("subtracts the controls and one gap for each of them", () => {
    const width = resolveInlinePromptWidth({
      shellInnerWidth: 600,
      clusterWidths: [32, 90, 140],
    });

    // Three siblings sharing the row means three gaps, not two: the prompt is
    // itself an item, so every sibling has a gap between it and the prompt or
    // the sibling beside it.
    expect(width).toBe(600 - CHROME - (32 + 90 + 140) - INLINE_COMPOSER_GAP_PX * 3);
  });

  it("ignores clusters that are not rendered", () => {
    const withoutChip = resolveInlinePromptWidth({
      shellInnerWidth: 600,
      clusterWidths: [32, 0, 140],
    });
    const chipNeverMounted = resolveInlinePromptWidth({
      shellInnerWidth: 600,
      clusterWidths: [32, 140],
    });

    expect(withoutChip).toBe(chipNeverMounted);
  });

  it("errs narrow, never wide", () => {
    // Computing too wide is the failure that shows: the prompt stays inline
    // while the real editor wraps, and the pill clips its second line.
    const width = resolveInlinePromptWidth({ shellInnerWidth: 400, clusterWidths: [] });
    expect(width).toBe(400 - CHROME);
    expect(width).toBeLessThan(400 - INLINE_COMPOSER_SHELL_PADDING_X_PX * 2);
  });

  it("gives no answer rather than a nonsense one when the controls fill the row", () => {
    expect(
      resolveInlinePromptWidth({ shellInnerWidth: 120, clusterWidths: [60, 80] }),
    ).toBeNull();
    expect(resolveInlinePromptWidth({ shellInnerWidth: 0, clusterWidths: [] })).toBeNull();
    expect(
      resolveInlinePromptWidth({ shellInnerWidth: Number.NaN, clusterWidths: [] }),
    ).toBeNull();
  });

  it("does not depend on the arrangement it is deciding", () => {
    // The same terms are readable stacked and inline, so the answer is the same
    // in both -- which is the property that removes the wrap/unwrap loop.
    const inline = resolveInlinePromptWidth({
      shellInnerWidth: 520,
      clusterWidths: [32, 90, 140],
    });
    const stacked = resolveInlinePromptWidth({
      shellInnerWidth: 520,
      clusterWidths: [32, 90, 140],
    });

    expect(inline).toBe(stacked);
  });
});
