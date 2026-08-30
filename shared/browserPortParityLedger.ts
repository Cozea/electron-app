export type BrowserPortParityArea =
  | "navigation"
  | "http-errors"
  | "session-isolation"
  | "automation"
  | "security";

export interface BrowserPortParityRequirement {
  id: string;
  area: BrowserPortParityArea;
  expectation: string;
  status: "pending-t3-port";
}

/**
 * Requirements preserved from the removed native browser tests. The T3 port
 * must turn each entry into executable parity coverage before claiming browser
 * availability; recording an entry here is not evidence that it is implemented.
 */
export const T3_BROWSER_PORT_PARITY_LEDGER = [
  {
    id: "navigation.initial-blank",
    area: "navigation",
    expectation: "A new tile accepts its saved URL instead of remaining on the guest blank page.",
    status: "pending-t3-port",
  },
  {
    id: "navigation.sequential-urls",
    area: "navigation",
    expectation: "The address bar can navigate repeatedly after the first successful load.",
    status: "pending-t3-port",
  },
  {
    id: "navigation.history-reload-find-zoom-devtools",
    area: "navigation",
    expectation: "History, reload, find, zoom, and developer tools reflect the active guest.",
    status: "pending-t3-port",
  },
  {
    id: "navigation.popup-policy",
    area: "navigation",
    expectation:
      "New-window requests follow the tile navigation policy without escaping isolation.",
    status: "pending-t3-port",
  },
  {
    id: "http-errors.transport-precedence",
    area: "http-errors",
    expectation: "Transport failures take precedence over HTTP response diagnostics.",
    status: "pending-t3-port",
  },
  {
    id: "http-errors.blank-error-document",
    area: "http-errors",
    expectation:
      "Blank 4xx and 5xx documents surface the response status and optional status text.",
    status: "pending-t3-port",
  },
  {
    id: "http-errors.framework-document",
    area: "http-errors",
    expectation: "Framework-provided error pages and successful blank responses remain visible.",
    status: "pending-t3-port",
  },
  {
    id: "session-isolation.workspace",
    area: "session-isolation",
    expectation: "Workspace browser state is isolated by workspace identity.",
    status: "pending-t3-port",
  },
  {
    id: "session-isolation.ephemeral-release",
    area: "session-isolation",
    expectation:
      "Closing the final tile releases ephemeral guest state without process-lifetime growth.",
    status: "pending-t3-port",
  },
  {
    id: "session-isolation.org-devapp",
    area: "session-isolation",
    expectation:
      "Each Org DevApp publication receives one persistent isolated session and one protocol setup.",
    status: "pending-t3-port",
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
    expectation: "Embedded guests deny browser permissions and downloads by default.",
    status: "pending-t3-port",
  },
  {
    id: "security.external-navigation",
    area: "security",
    expectation: "Top-level public HTTP(S) navigation opens externally only when policy allows it.",
    status: "pending-t3-port",
  },
  {
    id: "security.org-devapp-protocol",
    area: "security",
    expectation:
      "Org DevApp custom-scheme and authenticated loopback URLs remain internal to their isolated session.",
    status: "pending-t3-port",
  },
] as const satisfies readonly BrowserPortParityRequirement[];

export function getBrowserPortParityRequirement(id: string): BrowserPortParityRequirement | null {
  return T3_BROWSER_PORT_PARITY_LEDGER.find((requirement) => requirement.id === id) ?? null;
}
