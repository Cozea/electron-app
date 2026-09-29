/**
 * Retained pages stay in the document while hidden (see
 * app/navigation/RetainedPageOutlet.tsx), so a document-wide query can match
 * an element on a page the user is not looking at. Code that asks "is this on
 * screen now" — the product tour, focus helpers — must skip those subtrees.
 */
export const RETAINED_PAGE_ATTRIBUTE = "data-retained-page"

export function isInHiddenRetainedPage(element: Element): boolean {
  return element.closest(`[${RETAINED_PAGE_ATTRIBUTE}="hidden"]`) !== null
}

/** The first match that is not inside a hidden retained page. */
export function queryActiveElement(selector: string, root: ParentNode = document): Element | null {
  for (const element of root.querySelectorAll(selector)) {
    if (!isInHiddenRetainedPage(element)) return element
  }
  return null
}
