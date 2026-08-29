export interface OrgDevAppRuntimeState {
  contentHash: string
  status: "starting" | "ready" | "failed" | "stopped"
  originUrl: string | null
  error: string | null
  logs: string[]
}
