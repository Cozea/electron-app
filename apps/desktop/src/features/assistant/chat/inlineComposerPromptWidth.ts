import { useCallback, useEffect, useRef, useState, type RefCallback } from "react";

/**
 * How wide the prompt would be if it sat inline -- on one row with the controls
 * -- regardless of how it is laid out right now.
 *
 * This exists so the wrap decision can be a pure function. Measuring the prompt
 * where it actually sits makes the measurement depend on the arrangement it is
 * supposed to decide: inline the prompt shares the row with the `+` button, the
 * mode chip, the model picker and the send button, stacked it gets the full
 * width. A prompt that wraps inline measures as one line once stacked, which
 * would put it back inline, which would wrap it again.
 *
 * Every term below is readable in both arrangements, so the answer does not
 * change when the composer reflows -- which is what removes the loop, and with
 * it the need to remember a learned capacity and damp the result.
 */

/** Inline shell padding: `p-1.5`. */
export const INLINE_COMPOSER_SHELL_PADDING_X_PX = 6;
/** Inline shell gap between row items: `gap-1.5`. */
export const INLINE_COMPOSER_GAP_PX = 6;
/** Inline prompt inset: `px-1`. */
export const INLINE_COMPOSER_PROMPT_PADDING_X_PX = 4;
/**
 * Bias the answer narrow by a hair.
 *
 * The two failure directions are not equally bad. Computing too narrow stacks
 * one character early, which nobody can see. Computing too wide leaves the
 * prompt inline while the real editor wraps, and the pill clips its second line
 * -- so subpixel rounding is spent on the safe side.
 */
export const INLINE_COMPOSER_WIDTH_SAFETY_PX = 2;

export interface InlinePromptWidthInput {
  /** The shell's content box plus its padding, i.e. `clientWidth`. */
  readonly shellInnerWidth: number;
  /** Intrinsic widths of the controls that share the inline row with the prompt. */
  readonly clusterWidths: readonly number[];
}

/**
 * Solve for the prompt's inline width.
 *
 * @returns The width in px, or `null` when the controls already fill the row and
 *   no honest measurement is available.
 */
export function resolveInlinePromptWidth({
  shellInnerWidth,
  clusterWidths,
}: InlinePromptWidthInput): number | null {
  if (!Number.isFinite(shellInnerWidth) || shellInnerWidth <= 0) return null;

  let occupied = 0;
  let siblingCount = 0;
  for (const width of clusterWidths) {
    if (!Number.isFinite(width) || width <= 0) continue;
    occupied += width;
    siblingCount += 1;
  }

  // `siblingCount` gaps, not `siblingCount - 1`: the prompt is itself one of the
  // row's items, so each sibling contributes exactly one gap beside it.
  const available =
    shellInnerWidth -
    INLINE_COMPOSER_SHELL_PADDING_X_PX * 2 -
    INLINE_COMPOSER_PROMPT_PADDING_X_PX * 2 -
    INLINE_COMPOSER_GAP_PX * siblingCount -
    occupied -
    INLINE_COMPOSER_WIDTH_SAFETY_PX;

  return available > 0 ? available : null;
}

/**
 * Width of a control cluster's contents, which is not the same as the width of
 * its box: the mode chip's wrapper takes `basis-full` once stacked, so its box
 * spans the composer while the chip inside it stays intrinsic.
 *
 * Read through `offsetLeft`/`offsetWidth` rather than `getBoundingClientRect`.
 * The clusters are inside a `motion.div` running layout projection, and during
 * that animation client rects carry the in-flight transform while offsets stay
 * on the settled layout -- which is the geometry this is asking about.
 */
export function measureClusterContentWidth(element: HTMLElement | null): number {
  if (!element) return 0;

  const children = Array.from(element.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
  if (children.length === 0) return element.offsetWidth;

  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  for (const child of children) {
    if (child.offsetWidth === 0 && child.offsetHeight === 0) continue;
    left = Math.min(left, child.offsetLeft);
    right = Math.max(right, child.offsetLeft + child.offsetWidth);
  }

  return Number.isFinite(left) && right > left ? right - left : 0;
}

export interface InlineComposerPromptWidth {
  /** Attach to the composer shell. */
  readonly shellRef: RefCallback<HTMLElement>;
  /** Attach to the `+` cluster. */
  readonly leftClusterRef: RefCallback<HTMLElement>;
  /** Attach to the mode chip wrapper. */
  readonly modeChipRef: RefCallback<HTMLElement>;
  /** Attach to the model picker / send cluster. */
  readonly rightClusterRef: RefCallback<HTMLElement>;
  /** Current answer, or `null` before anything has been measured. */
  readonly inlinePromptWidthPx: number | null;
}

type ClusterSlot = "shell" | "left" | "modeChip" | "right";

/**
 * Track the prompt's inline width across resizes and control changes.
 *
 * A control appearing or disappearing (the mode chip, a longer model label) and
 * a tile resize are the same kind of event here: a term in the sum changed. The
 * arrangement flipping is not an event at all, which is the point.
 */
export function useInlineComposerPromptWidth(): InlineComposerPromptWidth {
  const nodesRef = useRef<Record<ClusterSlot, HTMLElement | null>>({
    shell: null,
    left: null,
    modeChip: null,
    right: null,
  });
  const [mountedVersion, setMountedVersion] = useState(0);
  const [inlinePromptWidthPx, setInlinePromptWidthPx] = useState<number | null>(null);

  const measure = useCallback(() => {
    const { shell, left, modeChip, right } = nodesRef.current;
    if (!shell) return;

    const next = resolveInlinePromptWidth({
      shellInnerWidth: shell.clientWidth,
      clusterWidths: [
        measureClusterContentWidth(left),
        measureClusterContentWidth(modeChip),
        measureClusterContentWidth(right),
      ],
    });

    setInlinePromptWidthPx((current) => {
      if (current === null || next === null) return next;
      return Math.abs(current - next) < 1 ? current : next;
    });
  }, []);

  const setNode = useCallback((slot: ClusterSlot, node: HTMLElement | null) => {
    if (nodesRef.current[slot] === node) return;
    nodesRef.current[slot] = node;
    // A conditional cluster mounting or unmounting changes the sum, and the
    // observer set has to follow it.
    setMountedVersion((version) => version + 1);
  }, []);

  const shellRef = useCallback<RefCallback<HTMLElement>>(
    (node) => setNode("shell", node),
    [setNode],
  );
  const leftClusterRef = useCallback<RefCallback<HTMLElement>>(
    (node) => setNode("left", node),
    [setNode],
  );
  const modeChipRef = useCallback<RefCallback<HTMLElement>>(
    (node) => setNode("modeChip", node),
    [setNode],
  );
  const rightClusterRef = useCallback<RefCallback<HTMLElement>>(
    (node) => setNode("right", node),
    [setNode],
  );

  useEffect(() => {
    measure();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      measure();
    });
    for (const node of Object.values(nodesRef.current)) {
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, [measure, mountedVersion]);

  return {
    shellRef,
    leftClusterRef,
    modeChipRef,
    rightClusterRef,
    inlinePromptWidthPx,
  };
}
