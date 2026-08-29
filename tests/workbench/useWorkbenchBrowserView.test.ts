import { describe, expect, it } from "vitest"

import {
  getWorkbenchBrowserDisplayError,
  shouldLoadWorkbenchBrowserUrl,
} from "@/features/projects/components/workbench/useWorkbenchBrowserView"

describe("shouldLoadWorkbenchBrowserUrl", () => {
  it("loads an already-requested URL when the native view is still blank", () => {
    expect(shouldLoadWorkbenchBrowserUrl({
      requestedUrl: "http://127.0.0.1:4173",
      lastRequestedUrl: "http://127.0.0.1:4173",
      currentUrl: "",
      loadError: null,
    })).toBe(true)
  })

  it("does not reload a matching healthy URL", () => {
    expect(shouldLoadWorkbenchBrowserUrl({
      requestedUrl: "http://127.0.0.1:4173",
      lastRequestedUrl: "http://127.0.0.1:4173",
      currentUrl: "http://127.0.0.1:4173",
      loadError: null,
    })).toBe(false)
  })

  it("retries the current URL after a native load error", () => {
    expect(shouldLoadWorkbenchBrowserUrl({
      requestedUrl: "http://127.0.0.1:4173",
      lastRequestedUrl: "http://127.0.0.1:4173",
      currentUrl: "http://127.0.0.1:4173",
      loadError: "net::ERR_CONNECTION_REFUSED",
    })).toBe(true)
  })
})

describe("getWorkbenchBrowserDisplayError", () => {
  it("prefers transport errors over blank HTTP response errors", () => {
    expect(getWorkbenchBrowserDisplayError({
      loadError: "net::ERR_CONNECTION_REFUSED",
      httpError: "HTTP 500 Internal Server Error",
    })).toBe("net::ERR_CONNECTION_REFUSED")
  })

  it("surfaces a blank HTTP response error when navigation itself succeeded", () => {
    expect(getWorkbenchBrowserDisplayError({
      loadError: null,
      httpError: "HTTP 500 Internal Server Error",
    })).toBe("HTTP 500 Internal Server Error")
  })
})
