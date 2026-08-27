import type {
  BrowserAutomationClickInput,
  BrowserAutomationError,
  BrowserAutomationNavigateInput,
  BrowserAutomationResult,
  BrowserAutomationSnapshot,
  BrowserAutomationStatus,
  BrowserAutomationTileInput,
  BrowserAutomationTypeInput,
} from "../../../../shared/browserAutomationTypes"
import {
  COZEA_BROWSER_AGENT_AUTOMATION_FLAG,
  isBrowserAgentAutomationEnabled,
} from "./flags"
import {
  buildClickScript,
  buildSnapshotScript,
  buildTypeScript,
  type PageActionScriptResult,
  type PageSnapshotScriptResult,
} from "./pageScripts"
import { evaluateAutomationNavigateUrl } from "./urlPolicy"

export interface BrowserAutomationHostTileState {
  tileId: string
  url: string
  title: string
  isLoading: boolean
}

/**
 * Minimal host surface the adapter needs from WorkbenchBrowserService / IPC.
 * Keeps Electron out of unit tests.
 */
export interface BrowserAutomationHost {
  listOpenTiles(): BrowserAutomationHostTileState[]
  getTileState(tileId: string): BrowserAutomationHostTileState | null
  navigate(tileId: string, url: string): Promise<BrowserAutomationHostTileState | null>
  executeJavaScript(tileId: string, script: string): Promise<unknown>
}

export interface BrowserAutomationAdapterOptions {
  host: BrowserAutomationHost
  /** Override flag reader (tests). Defaults to env-backed `cozea.browser.agentAutomation`. */
  isEnabled?: () => boolean
}

function disabledError(): BrowserAutomationError {
  return {
    code: "disabled",
    message: `Browser agent automation is off (flag ${COZEA_BROWSER_AGENT_AUTOMATION_FLAG}). Set COZEA_BROWSER_AGENT_AUTOMATION=1 to enable.`,
  }
}

function fail<T>(error: BrowserAutomationError): BrowserAutomationResult<T> {
  return { ok: false, error }
}

function ok<T>(result: T): BrowserAutomationResult<T> {
  return { ok: true, result }
}

function asActionResult(value: unknown): PageActionScriptResult | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  if (typeof record.ok !== "boolean") return null
  return {
    ok: record.ok,
    error:
      record.error === "not_found" ||
      record.error === "not_editable" ||
      record.error === "invalid_selector"
        ? record.error
        : undefined,
    message: typeof record.message === "string" ? record.message : undefined,
  }
}

function asSnapshotResult(value: unknown): PageSnapshotScriptResult | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  if (typeof record.title !== "string" || typeof record.url !== "string") return null
  const interactiveRaw = Array.isArray(record.interactiveElements)
    ? record.interactiveElements
    : []
  const interactiveElements = interactiveRaw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      tag: typeof item.tag === "string" ? item.tag : "unknown",
      role: typeof item.role === "string" ? item.role : null,
      name: typeof item.name === "string" ? item.name : "",
      selector: typeof item.selector === "string" ? item.selector : "",
    }))
  return {
    url: record.url,
    title: record.title,
    visibleText: typeof record.visibleText === "string" ? record.visibleText : "",
    interactiveElements,
  }
}

/**
 * Tool adapter: navigate / snapshot / click / type against already-open browser tiles.
 */
export class BrowserAutomationAdapter {
  private readonly host: BrowserAutomationHost
  private readonly isEnabled: () => boolean

  constructor(options: BrowserAutomationAdapterOptions) {
    this.host = options.host
    this.isEnabled = options.isEnabled ?? (() => isBrowserAgentAutomationEnabled())
  }

  status(): BrowserAutomationResult<BrowserAutomationStatus> {
    const enabled = this.isEnabled()
    const openTiles = enabled ? this.host.listOpenTiles() : []
    return ok({
      enabled,
      flag: COZEA_BROWSER_AGENT_AUTOMATION_FLAG,
      openTiles,
    })
  }

  async navigate(
    input: BrowserAutomationNavigateInput,
  ): Promise<BrowserAutomationResult<BrowserAutomationHostTileState>> {
    if (!this.isEnabled()) return fail(disabledError())

    const tileId = input.tileId?.trim()
    if (!tileId) {
      return fail({ code: "invalid_input", message: "tileId is required." })
    }
    if (!this.host.getTileState(tileId)) {
      return fail({
        code: "tile_not_open",
        message: `Browser tile "${tileId}" is not open. Open a browser tile in the workbench first.`,
      })
    }

    const policy = evaluateAutomationNavigateUrl(input.url ?? "")
    if (!policy.allowed || !policy.normalizedUrl) {
      return fail({
        code: "url_not_allowed",
        message: policy.reason ?? "URL is not allowed for agent navigation.",
      })
    }

    try {
      const next = await this.host.navigate(tileId, policy.normalizedUrl)
      if (!next) {
        return fail({
          code: "tile_not_open",
          message: `Browser tile "${tileId}" disappeared during navigate.`,
        })
      }
      return ok(next)
    } catch (error) {
      return fail({
        code: "execution_failed",
        message: error instanceof Error ? error.message : "Navigate failed.",
      })
    }
  }

