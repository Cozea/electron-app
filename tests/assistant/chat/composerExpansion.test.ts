import { describe, expect, it } from "vitest";

import {
  INITIAL_COMPOSER_EXPANSION_STATE,
  nextComposerExpansionState,
  type ComposerExpansionState,
} from "@/features/assistant/chat/composerExpansion";

/**
 * Replays what the editor would really measure. The inline row is narrower
 * than the stacked one because the prompt shares it with the `+` button, the
 * mode chip, the model picker and the send button.
 */
function measureLines(
  state: ComposerExpansionState,
  promptLength: number,
  inlineWidth: number,
  stackedWidth: number,
): number {
  const width = state.isMultiLine ? stackedWidth : inlineWidth;
  return Math.max(1, Math.ceil(promptLength / width));
}

/** Feed measurements back in until the state stops changing. */
function settle(
  state: ComposerExpansionState,
  promptLength: number,
  inlineWidth: number,
  stackedWidth: number,
  maxIterations = 40,
): { state: ComposerExpansionState; iterations: number } {
  let current = state;
  for (let iterations = 1; iterations <= maxIterations; iterations += 1) {
    const lines = measureLines(current, promptLength, inlineWidth, stackedWidth);
    const next = nextComposerExpansionState(current, lines, promptLength);
    if (next === current) return { state: current, iterations };
    current = next;
  }
  throw new Error(`composer expansion never settled at length ${promptLength}`);
}

/** Type one character at a time from empty up to `promptLength`. */
function typeUpTo(
  promptLength: number,
  inlineWidth: number,
  stackedWidth: number,
): ComposerExpansionState {
  let state = INITIAL_COMPOSER_EXPANSION_STATE;
  for (let typed = 0; typed <= promptLength; typed += 1) {
    state = settle(state, typed, inlineWidth, stackedWidth).state;
  }
  return state;
}

describe("nextComposerExpansionState", () => {
  it("stays inline while the prompt measures a single line", () => {
    const state = nextComposerExpansionState(INITIAL_COMPOSER_EXPANSION_STATE, 1, 40);
    expect(state.isMultiLine).toBe(false);
  });

  it("stacks as soon as the prompt measures more than one line", () => {
    const state = nextComposerExpansionState(INITIAL_COMPOSER_EXPANSION_STATE, 2, 60);
    expect(state.isMultiLine).toBe(true);
  });

  it("stacks on wrap regardless of how many characters that took", () => {
    // A narrow tile wraps early, a wide one late. Neither is a character count
    // the composer could have hardcoded.
    expect(nextComposerExpansionState(INITIAL_COMPOSER_EXPANSION_STATE, 2, 24).isMultiLine).toBe(
      true,
    );
    expect(nextComposerExpansionState(INITIAL_COMPOSER_EXPANSION_STATE, 2, 300).isMultiLine).toBe(
      true,
    );
  });

  it("learns the inline row's capacity as the user types", () => {
    let state = INITIAL_COMPOSER_EXPANSION_STATE;
    for (const length of [10, 40, 80]) {
      state = nextComposerExpansionState(state, 1, length);
    }
    expect(state.inlineSingleLineCapacity).toBe(80);
  });

  it("returns to the pill at the exact length it left it", () => {
    // The complaint this guards: typing past the wrap point and backspacing
    // back must restore the pill at the boundary, not at some smaller length.
    const state = typeUpTo(41, 40, 70);
    expect(state.isMultiLine).toBe(true);
    expect(state.inlineSingleLineCapacity).toBe(40);

    const back = settle(state, 40, 40, 70);
    expect(back.state.isMultiLine).toBe(false);
  });

  it("does not go back inline merely because the wider stacked row fits one line", () => {
    // 90 characters wrap inline but fit one stacked line. Going back inline
    // here is exactly the ping-pong the capacity exists to prevent.
    let state = typeUpTo(80, 80, 140);
    state = nextComposerExpansionState(state, 2, 90);
    expect(state.isMultiLine).toBe(true);

    state = nextComposerExpansionState(state, 1, 90);
    expect(state.isMultiLine).toBe(true);
  });

  it("resets once the prompt is emptied", () => {
    const state = typeUpTo(120, 40, 70);
    expect(state.isMultiLine).toBe(true);
    expect(settle(state, 0, 40, 70).state).toEqual(INITIAL_COMPOSER_EXPANSION_STATE);
  });

  it("never oscillates across the band where the two arrangements disagree", () => {
    // Inline fits 40 per line, stacked 70. Every length between is a candidate
    // for expand/collapse ping-pong.
    for (let promptLength = 0; promptLength <= 200; promptLength += 1) {
      const state = typeUpTo(promptLength, 40, 70);
      const settled = settle(state, promptLength, 40, 70);
      expect(settled.iterations).toBe(1);
      expect(settled.state.isMultiLine).toBe(promptLength > 40);
    }
  });

  it("settles after a paste that skips straight past the wrap point", () => {
    const pasted = settle(INITIAL_COMPOSER_EXPANSION_STATE, 500, 40, 70);
    expect(pasted.state.isMultiLine).toBe(true);

    // Deleting back down must terminate at every length rather than ping-pong,
    // and must end up back at the pill.
    let state = pasted.state;
    for (let length = 500; length >= 0; length -= 1) {
      state = settle(state, length, 40, 70).state;
    }
    expect(state.isMultiLine).toBe(false);
  });

  it("re-learns the capacity after the tile is resized narrower", () => {
    // Learned while the row was wide, then the row shrinks to 60.
    let state = typeUpTo(80, 80, 140);
    expect(state.inlineSingleLineCapacity).toBe(80);

    // Every length still settles at the new width -- no infinite bouncing.
    for (let length = 80; length >= 0; length -= 1) {
      state = settle(state, length, 60, 140).state;
    }
    expect(state).toEqual(INITIAL_COMPOSER_EXPANSION_STATE);

    // And the relearned capacity reflects the narrower row.
    const relearned = typeUpTo(61, 60, 140);
    expect(relearned.isMultiLine).toBe(true);
    expect(relearned.inlineSingleLineCapacity).toBe(60);
  });

  it("treats a fractional or zero line count as one line", () => {
    expect(nextComposerExpansionState(INITIAL_COMPOSER_EXPANSION_STATE, 0, 12).isMultiLine).toBe(
      false,
    );
    expect(nextComposerExpansionState(INITIAL_COMPOSER_EXPANSION_STATE, 1.6, 12).isMultiLine).toBe(
      false,
    );
  });

  it("returns the same object when nothing changed, so React can skip a render", () => {
    const inline = nextComposerExpansionState(INITIAL_COMPOSER_EXPANSION_STATE, 1, 20);
    expect(nextComposerExpansionState(inline, 1, 20)).toBe(inline);

    const stacked = nextComposerExpansionState(inline, 2, 50);
    expect(nextComposerExpansionState(stacked, 2, 50)).toBe(stacked);
  });
});
