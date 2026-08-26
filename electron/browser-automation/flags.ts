/**
 * Agent browser automation feature flag.
 *
 * Flag name: `cozea.browser.agentAutomation` (Track C / Wave 0).
 * Default: off. Enable with env `COZEA_BROWSER_AGENT_AUTOMATION=1|true|on|yes`.
 */

function parseBooleanFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback
  const normalized = raw.trim().toLowerCase()
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false
  }
  return fallback
}

/** Canonical flag id from the T3 implementation plan. */
export const COZEA_BROWSER_AGENT_AUTOMATION_FLAG = "cozea.browser.agentAutomation" as const

export interface BrowserAutomationFlags {
  readonly enabled: boolean
}

export function readBrowserAutomationFlags(
  env: NodeJS.ProcessEnv = process.env,
): BrowserAutomationFlags {
  return {
    enabled: parseBooleanFlag(env.COZEA_BROWSER_AGENT_AUTOMATION, false),
  }
}

export function isBrowserAgentAutomationEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return readBrowserAutomationFlags(env).enabled
}
