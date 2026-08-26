import { describe, expect, it } from "vitest"

import {
  COZEA_BROWSER_AGENT_AUTOMATION_FLAG,
  isBrowserAgentAutomationEnabled,
  readBrowserAutomationFlags,
} from "../../../electron/browser-automation/flags"

describe("browser automation flags", () => {
  it("defaults to off", () => {
    expect(readBrowserAutomationFlags({}).enabled).toBe(false)
    expect(isBrowserAgentAutomationEnabled({})).toBe(false)
  })

  it("enables on truthy COZEA_BROWSER_AGENT_AUTOMATION values", () => {
    for (const value of ["1", "true", "TRUE", "on", "yes"]) {
      expect(readBrowserAutomationFlags({ COZEA_BROWSER_AGENT_AUTOMATION: value }).enabled).toBe(
        true,
      )
    }
  })

  it("stays off on falsy values", () => {
    for (const value of ["0", "false", "off", "no", ""]) {
      expect(readBrowserAutomationFlags({ COZEA_BROWSER_AGENT_AUTOMATION: value }).enabled).toBe(
        false,
      )
    }
  })

  it("exposes the canonical flag id", () => {
    expect(COZEA_BROWSER_AGENT_AUTOMATION_FLAG).toBe("cozea.browser.agentAutomation")
  })
})
