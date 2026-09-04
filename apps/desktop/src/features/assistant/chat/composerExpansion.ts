/**
 * Decides whether the composer lays its prompt out inline -- on one row with
 * the controls, as a pill -- or gives it a full-width row of its own with the
 * controls in a strip underneath.
 *
 * The decision comes from a measurement of how many line boxes the prompt
 * actually occupies, not from a character count: how many characters fit on one
 * line depends on the tile width and on how much horizontal room the controls
 * take, and both vary.
 *
 * The reason this needs state is that the two arrangements do not give the
 * prompt the same width. Inline it shares the row with the `+` button, the mode
 * chip, the model picker and the send button; stacked it gets the full width.
 * So a prompt that wraps inline can measure as a single line once stacked --
 * which would put it back inline, which would wrap it again, forever.
 *
 * `inlineSingleLineCapacity` breaks that loop. It is a length known to fit on
 * one line *in the inline arrangement*, learned from real measurements taken
 * while inline. Going back inline at or below it cannot rewrap.
 */
export interface ComposerExpansionState {
  /** True when the prompt should take a full-width row of its own. */
  readonly isMultiLine: boolean;
  /**
   * Longest prompt length known to fit one inline line, or `null` before any
   * inline measurement has been seen.
   */
  readonly inlineSingleLineCapacity: number | null;
}

export const INITIAL_COMPOSER_EXPANSION_STATE: ComposerExpansionState = {
  isMultiLine: false,
  inlineSingleLineCapacity: null,
};

/**
 * Fold a fresh line measurement into the expansion state.
 *
 * @param state Current expansion state.
 * @param measuredLines Line boxes the prompt occupies at its present width.
 * @param promptLength Length of the prompt that was measured.
 * @returns The next state, or `state` itself when nothing changed.
 */
export function nextComposerExpansionState(
  state: ComposerExpansionState,
  measuredLines: number,
  promptLength: number,
): ComposerExpansionState {
  const { isMultiLine, inlineSingleLineCapacity } = state;
  const lines = Math.max(1, Math.floor(measuredLines));

  if (promptLength === 0 && lines === 1) {
    return INITIAL_COMPOSER_EXPANSION_STATE;
  }

  if (lines > 1) {
    if (isMultiLine) return state;
    // Measured while inline, so this length demonstrably does not fit one
    // inline line. Dividing by the line count estimates what does fit; it
    // deliberately under-estimates, because a capacity that is too generous
    // would let the prompt collapse back into a width that rewraps it. Typing
    // on grows the estimate back up to the true capacity.
    const estimatedCapacity = Math.max(0, Math.floor(promptLength / lines));
    // When the user typed into the compact row, the previous measurement is
    // the exact longest prefix that fit. Keep it instead of replacing it with
    // the much smaller `length / lines` estimate; doing the latter was why
    // backspacing did not return to the pill at the real wrap boundary.
    //
    // If something else narrowed the row (a mode chip, model label, or tile
    // resize), the current prompt can now wrap at a length that used to fit.
    // Tighten the remembered bound by one so this exact layout cannot bounce
    // between inline and stacked forever.
    const capacity =
      inlineSingleLineCapacity === null
        ? estimatedCapacity
        : Math.min(inlineSingleLineCapacity, Math.max(0, promptLength - 1));
    return { isMultiLine: true, inlineSingleLineCapacity: capacity };
  }

  if (!isMultiLine) {
    // One line while inline: the inline row is known to hold this much.
    const capacity = Math.max(inlineSingleLineCapacity ?? 0, promptLength);
    return capacity === inlineSingleLineCapacity
      ? state
      : { isMultiLine: false, inlineSingleLineCapacity: capacity };
  }

  // Stacked and down to one line at the full width. Go back inline only at a
  // length the inline row is known to fit; otherwise this would rewrap at once.
  const fitsInline = promptLength <= (inlineSingleLineCapacity ?? 0);
  return fitsInline ? { ...state, isMultiLine: false } : state;
}
