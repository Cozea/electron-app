export interface HeaderOverflowItem {
  id: string
  width: number
  priority: number
  pinned?: boolean
}

export const HEADER_OVERFLOW_GAP = 6
export const HEADER_OVERFLOW_BUTTON_WIDTH = 28
export const HEADER_RESTORE_HEADROOM = 16

/** One decision for the entire row; the overflow trigger participates in the budget. */
export function resolveHeaderOverflow(
  items: readonly HeaderOverflowItem[],
  availableWidth: number,
  previouslyHidden: ReadonlySet<string>,
): Set<string> {
  const active = items.filter((item) => item.width > 0)
  const hidden = new Set(active.filter((item) => previouslyHidden.has(item.id) && !item.pinned).map((item) => item.id))
  const occupied = () => active.reduce(
    (width, item) => width + (hidden.has(item.id) ? 0 : item.width + HEADER_OVERFLOW_GAP),
    hidden.size > 0 ? HEADER_OVERFLOW_BUTTON_WIDTH + HEADER_OVERFLOW_GAP : 0,
  )
  // Stable ordering for ties; important actions are removed last and restored first.
  const byPriority = [...active].sort((a, b) => a.priority - b.priority)
  for (const item of byPriority) {
    if (occupied() <= availableWidth) break
    if (!item.pinned) hidden.add(item.id)
  }
  for (const item of byPriority.reverse()) {
    if (!hidden.has(item.id)) continue
    hidden.delete(item.id)
    if (occupied() + HEADER_RESTORE_HEADROOM > availableWidth) hidden.add(item.id)
  }
  return hidden
}
