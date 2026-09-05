import { useSettingsDrawerStore } from "@/features/settings/model/settingsDrawerStore"
import { CheckmarkCircle02Icon, Copy01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard"
import { ensureNativeApi } from "@/lib/nativeApi"
import type { AgentToolId } from "@shared/electronApiTypes"
import {
  isProviderRemediationResolved,
  markProviderRemediationResolved,
} from "./providerRemediationResolutionStore"

interface InstallRemediation {
  kind: "install"
  toolId: AgentToolId
  label: string
}

interface LoginRemediation {
  kind: "login"
  toolId: AgentToolId
  providerName: string
  command: string
  nextStep: string
  canStartInCozea: boolean
}

export type ProviderRemediation = InstallRemediation | LoginRemediation

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

/**
 * Exact terminal entry points for each supported agent. Cozea can also start
 * the three browser-login flows already exposed by the native bridge.
 */
const LOGIN_INSTRUCTIONS: Partial<
  Record<AgentToolId, Omit<LoginRemediation, "kind" | "toolId">>
> = {
  claude: {
    providerName: "Claude",
    command: "claude auth login",
    nextStep: "Complete the Anthropic sign-in in your browser, then return to Cozea.",
    canStartInCozea: true,
  },
  codex: {
    providerName: "Codex",
    command: "codex login",
    nextStep: "Complete the OpenAI sign-in in your browser, then return to Cozea.",
    canStartInCozea: true,
  },
  cursor: {
    providerName: "Cursor",
    command: "agent login",
    nextStep: "Complete the Cursor sign-in in your browser, then return to Cozea.",
    canStartInCozea: true,
  },
  opencode: {
    providerName: "OpenCode",
    command: "opencode auth login",
    nextStep: "Choose a provider and complete its authentication flow, then return to Cozea.",
    canStartInCozea: false,
  },
  gemini: {
    providerName: "Gemini",
    command: "gemini",
    nextStep: 'Select “Sign in with Google,” finish in your browser, then return to Cozea.',
    canStartInCozea: false,
  },
}

export function resolveProviderRemediation(
  provider: string | null | undefined,
  message: string | null | undefined,
  authenticationRequired = false,
): ProviderRemediation | null {
  if (!provider || (!message && !authenticationRequired)) return null
  const toolId = PROVIDER_TOOL_IDS[provider]
  if (!toolId) return null

  if (message && /not installed|not on PATH/i.test(message)) {
    return { kind: "install", toolId, label: `Install ${TOOL_LABELS[toolId] ?? toolId}` }
  }
  const loginInstructions = LOGIN_INSTRUCTIONS[toolId]
  const messageRequiresLogin =
    /not authenticated|unauthenticated|not logged in|authentication required|login required|log ?in and try again|sign ?in required|please (?:log|sign) ?in|(?:please\s+)?run\s+\/login\b/i.test(
      message ?? "",
    )
  if (loginInstructions && (authenticationRequired || messageRequiresLogin)) {
    return { kind: "login", toolId, ...loginInstructions }
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
 * Actionable help for "CLI not installed" / "not authenticated" provider
 * errors. Authentication states always show the exact terminal command, and
 * native-supported tools retain their one-click browser login flow.
 */
export function ProviderRemediationAction(props: {
  provider: string | null | undefined
  message: string | null | undefined
  authenticationRequired?: boolean
  /** Keeps a successful UI result stable when virtualized content remounts. */
  persistenceKey?: string
  /** Called after a successful run so the host can re-probe/retry. */
  onResolved?: () => void
}) {
  const remediation = resolveProviderRemediation(
    props.provider,
    props.message,
    props.authenticationRequired,
  )
  const [runState, setRunState] = useState<RunState>(() =>
    isProviderRemediationResolved(props.persistenceKey) ? { phase: "done" } : { phase: "idle" },
  )
  const [codeDraft, setCodeDraft] = useState("")
  const { copyToClipboard, isCopied } = useCopyToClipboard()
  const mountedRef = useRef(true)
  const runStateRef = useRef(runState)
  runStateRef.current = runState
  const loginUnsubscribeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      // Tear down the login-event listener on unmount so it doesn't leak if
      // we never receive a 'closed' event (e.g. unmounted mid-login, or the
      // CLI ignores SIGTERM and never closes).
      loginUnsubscribeRef.current?.()
      loginUnsubscribeRef.current = null
      const current = runStateRef.current
      if (current.phase === "running" && current.sessionId) {
        void window.electronAPI.agentTools.loginCancel({ sessionId: current.sessionId })
      }
    }
  }, [])

  // New message/provider: a previous outcome no longer applies.
  const remediationKey = remediation
    ? `${remediation.kind}:${remediation.toolId}:${props.persistenceKey ?? "transient"}`
    : null
  const lastKeyRef = useRef(remediationKey)
  useEffect(() => {
    if (lastKeyRef.current !== remediationKey) {
      lastKeyRef.current = remediationKey
      setRunState(
        isProviderRemediationResolved(props.persistenceKey)
          ? { phase: "done" }
          : { phase: "idle" },
      )
      setCodeDraft("")
    }
  }, [props.persistenceKey, remediationKey])

  if (props.provider === "antigravity") return <Button size="sm" variant="outline" onClick={() => useSettingsDrawerStore.getState().open("tooling")}>Set up Antigravity</Button>

  if (!remediation) return null

  const finish = (next: RunState) => {
    if (!mountedRef.current) return
    if (next.phase === "done") {
      markProviderRemediationResolved(props.persistenceKey)
    }
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

      // Drop any listener left over from a prior login attempt before
      // registering a new one.
      loginUnsubscribeRef.current?.()
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
          loginUnsubscribeRef.current = null
          finish(
            event.success
              ? { phase: "done" }
              : { phase: "failed", error: event.error ?? "Login failed" },
          )
        }
      })
      loginUnsubscribeRef.current = unsubscribe
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
    return (
      <span className="shrink-0 text-xs text-success">
        {remediation.kind === "login" ? "Signed in successfully." : "Done — try again."}
      </span>
    )
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

  if (remediation.kind === "login") {
    return (
      <div className="w-full max-w-md space-y-2.5 text-left">
        <p className="text-xs leading-5 text-muted-foreground">
          Open Terminal, paste this command, and complete the sign-in flow.
        </p>
        <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-background/70 p-1.5 pl-3">
          <code className="min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap font-mono text-xs text-foreground">
            {remediation.command}
          </code>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 shrink-0 gap-1.5 px-2 text-xs sm:h-7"
            onClick={() => copyToClipboard(remediation.command)}
            aria-label={isCopied ? "Command copied" : "Copy login command"}
          >
            <HugeiconsIcon
              icon={isCopied ? CheckmarkCircle02Icon : Copy01Icon}
              className={isCopied ? "size-3.5 text-success" : "size-3.5"}
            />
            {isCopied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="text-[11px] leading-4 text-muted-foreground">{remediation.nextStep}</p>
        {runState.phase === "failed" ? (
          <p className="text-xs text-destructive" role="alert">
            {runState.error}
          </p>
        ) : null}
        {remediation.canStartInCozea ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2.5 text-xs sm:h-7"
            disabled={runState.phase === "running"}
            onClick={() => void runLogin()}
          >
            {runState.phase === "running" ? (
              <span className="flex items-center gap-1.5">
                <span className="loader" />
                Waiting for browser login…
              </span>
            ) : runState.phase === "failed" ? (
              "Retry login in Cozea"
            ) : (
              "Start login in Cozea"
            )}
          </Button>
        ) : null}
      </div>
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
          void runInstall()
        }}
      >
        {runState.phase === "running" ? (
          <span className="flex items-center gap-1.5">
            <span className="loader" />
            Installing…
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

/**
 * Inline recovery for providers that report missing authentication as a
 * regular assistant reply instead of a provider or thread error state.
 */
export function ProviderAuthenticationHelp(props: {
  provider: string | null | undefined
  message: string | null | undefined
  messageId?: string
  isStreaming?: boolean
  isSuperseded?: boolean
}) {
  const remediation = resolveProviderRemediation(props.provider, props.message)
  if (props.isStreaming || props.isSuperseded || remediation?.kind !== "login") return null

  return (
    <ProviderAuthenticationHelpContent
      provider={props.provider}
      message={props.message}
      messageId={props.messageId}
      remediation={remediation}
    />
  )
}

function ProviderAuthenticationHelpContent(props: {
  provider: string | null | undefined
  message: string | null | undefined
  messageId?: string
  remediation: LoginRemediation
}) {
  const persistenceKey = props.messageId
    ? `${props.remediation.toolId}:${props.messageId}`
    : undefined
  const [isResolved, setIsResolved] = useState(() =>
    isProviderRemediationResolved(persistenceKey),
  )

  useEffect(() => {
    setIsResolved(isProviderRemediationResolved(persistenceKey))
  }, [persistenceKey])

  return (
    <section
      className="mt-3 w-full max-w-md rounded-xl bg-secondary/55 px-3 py-3 text-left"
      aria-label={`${isResolved ? "Signed in to" : "Sign in to"} ${props.remediation.providerName}`}
    >
      <h3 className="mb-1 text-xs font-medium text-foreground">
        {isResolved ? "Signed in to" : "Sign in to"} {props.remediation.providerName}
      </h3>
      <ProviderRemediationAction
        provider={props.provider}
        message={props.message}
        persistenceKey={persistenceKey}
        onResolved={() => setIsResolved(true)}
      />
    </section>
  )
}
