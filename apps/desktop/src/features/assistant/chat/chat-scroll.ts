export const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 64;

export interface ScrollPosition {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

export function scrollDistanceFromBottom(position: ScrollPosition): number {
  const { scrollTop, clientHeight, scrollHeight } = position;
  if (![scrollTop, clientHeight, scrollHeight].every(Number.isFinite)) {
    return 0;
  }
  return Math.max(0, scrollHeight - clientHeight - scrollTop);
}

export function scrollTopForBottomDistance(
  position: Pick<ScrollPosition, "clientHeight" | "scrollHeight">,
  bottomDistancePx: number,
): number {
  const distance = Number.isFinite(bottomDistancePx) ? Math.max(0, bottomDistancePx) : 0;
  const clientHeight = Number.isFinite(position.clientHeight)
    ? Math.max(0, position.clientHeight)
    : 0;
  const scrollHeight = Number.isFinite(position.scrollHeight)
    ? Math.max(0, position.scrollHeight)
    : 0;
  return Math.max(0, scrollHeight - clientHeight - distance);
}

export function isScrollContainerNearBottom(
  position: ScrollPosition,
  thresholdPx = AUTO_SCROLL_BOTTOM_THRESHOLD_PX,
): boolean {
  const threshold = Number.isFinite(thresholdPx)
    ? Math.max(0, thresholdPx)
    : AUTO_SCROLL_BOTTOM_THRESHOLD_PX;

  if (![position.scrollTop, position.clientHeight, position.scrollHeight].every(Number.isFinite)) {
    return true;
  }

  return scrollDistanceFromBottom(position) <= threshold;
}
