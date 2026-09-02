import { describe, expect, it } from "vitest"

import {
  isSupportedDevAppToolInputSchema,
  validateDevAppToolInput,
} from "../../shared/devAppToolInputValidation"

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["query", "options"],
  properties: {
    query: { type: "string", minLength: 1, maxLength: 40 },
    options: {
      type: "object",
      additionalProperties: false,
      required: ["limit"],
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 20 },
        tags: {
          type: "array",
          maxItems: 3,
          items: { type: "string", maxLength: 12 },
        },
      },
    },
  },
} as const

describe("DevApp tool input validation", () => {
  it("accepts and enforces the documented bounded schema subset", () => {
    expect(isSupportedDevAppToolInputSchema(SCHEMA)).toBe(true)
    expect(
      validateDevAppToolInput(SCHEMA, {
        query: "Ada",
        options: { limit: 5, tags: ["staff"] },
      }),
    ).toBeNull()
    expect(validateDevAppToolInput(SCHEMA, { query: "Ada", options: { limit: 0 } })).toMatch(
      /minimum/,
    )
    expect(
      validateDevAppToolInput(SCHEMA, {
        query: "Ada",
        options: { limit: 5, secret: true },
      }),
    ).toMatch(/not allowed/)
  })

  it("rejects schemas Cozea cannot enforce instead of silently weakening them", () => {
    expect(isSupportedDevAppToolInputSchema({ type: "object", $ref: "https://example.com" })).toBe(
      false,
    )
    expect(
      isSupportedDevAppToolInputSchema({
        type: "object",
        properties: { query: { type: "string", pattern: "^safe$" } },
      }),
    ).toBe(false)
    expect(validateDevAppToolInput({ type: "string" }, "value")).toMatch(/unsupported/)
  })

  it("rejects non-JSON, cyclic, deep, non-finite, and oversized values", () => {
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    expect(validateDevAppToolInput({ type: "object" }, cycle)).toMatch(/cycles/)
    expect(validateDevAppToolInput({ type: "object" }, { value: Number.NaN })).toMatch(/finite/)
    expect(validateDevAppToolInput({ type: "object" }, { value: new Date() })).toMatch(
      /only JSON/,
    )
    expect(
      validateDevAppToolInput({ type: "object" }, { value: "x".repeat(600_000) }),
    ).toMatch(/exceeds 1 MiB/)

    let deep: Record<string, unknown> = {}
    const root = deep
    for (let index = 0; index < 34; index += 1) {
      const child: Record<string, unknown> = {}
      deep.child = child
      deep = child
    }
    expect(validateDevAppToolInput({ type: "object" }, root)).toMatch(/too complex/)
  })

  it("enforces exact anyOf, oneOf, and allOf semantics", () => {
    const anyOf = {
      type: "object",
      anyOf: [
        { type: "object", required: ["text"] },
        { type: "object", required: ["count"] },
      ],
    }
    expect(validateDevAppToolInput(anyOf, { text: "ok" })).toBeNull()
    expect(validateDevAppToolInput(anyOf, {})).toMatch(/any allowed shape/)

    const oneOf = { ...anyOf, anyOf: undefined, oneOf: anyOf.anyOf }
    expect(validateDevAppToolInput(oneOf, { text: "ok" })).toBeNull()
    expect(validateDevAppToolInput(oneOf, { text: "ok", count: 1 })).toMatch(/exactly one/)

    const allOf = { ...anyOf, anyOf: undefined, allOf: anyOf.anyOf }
    expect(validateDevAppToolInput(allOf, { text: "ok", count: 1 })).toBeNull()
    expect(validateDevAppToolInput(allOf, { text: "ok" })).toMatch(/required/)
  })
})
