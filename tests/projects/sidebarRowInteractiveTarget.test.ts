import { describe, expect, it } from 'vitest'

import {
  SIDEBAR_ROW_INTERACTIVE_SELECTOR,
  isSidebarRowInteractiveTarget,
} from '@/features/projects/ui/sidebar/projectSidebarShared'

/**
 * A stand-in for an event target. The node environment has no DOM, so this
 * records the selector the predicate asks about and answers from a fixed list of
 * selectors the element is meant to match.
 */
function target(matches: string[]): Pick<Element, 'closest'> & { asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    closest(selector: string) {
      asked.push(selector)
      const parts = selector.split(',').map((part) => part.trim())
      return parts.some((part) => matches.includes(part)) ? ({} as Element) : null
    },
  } as Pick<Element, 'closest'> & { asked: string[] }
}

describe('isSidebarRowInteractiveTarget', () => {
  it('claims a click that landed on a button, such as the chevron or options menu', () => {
    expect(isSidebarRowInteractiveTarget(target(['button']))).toBe(true)
  })

  it('claims a click on a link', () => {
    expect(isSidebarRowInteractiveTarget(target(['a']))).toBe(true)
  })

  it('claims a click on an element that is only a button by role', () => {
    expect(isSidebarRowInteractiveTarget(target(["[role='button']"]))).toBe(true)
  })

  it('leaves a click on the row background alone so the row can open the project', () => {
    expect(isSidebarRowInteractiveTarget(target([]))).toBe(false)
  })

  it('treats a missing target as the row background', () => {
    expect(isSidebarRowInteractiveTarget(null)).toBe(false)
    expect(isSidebarRowInteractiveTarget(undefined)).toBe(false)
  })

  it('asks about every control kind a row can hold', () => {
    const probe = target([])
    isSidebarRowInteractiveTarget(probe)

    expect(probe.asked).toEqual([SIDEBAR_ROW_INTERACTIVE_SELECTOR])
    for (const part of ['button', 'a', 'input', 'select', 'textarea', "[role='button']", "[role='menuitem']"]) {
      expect(SIDEBAR_ROW_INTERACTIVE_SELECTOR).toContain(part)
    }
  })
})
