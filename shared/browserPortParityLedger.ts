export type BrowserPortParityArea =
  | "navigation"
  | "http-errors"
  | "session-isolation"
  | "preview-features"
  | "shell"
  | "automation"
  | "security"

export interface BrowserPortParityRequirement {
  id: string
  area: BrowserPortParityArea
  expectation: string
  status: "pending-t3-port" | "ported" | "cozea-adapted" | "shell-inapplicable"
}

/**
 * Requirements preserved from the removed native browser tests. A non-pending
 * entry must have executable parity coverage; recording it here alone is not
 * evidence that it is implemented.
 */
export const T3_BROWSER_PORT_PARITY_LEDGER = [
  {
    id: "navigation.initial-blank",
    area: "navigation",
    expectation: "A new tile accepts its saved URL instead of remaining on the guest blank page.",
    status: "cozea-adapted",
  },
  {
    id: "navigation.sequential-urls",
    area: "navigation",
    expectation: "The address bar can navigate repeatedly after the first successful load.",
    status: "ported",
  },
  {
    id: "navigation.history-reload-find-zoom-devtools",
    area: "navigation",
    expectation: "History, reload, find, zoom, and developer tools reflect the active guest.",
    status: "cozea-adapted",
  },
  {
    id: "navigation.popup-policy",
    area: "navigation",
    expectation:
      "New-window requests follow the tile navigation policy without escaping isolation.",
    status: "ported",
  },
  {
    id: "http-errors.transport-precedence",
    area: "http-errors",
    expectation: "Transport failures take precedence over HTTP response diagnostics.",
    status: "cozea-adapted",
  },
  {
    id: "http-errors.blank-error-document",
    area: "http-errors",
    expectation:
      "Blank 4xx and 5xx documents surface the response status and optional status text.",
    status: "cozea-adapted",
  },
  {
    id: "http-errors.framework-document",
    area: "http-errors",
    expectation: "Framework-provided error pages and successful blank responses remain visible.",
    status: "cozea-adapted",
  },
  {
    id: "session-isolation.workspace",
    area: "session-isolation",
    expectation: "Workspace browser state is isolated by workspace identity.",
    status: "cozea-adapted",
  },
  {
    id: "session-isolation.ephemeral-release",
    area: "session-isolation",
    expectation:
      "Closing the final tile releases ephemeral guest state without process-lifetime growth.",
    status: "cozea-adapted",
  },
  {
    id: "session-isolation.org-devapp",
    area: "session-isolation",
    expectation:
      "Each Org DevApp publication receives one persistent isolated session and one protocol setup.",
    status: "cozea-adapted",
  },
  {
    id: "preview-features.responsive-viewport",
    area: "preview-features",
    expectation:
      "Fill, freeform, Chrome device presets, rotation, aspect locking, and renderer-local resize rails share one living guest.",
    status: "ported",
  },
  {
    id: "preview-features.capture-recording",
    area: "preview-features",
    expectation:
      "Screenshot capture and screencast recording save artifacts from the visible living guest.",
    status: "ported",
  },
  {
    id: "preview-features.picker-annotation",
    area: "preview-features",
    expectation:
      "T3 picker payloads, screenshot crops, and attach/send intent reach the active Cozea assistant composer unchanged.",
    status: "cozea-adapted",
  },
  {
    id: "preview-features.pip-audio-appearance",
    area: "preview-features",
    expectation:
      "Native picture-in-picture, mute/audible state, color-scheme emulation, zoom, favicon, and pointer presentation track the tab.",
    status: "ported",
  },
  {
    id: "shell.right-panel-routing",
    area: "shell",
    expectation: "T3 right-panel routing is replaced by Dockview tile ownership.",
    status: "shell-inapplicable",
  },
  {
    id: "shell.thread-mini-player",
    area: "shell",
    expectation:
      "T3 thread mini-player routing is shell-only; its browser mirror behavior is covered by native picture-in-picture.",
    status: "shell-inapplicable",
  },
  {
    id: "shell.cross-window-popout",
    area: "shell",
    expectation:
      "Browser-backed panels remain in the main renderer host while same-window drag, split, and float remain available.",
    status: "cozea-adapted",
  },
  {
    id: "automation.loopback-navigation",
    area: "automation",
    expectation:
      "Agent preview navigation accepts loopback HTTP(S) only and normalizes schemeless localhost.",
    status: "pending-t3-port",
  },
  {
    id: "automation.snapshot",
    area: "automation",
    expectation:
      "Snapshots return URL, title, visible text, and bounded interactive-element metadata.",
    status: "pending-t3-port",
  },
  {
    id: "automation.click-type",
    area: "automation",
    expectation:
      "Click and type resolve bounded targets and distinguish missing from non-editable targets.",
    status: "pending-t3-port",
  },
  {
    id: "automation.serialized-input",
    area: "automation",
    expectation: "Selectors and text are serialized as data and cannot inject guest-page scripts.",
    status: "pending-t3-port",
  },
  {
    id: "automation.scroll-wait-bounds",
    area: "automation",
    expectation: "Scroll and wait inputs normalize non-finite values and enforce bounded timeouts.",
    status: "pending-t3-port",
  },
  {
    id: "security.permissions-downloads",
    area: "security",
    expectation:
      "Embedded guests allow only T3's approved permission set and deny unmanaged downloads.",
    status: "cozea-adapted",
  },
  {
    id: "security.external-navigation",
    area: "security",
    expectation: "Top-level public HTTP(S) navigation opens externally only when policy allows it.",
    status: "cozea-adapted",
  },
  {
    id: "security.org-devapp-protocol",
    area: "security",
    expectation:
      "Org DevApp custom-scheme and authenticated loopback URLs remain internal to their isolated session.",
    status: "cozea-adapted",
  },
] as const satisfies readonly BrowserPortParityRequirement[]

export function getBrowserPortParityRequirement(id: string): BrowserPortParityRequirement | null {
  return T3_BROWSER_PORT_PARITY_LEDGER.find((requirement) => requirement.id === id) ?? null
}
