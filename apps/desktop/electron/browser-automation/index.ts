export {
  COZEA_BROWSER_AGENT_AUTOMATION_FLAG,
  isBrowserAgentAutomationEnabled,
  readBrowserAutomationFlags,
} from "./flags"
export {
  BrowserAutomationAdapter,
  createBrowserAutomationHostFromWorkbench,
  type BrowserAutomationHost,
  type BrowserAutomationHostTileState,
} from "./BrowserAutomationAdapter"
export {
  evaluateAutomationNavigateUrl,
  isLoopbackHostname,
  normalizeAutomationUrlInput,
} from "./urlPolicy"
export {
  buildClickScript,
  buildSnapshotScript,
  buildTypeScript,
} from "./pageScripts"
