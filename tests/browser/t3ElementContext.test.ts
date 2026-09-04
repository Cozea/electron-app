import type { PickedElementPayload } from "@cozea/contracts/t3/ipc"
import { describe, expect, it } from "vitest"

import {
  appendElementContextsToPrompt,
  buildElementContextBlock,
  type ElementContextSelection,
  elementContextDedupKey,
  extractTrailingElementContexts,
  formatElementContextLabel,
  formatElementContextSourceLabel,
  newElementContextId,
  normalizeElementContextSelection,
} from "@/features/browser/elementContext"

function makePayload(overrides?: Partial<PickedElementPayload>): PickedElementPayload {
  return {
    pageUrl: "https://example.com/dashboard",
    pageTitle: "Dashboard",
    tagName: "BUTTON",
    selector: "button.submit",
    htmlPreview: '<button class="submit">Save</button>',
    componentName: "SubmitButton",
    source: {
      functionName: "SubmitButton",
      fileName: "/repo/src/Button.tsx",
      lineNumber: 12,
      columnNumber: 5,
    },
    stack: [],
    styles: ".submit { color: white; }",
    pickedAt: "2026-05-03T18:00:00.000Z",
    ...overrides,
  }
}

function makeSelection(overrides?: Partial<ElementContextSelection>): ElementContextSelection {
  return {
    pageUrl: "https://example.com/dashboard",
    pageTitle: "Dashboard",
    tagName: "button",
    selector: "button.submit",
    htmlPreview: '<button class="submit">Save</button>',
    componentName: "SubmitButton",
    source: {
      functionName: "SubmitButton",
      fileName: "/repo/src/Button.tsx",
      lineNumber: 12,
      columnNumber: 5,
    },
    styles: ".submit { color: white; }",
    ...overrides,
  }
}

describe("pinned T3 element context normalization", () => {
  it("trims fields, lowercases tags, and prefers source over stack", () => {
    const result = normalizeElementContextSelection(
      makePayload({
        tagName: "  Button  ",
        pageUrl: "  https://example.com  ",
        pageTitle: "  Dashboard  ",
        selector: "   ",
        componentName: "   ",
        source: {
          functionName: " Outer ",
          fileName: " /repo/Outer.tsx ",
          lineNumber: 7,
          columnNumber: 0,
        },
        stack: [
          {
            functionName: "Inner",
            fileName: "/repo/Inner.tsx",
            lineNumber: 99,
            columnNumber: 9,
          },
        ],
      }),
    )
    expect(result).toMatchObject({
      tagName: "button",
      pageUrl: "https://example.com",
      pageTitle: "Dashboard",
      selector: null,
      componentName: null,
      source: {
        functionName: "Outer",
        fileName: "/repo/Outer.tsx",
        lineNumber: 7,
        columnNumber: 0,
      },
    })
  })

  it("rejects empty identities, bounds persisted strings, and normalizes line endings", () => {
    expect(normalizeElementContextSelection(makePayload({ pageUrl: "" }))).toBeNull()
    expect(normalizeElementContextSelection(makePayload({ tagName: "   " }))).toBeNull()
    const huge = "x".repeat(10_000)
    const bounded = normalizeElementContextSelection(
      makePayload({ htmlPreview: huge, styles: huge }),
    )
    expect(bounded?.htmlPreview).toHaveLength(4_000)
    expect(bounded?.styles).toHaveLength(4_000)
    expect(bounded?.htmlPreview.endsWith("…")).toBe(true)
    const normalized = normalizeElementContextSelection(
      makePayload({ htmlPreview: "<a>\r\nhi\r\n</a>", styles: ".a {\r\n color: red;\r\n}" }),
    )
    expect(normalized?.htmlPreview).toBe("<a>\nhi\n</a>")
    expect(normalized?.styles).toBe(".a {\n color: red;\n}")
  })

  it("falls back to the first stack frame", () => {
    expect(
      normalizeElementContextSelection(
        makePayload({
          source: null,
          stack: [
            {
              functionName: "FromStack",
              fileName: "/repo/FromStack.tsx",
              lineNumber: 3,
              columnNumber: null,
            },
          ],
        }),
      )?.source,
    ).toMatchObject({ functionName: "FromStack", fileName: "/repo/FromStack.tsx" })
  })
})

describe("pinned T3 element context presentation", () => {
  it("prefers component labels and formats source basenames", () => {
    expect(formatElementContextLabel(makeSelection())).toBe("<SubmitButton>")
    expect(formatElementContextLabel(makeSelection({ componentName: null }))).toBe("<button>")
    expect(formatElementContextSourceLabel(makeSelection())).toBe("Button.tsx:12")
    expect(formatElementContextSourceLabel(makeSelection({ source: null }))).toBeNull()
  })

  it("deduplicates the same picked element but not another selector or page", () => {
    const first = makeSelection()
    expect(elementContextDedupKey(first)).toBe(
      elementContextDedupKey(makeSelection({ htmlPreview: "changed", styles: "changed" })),
    )
    expect(elementContextDedupKey(first)).not.toBe(
      elementContextDedupKey(makeSelection({ selector: "button.cancel" })),
    )
    expect(elementContextDedupKey(first)).not.toBe(
      elementContextDedupKey(makeSelection({ pageUrl: "https://example.com/other" })),
    )
  })

  it("serializes and extracts exact source, HTML, style, and multiple context entries", () => {
    const contexts = [
      makeSelection(),
      makeSelection({ selector: "button.cancel", componentName: "CancelButton" }),
    ]
    const block = buildElementContextBlock(contexts)
    expect(block).toContain("- <SubmitButton> (Button.tsx:12):")
    expect(block).toContain("  source: /repo/src/Button.tsx:12:5")
    expect(block).toContain('  <button class="submit">Save</button>')
    const prompt = appendElementContextsToPrompt("Investigate this", contexts)
    expect(extractTrailingElementContexts(prompt)).toMatchObject({
      promptText: "Investigate this",
      contextCount: 2,
      contexts: [
        { header: "<SubmitButton> (Button.tsx:12)" },
        { header: "<CancelButton> (Button.tsx:12)" },
      ],
    })
  })

  it("does not add an empty block and produces unique stable ids", () => {
    expect(buildElementContextBlock([])).toBe("")
    expect(appendElementContextsToPrompt("Hello", [])).toBe("Hello")
    const ids = new Set(Array.from({ length: 10 }, () => newElementContextId()))
    expect(ids.size).toBe(10)
    expect(Array.from(ids).every((id) => id.startsWith("el_"))).toBe(true)
  })
})
