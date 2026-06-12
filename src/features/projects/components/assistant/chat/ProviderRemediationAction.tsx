import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ensureNativeApi } from "@/lib/nativeApi"
import type { AgentToolId } from "@shared/electronApiTypes"

type RemediationKind = "install" | "login"

interface ProviderRemediation {
  kind: RemediationKind
  toolId: AgentToolId
  label: string
}

const PROVIDER_TOOL_IDS: Record<string, AgentToolId> = {
  claudeAgent: "claude",
  codex: "codex",
  gemini: "gemini",
  cursor: "cursor",
  opencode: "opencode",
}

const TOOL_LABELS: Record<string, string> = {
  claude: "Claude Code CLI",
  codex: "Codex CLI",
  gemini: "Gemini CLI",
  cursor: "Cursor Agent CLI",
  opencode: "OpenCode CLI",
}

/** Tools with an automated browser login flow (fixed argv in the main
 * process); install works for any tool with a known package/installer. */
const LOGIN_LABELS: Partial<Record<AgentToolId, string>> = {
  claude: "Run claude auth login",
  codex: "Run codex login",
  cursor: "Run agent login",
}

export function resolveProviderRemediation(
  provider: string | null | undefined,
  message: string | null | undefined,
): ProviderRemediation | null {
  if (!provider || !message) return null
  const toolId = PROVIDER_TOOL_IDS[provider]
  if (!toolId) return null

  if (/not installed|not on PATH/i.test(message)) {
    return { kind: "install", toolId, label: `Install ${TOOL_LABELS[toolId] ?? toolId}` }
  }
  const loginLabel = LOGIN_LABELS[toolId]
  if (loginLabel && /not authenticated|login required|log ?in and try again/i.test(message)) {
    return { kind: "login", toolId, label: loginLabel }
  }
  return null
}

type RunState =
  | { phase: "idle" }
  | { phase: "running"; sessionId?: string; awaitingCode?: string }
  | { phase: "done" }
  | { phase: "failed"; error: string }

/** Re-probe provider availability so tiles pick the fix up immediately. */
async function refreshProviderAvailability(): Promise<void> {
  try {
    await ensureNativeApi().server.refreshProviders()
  } catch {
    // The periodic snapshot refresh will still converge.
  }
}

/**
 * One-click fix for "CLI not installed" / "not authenticated" provider
 * errors: runs the headless install (login shell) or the CLI's own browser
 * login flow through the main process — no terminal needed. Device-code
 * login flows surface an inline code field wired to the CLI's stdin.
 */
export function ProviderRemediationAction(props: {
  provider: string | null | undefined
  message: string | null | undefined
  /** Called after a successful run so the host can re-probe/retry. */
  onResolved?: () => void
}) {
  const remediation = resolveProviderRemediation(props.provider, props.message)
  const [runState, setRunState] = useState<RunState>({ phase: "idle" })
  const [codeDraft, setCodeDraft] = useState("")
  const mountedRef = useRef(true)
  const runStateRef = useRef(runState)
  runStateRef.current = runState

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      const current = runStateRef.current
      if (current.phase === "running" && current.sessionId) {
        void window.electronAPI.agentTools.loginCancel({ sessionId: current.sessionId })
      }
    }
  }, [])

  // New message/provider: a previous outcome no longer applies.
  const remediationKey = remediation ? `${remediation.kind}:${remediation.toolId}` : null
  const lastKeyRef = useRef(remediationKey)
  useEffect(() => {
    if (lastKeyRef.current !== remediationKey) {
      lastKeyRef.current = remediationKey
      setRunState({ phase: "idle" })
      setCodeDraft("")
    }
  }, [remediationKey])

  if (!remediation) return null

  const finish = (next: RunState) => {
    if (!mountedRef.current) return
    setRunState(next)
    if (next.phase === "done") {
      void refreshProviderAvailability()
      props.onResolved?.()
    }
  }

  const runInstall = async () => {
    setRunState({ phase: "running" })
    try {
      const result = await window.electronAPI.agentTools.prepare({ toolId: remediation.toolId })
      finish(result.success ? { phase: "done" } : { phase: "failed", error: result.error ?? "Install failed" })
    } catch (error) {
      finish({ phase: "failed", error: error instanceof Error ? error.message : "Install failed" })
    }
  }

  const runLogin = async () => {
    setRunState({ phase: "running" })
    try {
      const start = await window.electronAPI.agentTools.loginStart({ toolId: remediation.toolId })
      if (!start.sessionId) {
        finish({ phase: "failed", error: start.error ?? "Login failed to start" })
        return
      }
      const sessionId = start.sessionId
      setRunState({ phase: "running", sessionId })

      const unsubscribe = window.electronAPI.agentTools.onLoginEvent((event) => {
        if (event.sessionId !== sessionId) return
        if (event.type === "awaiting-code") {
          if (mountedRef.current) {
            setRunState({ phase: "running", sessionId, awaitingCode: event.data ?? "Enter the code from your browser" })
          }
          return
        }
        if (event.type === "closed") {
          unsubscribe()
          finish(
            event.success
              ? { phase: "done" }
              : { phase: "failed", error: event.error ?? "Login failed" },
          )
        }
      })
    } catch (error) {
      finish({ phase: "failed", error: error instanceof Error ? error.message : "Login failed" })
    }
  }

  const submitCode = () => {
    if (runState.phase !== "running" || !runState.sessionId) return
    const value = codeDraft.trim()
    if (!value) return
    void window.electronAPI.agentTools.loginInput({ sessionId: runState.sessionId, value })
    setCodeDraft("")
    setRunState({ phase: "running", sessionId: runState.sessionId })
  }

  if (runState.phase === "done") {
    return <span className="shrink-0 text-xs text-success">Done — try again.</span>
  }

  if (runState.phase === "running" && runState.awaitingCode) {
    return (
      <span className="flex shrink-0 items-center gap-1.5" title={runState.awaitingCode}>
        <Input
          value={codeDraft}
          onChange={(event) => setCodeDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              submitCode()
            }
          }}
          placeholder="Paste code"
          className="h-6 w-32 px-2 text-xs sm:h-6"
          autoFocus
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-6 shrink-0 px-2 text-xs sm:h-6"
          disabled={!codeDraft.trim()}
          onClick={submitCode}
        >
          Submit
        </Button>
      </span>
    )
  }

  return (
    <span className="flex shrink-0 items-center gap-2">
      {runState.phase === "failed" ? (
        <span className="max-w-56 truncate text-xs opacity-80" title={runState.error}>
          {runState.error}
        </span>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-6 shrink-0 px-2 text-xs sm:h-6"
        disabled={runState.phase === "running"}
        onClick={() => {
          void (remediation.kind === "install" ? runInstall() : runLogin())
        }}
      >
        {runState.phase === "running" ? (
          <span className="flex items-center gap-1.5">
            <span className="loader" />
            {remediation.kind === "install" ? "Installing…" : "Waiting for browser login…"}
          </span>
        ) : runState.phase === "failed" ? (
          "Retry"
        ) : (
          remediation.label
        )}
      </Button>
    </span>
  )
}