  async snapshot(
    input: BrowserAutomationTileInput,
  ): Promise<BrowserAutomationResult<BrowserAutomationSnapshot>> {
    if (!this.isEnabled()) return fail(disabledError())

    const tileId = input.tileId?.trim()
    if (!tileId) {
      return fail({ code: "invalid_input", message: "tileId is required." })
    }
    const state = this.host.getTileState(tileId)
    if (!state) {
      return fail({
        code: "tile_not_open",
        message: `Browser tile "${tileId}" is not open.`,
      })
    }

    try {
      const raw = await this.host.executeJavaScript(tileId, buildSnapshotScript())
      const page = asSnapshotResult(raw)
      if (!page) {
        return fail({
          code: "execution_failed",
          message: "Snapshot script returned an unexpected payload.",
        })
      }
      return ok({
        tileId,
        url: page.url || state.url,
        title: page.title || state.title,
        isLoading: state.isLoading,
        visibleText: page.visibleText,
        interactiveElements: page.interactiveElements,
      })
    } catch (error) {
      return fail({
        code: "execution_failed",
        message: error instanceof Error ? error.message : "Snapshot failed.",
      })
    }
  }

  async click(input: BrowserAutomationClickInput): Promise<BrowserAutomationResult<{ clicked: true }>> {
    if (!this.isEnabled()) return fail(disabledError())

    const tileId = input.tileId?.trim()
    const selector = input.selector?.trim()
    if (!tileId) {
      return fail({ code: "invalid_input", message: "tileId is required." })
    }
    if (!selector) {
      return fail({ code: "invalid_input", message: "selector is required." })
    }
    if (!this.host.getTileState(tileId)) {
      return fail({
        code: "tile_not_open",
        message: `Browser tile "${tileId}" is not open.`,
      })
    }

    try {
      const raw = await this.host.executeJavaScript(tileId, buildClickScript(selector))
      const action = asActionResult(raw)
      if (!action) {
        return fail({
          code: "execution_failed",
          message: "Click script returned an unexpected payload.",
        })
      }
      if (!action.ok) {
        if (action.error === "invalid_selector") {
          return fail({
            code: "invalid_input",
            message: action.message ?? "Invalid CSS selector.",
          })
        }
        return fail({
          code: "target_not_found",
          message: action.message ?? "Click target not found.",
        })
      }
      return ok({ clicked: true })
    } catch (error) {
      return fail({
        code: "execution_failed",
        message: error instanceof Error ? error.message : "Click failed.",
      })
    }
  }

  async type(
    input: BrowserAutomationTypeInput,
  ): Promise<BrowserAutomationResult<{ typed: true }>> {
    if (!this.isEnabled()) return fail(disabledError())

    const tileId = input.tileId?.trim()
    if (!tileId) {
      return fail({ code: "invalid_input", message: "tileId is required." })
    }
    if (typeof input.text !== "string") {
      return fail({ code: "invalid_input", message: "text is required." })
    }
    if (!this.host.getTileState(tileId)) {
      return fail({
        code: "tile_not_open",
        message: `Browser tile "${tileId}" is not open.`,
      })
    }

    const selector = input.selector?.trim()
    try {
      const raw = await this.host.executeJavaScript(
        tileId,
        buildTypeScript({
          selector: selector || undefined,
          text: input.text,
          clear: Boolean(input.clear),
        }),
      )
      const action = asActionResult(raw)
      if (!action) {
        return fail({
          code: "execution_failed",
          message: "Type script returned an unexpected payload.",
        })
      }
      if (!action.ok) {
        if (action.error === "invalid_selector") {
          return fail({
            code: "invalid_input",
            message: action.message ?? "Invalid CSS selector.",
          })
        }
        if (action.error === "not_editable") {
          return fail({
            code: "target_not_editable",
            message: action.message ?? "Target is not editable.",
          })
        }
        return fail({
          code: "target_not_found",
          message: action.message ?? "Type target not found.",
        })
      }
      return ok({ typed: true })
    } catch (error) {
      return fail({
        code: "execution_failed",
        message: error instanceof Error ? error.message : "Type failed.",
      })
    }
  }
}

export function createBrowserAutomationHostFromWorkbench(service: {
  listOpenTileIds(): string[]
  getState(tileId: string): {
    tileId: string
    url: string
    title: string
    isLoading: boolean
  } | null
  navigate(tileId: string, url: string): Promise<{
    tileId: string
    url: string
    title: string
    isLoading: boolean
  } | null>
  executeJavaScript(tileId: string, script: string): Promise<unknown>
}): BrowserAutomationHost {
  const toTile = (state: {
    tileId: string
    url: string
    title: string
    isLoading: boolean
  }): BrowserAutomationHostTileState => ({
    tileId: state.tileId,
    url: state.url,
    title: state.title,
    isLoading: state.isLoading,
  })

  return {
    listOpenTiles() {
      return service
        .listOpenTileIds()
        .map((tileId) => service.getState(tileId))
        .filter((state): state is NonNullable<typeof state> => Boolean(state))
        .map(toTile)
    },
    getTileState(tileId) {
      const state = service.getState(tileId)
      return state ? toTile(state) : null
    },
    async navigate(tileId, url) {
      const state = await service.navigate(tileId, url)
      return state ? toTile(state) : null
    },
    executeJavaScript(tileId, script) {
      return service.executeJavaScript(tileId, script)
    },
  }
}
