import { describe, expect, it } from "vitest"

import { MAX_RETAINED_PAGES, retainPage } from "@/app/navigation/RetainedPageOutlet"
import {
  historyDirectionForKey,
  historyDirectionForMouseButton,
} from "@/app/navigation/useDesktopHistoryNavigation"

const page = (key: string) => ({ key })
const keys = (pages: ReadonlyMap<string, { key: string }>) => [...pages.keys()]

describe("retainPage", () => {
  it("keeps the current page last", () => {
    let pages = retainPage(new Map(), page("/store"))
    pages = retainPage(pages, page("/inbox"))
    pages = retainPage(pages, page("/store"))
    expect(keys(pages)).toEqual(["/inbox", "/store"])
  })

  it("drops the least recently visited page past the limit", () => {
    let pages = new Map<string, { key: string }>()
    for (const key of ["a", "b", "c", "d", "e", "f"]) pages = retainPage(pages, page(key))
    expect(pages.size).toBe(MAX_RETAINED_PAGES)
    expect(keys(pages)).toEqual(["b", "c", "d", "e", "f"])
  })

  it("does not mutate the previous map", () => {
    const before = retainPage(new Map(), page("a"))
    retainPage(before, page("b"))
    expect(keys(before)).toEqual(["a"])
  })
})

const key = (overrides: Partial<Parameters<typeof historyDirectionForKey>[0]>) => ({
  key: "",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...overrides,
})

describe("historyDirectionForKey", () => {
  it("maps ⌘[ and ⌘] on macOS", () => {
    expect(historyDirectionForKey(key({ key: "[", metaKey: true }), true)).toBe("back")
    expect(historyDirectionForKey(key({ key: "]", metaKey: true }), true)).toBe("forward")
  })

  it("maps Alt+← and Alt+→ elsewhere", () => {
    expect(historyDirectionForKey(key({ key: "ArrowLeft", altKey: true }), false)).toBe("back")
    expect(historyDirectionForKey(key({ key: "ArrowRight", altKey: true }), false)).toBe("forward")
  })

  it("ignores other modifiers and the other platform's keys", () => {
    expect(historyDirectionForKey(key({ key: "[", metaKey: true, shiftKey: true }), true)).toBeNull()
    expect(historyDirectionForKey(key({ key: "[", metaKey: true, altKey: true }), true)).toBeNull()
    expect(historyDirectionForKey(key({ key: "[", ctrlKey: true }), true)).toBeNull()
    expect(historyDirectionForKey(key({ key: "ArrowLeft", altKey: true }), true)).toBeNull()
    expect(historyDirectionForKey(key({ key: "[", metaKey: true }), false)).toBeNull()
  })
})

describe("historyDirectionForMouseButton", () => {
  it("maps the side buttons", () => {
    expect(historyDirectionForMouseButton(3)).toBe("back")
    expect(historyDirectionForMouseButton(4)).toBe("forward")
    expect(historyDirectionForMouseButton(0)).toBeNull()
    expect(historyDirectionForMouseButton(2)).toBeNull()
  })
})
