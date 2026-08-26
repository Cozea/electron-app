/**
 * Agent browser automation MVP contracts (Track C / Wave 0).
 *
 * Flag: `cozea.browser.agentAutomation` (env `COZEA_BROWSER_AGENT_AUTOMATION`).
 * Default: off. See `docs/browser-agent-automation.md`.
 */

export const BROWSER_AUTOMATION_OPERATIONS = [
  "status",
  "navigate",
  "snapshot",
  "click",
  "type",
] as const

export type BrowserAutomationOperation = (typeof BROWSER_AUTOMATION_OPERATIONS)[number]

export type BrowserAutomationErrorCode =
  | "disabled"
  | "tile_not_open"
  | "url_not_allowed"
  | "invalid_input"
  | "execution_failed"
  | "target_not_found"
  | "target_not_editable"

export interface BrowserAutomationError {
  code: BrowserAutomationErrorCode
  message: string
}

export interface BrowserAutomationResult<T> {
  ok: boolean
  result?: T
  error?: BrowserAutomationError
}

export interface BrowserAutomationStatus {
  enabled: boolean
  flag: "cozea.browser.agentAutomation"
  openTiles: Array<{
    tileId: string
    url: string
    title: string
    isLoading: boolean
  }>
}

export interface BrowserAutomationNavigateInput {
  tileId: string
  url: string
}

export interface BrowserAutomationTileInput {
  tileId: string
}

export interface BrowserAutomationClickInput {
  tileId: string
  /** CSS selector (MVP; Playwright locators are out of scope). */
  selector: string
}

export interface BrowserAutomationTypeInput {
  tileId: string
  /** CSS selector for an editable element, or omit to type into the focused element. */
  selector?: string
  text: string
  clear?: boolean
}

export interface BrowserAutomationInteractiveElement {
  tag: string
  role: string | null
  name: string
  selector: string
}

/** a11y-lite / title+text snapshot suitable for agent grounding. */
export interface BrowserAutomationSnapshot {
  tileId: string
  url: string
  title: string
  isLoading: boolean
  visibleText: string
  interactiveElements: BrowserAutomationInteractiveElement[]
}
