import { useState, useEffect, useCallback, useRef } from "react"
import { Play, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useProjectPagesStore } from "@/stores/useProjectPagesStore"
import { useTerminalActions, useTerminalStore } from "@/stores/useTerminalStore"
import type { DevCommandSuggestion, PreviewFailureReason } from "@shared/electronApiTypes"
import {
    getDevServerConfig,
    detectPackageManager,
    getInstallCommand,
    checkDependenciesInstalled,
    hasPackageJson,
} from "@/utils/projectDetector"
import { useProblemsStore, type ProblemSeverity } from "@/stores/useProblemsStore"
import { DevCommandPickerDialog } from "./DevCommandPickerDialog"

const stripAnsi = (input: string) =>
    // eslint-disable-next-line no-control-regex
    input.replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '')

const FILE_LOCATION_PATTERN = /(?:File:\s*)?((?:[A-Za-z]:)?[^:\s]+?\.(?:tsx?|jsx?|vue|svelte|astro|css|scss|less|styl|mdx|json|html|yml|yaml)):(\d+)(?::(\d+))?/i

const normalizeFilePath = (rawPath: string) => {
    const trimmed = rawPath.replace(/^file:\/\//i, '')
    return trimmed.replace(/\\/g, '/')
}

const toSeverity = (line: string): ProblemSeverity | null => {
    if (/warning/i.test(line)) return 'warning'
    if (/error/i.test(line)) return 'error'
    return null
}

const isProblemHeader = (line: string) =>
    /internal server error/i.test(line) ||
    /failed to compile/i.test(line) ||
    /error:\s/i.test(line)

const formatTerminalTabTitle = (label: string) => label
const MAX_PORT_SCAN_ATTEMPTS = 20

const getPersistedDevCommand = (projectPath: string): string | null => {
    const key = `dev-command:${encodeURIComponent(projectPath)}`
    const raw = localStorage.getItem(key)
    return raw?.trim() || null
}

const persistDevCommand = (projectPath: string, command: string) => {
    const key = `dev-command:${encodeURIComponent(projectPath)}`
    localStorage.setItem(key, command.trim())
}

const isWindowsClient = (): boolean => {
    if (typeof navigator === 'undefined') return false
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
    const platformHint = nav.userAgentData?.platform || navigator.platform || navigator.userAgent
    return /win/i.test(platformHint)
}

interface AutoStartState {
    hasAttempted: boolean
    suppressed: boolean
}

const autoStartStateByProjectPath = new Map<string, AutoStartState>()

function getAutoStartState(projectPath: string): AutoStartState {
    const existing = autoStartStateByProjectPath.get(projectPath)
    if (existing) {
        return existing
    }

    const created: AutoStartState = {
        hasAttempted: false,
        suppressed: false,
    }
    autoStartStateByProjectPath.set(projectPath, created)
    return created
}

interface ServerControlProps {
    projectPath?: string | null
    // Optional stored framework info from Convex (uses detection as fallback)
    storedDevCommand?: string | null
    storedDevPort?: number | null
}

export function ServerControl({ projectPath, storedDevCommand, storedDevPort }: ServerControlProps) {
    const { serverStatus, actions } = useProjectPagesStore()
    const { addTerminal, removeTerminal, updateTerminalDisplay, updateTerminalStatus, setPanelOpen } = useTerminalActions()
    const terminals = useTerminalStore((state) => state.terminals)
    const addRuntimeProblem = useProblemsStore((state) => state.actions.addRuntimeProblem)
    const clearProblemsBySource = useProblemsStore((state) => state.actions.clearProblemsBySource)
    const [isUpdating, setIsUpdating] = useState(false)
    const [showCommandPicker, setShowCommandPicker] = useState(false)
    const [commandSuggestions, setCommandSuggestions] = useState<DevCommandSuggestion[]>([])
    const [commandPickerDefault, setCommandPickerDefault] = useState<string | undefined>(undefined)
    const pendingCommandSelectionRef = useRef<{ label: string; port: number } | null>(null)

    // Track the dev server terminal ID
    const devServerTerminalIdRef = useRef<string | null>(null)
    const devServerProjectPathRef = useRef<string | null>(null)
    const devServerLabelRef = useRef<string>('Dev Server')
    const devServerRunIdRef = useRef<string | null>(null)
    const pendingReadyProbeKeyRef = useRef<string | null>(null)
    const cancelledStartRunIdsRef = useRef<Set<string>>(new Set())

    // Ref for startup watchdog when ready patterns/probes don't confirm in time
    const readyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const pendingProblemRef = useRef<{ message: string; severity: ProblemSeverity } | null>(null)
    const previousProjectPathRef = useRef<string | null>(projectPath ?? null)

    // Clear the ready timeout
    const clearReadyTimeout = useCallback(() => {
        if (readyTimeoutRef.current) {
            clearTimeout(readyTimeoutRef.current)
            readyTimeoutRef.current = null
        }
    }, [])

    const createRunId = useCallback((): string => {
        if (crypto?.randomUUID) return crypto.randomUUID()
        return `pages-devsrv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    }, [])

    const addTimelineEvent = useCallback((event: {
        runId?: string | null
        type: 'start_requested' | 'start_succeeded' | 'start_failed' | 'output' | 'ready_detected' | 'probe_succeeded' | 'probe_failed' | 'stopped' | 'exited'
        message: string
        details?: Record<string, unknown>
    }) => {
        actions.addPreviewTimelineEvent({
            category: 'dev-server',
            runId: event.runId ?? devServerRunIdRef.current,
            type: event.type,
            message: event.message,
            details: event.details,
        })
    }, [actions])

    const markRunUnhealthy = useCallback((
        reason: string,
        failureReason: PreviewFailureReason = 'server_unreachable',
        runId?: string | null
    ) => {
        const currentRunId = runId ?? devServerRunIdRef.current
        actions.setServerStatus('unhealthy')
        actions.setServerLifecycle({
            runId: currentRunId ?? null,
            state: 'unhealthy',
            unhealthyReason: reason,
        })
        actions.setPreviewReadiness({
            runId: currentRunId ?? null,
            reachable: false,
            lastCheckedAt: Date.now(),
            lastFailureReason: failureReason,
            lastFailureMessage: reason,
        })
        addTimelineEvent({
            runId: currentRunId,
            type: 'probe_failed',
            message: reason,
            details: { failureReason },
        })
    }, [actions, addTimelineEvent])

    const waitForServerPortReachability = useCallback(async (
        runId: string,
        port: number,
        source: 'launch' | 'port-detected'
    ) => {
        if (!projectPath) return
        if (devServerRunIdRef.current !== runId) return

        const probeKey = `${runId}:${port}`
        if (pendingReadyProbeKeyRef.current === probeKey) {
            return
        }
        pendingReadyProbeKeyRef.current = probeKey

        try {
            const startedAt = Date.now()
            while (Date.now() - startedAt <= 60_000) {
                if (devServerRunIdRef.current !== runId) {
                    return
                }
                if (pendingReadyProbeKeyRef.current !== probeKey) {
                    return
                }

                const probe = await window.electronAPI.preview.probePort({
                    port,
                    timeoutMs: 1000,
                })

                if (devServerRunIdRef.current !== runId) {
                    return
                }
                if (pendingReadyProbeKeyRef.current !== probeKey) {
                    return
                }

                if (probe.success && probe.reachable) {
                    actions.setServerStatus('running')
                    actions.setServerLifecycle({
                        runId,
                        state: 'ready',
                        readyAt: Date.now(),
                        lastOutputAt: Date.now(),
                        unhealthyReason: null,
                    })
                    actions.setPreviewReadiness({
                        runId,
                        reachable: true,
                        lastCheckedAt: Date.now(),
                        lastFailureReason: null,
                        lastFailureMessage: null,
                    })
                    if (devServerTerminalIdRef.current) {
                        updateTerminalStatus(devServerTerminalIdRef.current, 'running')
                        updateTerminalDisplay(devServerTerminalIdRef.current, {
                            phase: 'active',
                            lastHeartbeatAt: Date.now(),
                        })
                    }
                    addTimelineEvent({
                        runId,
                        type: 'probe_succeeded',
                        message: `Dev server port reachable at localhost:${port}`,
                        details: {
                            source,
                            elapsedMs: probe.elapsedMs,
                        },
                    })
                    clearReadyTimeout()
                    pendingReadyProbeKeyRef.current = null
                    return
                }

                await new Promise((resolve) => setTimeout(resolve, 400))
            }
        } catch (error) {
            if (devServerRunIdRef.current !== runId) {
                return
            }
            addTimelineEvent({
                runId,
                type: 'probe_failed',
                message: error instanceof Error ? error.message : 'Dev server port probe failed',
                details: {
                    source,
                },
            })
        } finally {
            if (pendingReadyProbeKeyRef.current === probeKey) {
                pendingReadyProbeKeyRef.current = null
            }
        }
    }, [actions, addTimelineEvent, clearReadyTimeout, projectPath, updateTerminalDisplay, updateTerminalStatus])

    const isStartCancelled = useCallback((runId: string) => {
        return cancelledStartRunIdsRef.current.has(runId)
    }, [])

    const findAvailableLaunchPort = useCallback(async (preferredPort: number, runId: string): Promise<number> => {
        let candidatePort = preferredPort

        for (let attempt = 0; attempt < MAX_PORT_SCAN_ATTEMPTS; attempt += 1) {
            if (isStartCancelled(runId)) {
                throw new Error('Dev server start cancelled')
            }

            const probe = await window.electronAPI.preview.probePort({
                port: candidatePort,
                timeoutMs: 250,
            })

            if (!probe.reachable) {
                if (candidatePort !== preferredPort) {
                    actions.addServerOutput(
                        `[DevServer] Port ${preferredPort} is busy. Using ${candidatePort} instead.\n`
                    )
                    addTimelineEvent({
                        runId,
                        type: 'output',
                        message: `Port ${preferredPort} busy; switched to ${candidatePort}`,
                        details: {
                            preferredPort,
                            selectedPort: candidatePort,
                        },
                    })
                }
                return candidatePort
            }

            candidatePort += 1
        }

        throw new Error(`No available port found starting from ${preferredPort}`)
    }, [actions, addTimelineEvent, isStartCancelled])

    const reportProblemsFromOutput = useCallback((data: string) => {
        if (!projectPath) return
        const cleaned = stripAnsi(data)
        const lines = cleaned.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)

        for (const line of lines) {
            // Vite indicates successful build/rebuild or HMR updates with these phrases.
            // When we see these, we clear existing build errors.
            if (/built in \d+(?:ms|s)|hmr update|page reload/i.test(line)) {
                clearProblemsBySource(projectPath, 'build')
            }

            const severity = toSeverity(line)
            if (isProblemHeader(line)) {
                pendingProblemRef.current = {
                    message: line,
                    severity: severity ?? 'error',
                }
            }

            const match = line.match(FILE_LOCATION_PATTERN)
            if (match) {
                const filePath = normalizeFilePath(match[1])
                const lineNumber = match[2] ? Number(match[2]) : undefined
                const columnNumber = match[3] ? Number(match[3]) : undefined
                const pending = pendingProblemRef.current
                addRuntimeProblem(projectPath, {
                    message: pending?.message || line,
                    severity: pending?.severity || severity || 'error',
                    source: 'build',
                    file: filePath,
                    line: Number.isFinite(lineNumber) ? lineNumber : undefined,
                    column: Number.isFinite(columnNumber) ? columnNumber : undefined,
                })
                pendingProblemRef.current = null
                continue
            }

            if (severity && /error|warning/i.test(line)) {
                addRuntimeProblem(projectPath, {
                    message: line,
                    severity,
                    source: 'build',
                })
            }
        }
    }, [addRuntimeProblem, clearProblemsBySource, projectPath])

    // Stop the previous project's dev server only when project path changes while mounted.
    useEffect(() => {
        const previousProjectPath = previousProjectPathRef.current
        const nextProjectPath = projectPath ?? null

        if (
            previousProjectPath &&
            nextProjectPath &&
            previousProjectPath !== nextProjectPath &&
            devServerTerminalIdRef.current &&
            devServerProjectPathRef.current === previousProjectPath
        ) {
            void window.electronAPI.terminal.kill({ terminalId: devServerTerminalIdRef.current })
            removeTerminal(devServerTerminalIdRef.current)
            devServerTerminalIdRef.current = null
            devServerProjectPathRef.current = null
            devServerRunIdRef.current = null
            pendingReadyProbeKeyRef.current = null
            actions.resetPreviewReadiness()
        }

        previousProjectPathRef.current = nextProjectPath
    }, [actions, projectPath, removeTerminal])

    // Do not kill dev server on route unmount; keep it alive until explicit stop or project switch.
    useEffect(() => {
        return () => {
            clearReadyTimeout()
            pendingReadyProbeKeyRef.current = null
        }
    }, [clearReadyTimeout])

    // Re-bind to an existing running dev-server terminal when returning to the Pages view.
    useEffect(() => {
        if (!projectPath) return

        let cancelled = false

        void (async () => {
            const liveTerminalIds = new Set(await window.electronAPI.terminal.list({ projectPath }))
            if (cancelled) return

            const currentTerminalId = devServerTerminalIdRef.current
            if (currentTerminalId) {
                const current = terminals[currentTerminalId]
                if (current && liveTerminalIds.has(currentTerminalId)) {
                    return
                }

                devServerTerminalIdRef.current = null
                devServerProjectPathRef.current = null
                devServerRunIdRef.current = null
                actions.setServerStatus('stopped')
                actions.setServerPort(null)
                actions.setServerPid(null)
                actions.setServerLifecycle({
                    runId: null,
                    state: 'stopped',
                    stoppedAt: Date.now(),
                    unhealthyReason: null,
                })
                actions.resetPreviewReadiness()
            }

            const existingDevTerminal = Object.values(terminals).find((terminal) =>
                terminal.kind === 'dev-server' &&
                terminal.projectPath === projectPath &&
                terminal.status !== 'exited' &&
                liveTerminalIds.has(terminal.id)
            )

            if (!existingDevTerminal) {
                // Reconcile stale page-store state after route switches/reloads:
                // if no live dev-server terminal exists for this project, preview
                // must not keep rendering localhost URLs with an old port.
                const snapshot = useProjectPagesStore.getState()
                if (
                    snapshot.serverStatus !== 'stopped' ||
                    snapshot.serverPort !== null ||
                    snapshot.serverPid !== null
                ) {
                    actions.setServerStatus('stopped')
                    actions.setServerPort(null)
                    actions.setServerPid(null)
                    actions.setServerLifecycle({
                        runId: null,
                        state: 'stopped',
                        stoppedAt: Date.now(),
                        unhealthyReason: null,
                    })
                    actions.resetPreviewReadiness()
                }
                return
            }

            devServerTerminalIdRef.current = existingDevTerminal.id
            devServerProjectPathRef.current = projectPath
            devServerLabelRef.current = existingDevTerminal.label || existingDevTerminal.profileName || 'Dev Server'
            devServerRunIdRef.current = existingDevTerminal.runId ?? null

            if (typeof existingDevTerminal.port === 'number') {
                actions.setServerPort(existingDevTerminal.port)
            }

            if (existingDevTerminal.status === 'error') {
                actions.setServerStatus('error')
                actions.setServerLifecycle({
                    runId: devServerRunIdRef.current,
                    state: 'error',
                    unhealthyReason: 'Dev server terminal reported an error state',
                })
                return
            }

            if (existingDevTerminal.status === 'starting') {
                actions.setServerStatus('starting')
                actions.setServerLifecycle({
                    runId: devServerRunIdRef.current,
                    state: 'starting',
                    command: existingDevTerminal.command ?? null,
                })
                if (typeof existingDevTerminal.port === 'number' && devServerRunIdRef.current) {
                    void waitForServerPortReachability(devServerRunIdRef.current, existingDevTerminal.port, 'port-detected')
                }
                return
            }

            actions.setServerStatus('running')
            actions.setServerLifecycle({
                runId: devServerRunIdRef.current,
                state: 'ready',
                command: existingDevTerminal.command ?? null,
                readyAt: Date.now(),
            })
            if (typeof existingDevTerminal.port === 'number' && devServerRunIdRef.current) {
                void waitForServerPortReachability(devServerRunIdRef.current, existingDevTerminal.port, 'port-detected')
            }
        })().catch((error) => {
            console.error('[ServerControl] Failed to re-bind dev server terminal:', error)
        })

        return () => {
            cancelled = true
        }
    }, [actions, projectPath, terminals, waitForServerPortReachability])

    // Subscribe to terminal events for log output and process exit only.
    useEffect(() => {
        // Handle output from terminal for display and problem extraction.
        const unsubOutput = window.electronAPI.terminal.onOutput(({ terminalId, data, runId }) => {
            if (terminalId === devServerTerminalIdRef.current) {
                if (runId && devServerRunIdRef.current && runId !== devServerRunIdRef.current) {
                    return
                }

                if (runId && !devServerRunIdRef.current) {
                    devServerRunIdRef.current = runId
                }

                const activeRunId = devServerRunIdRef.current
                actions.setServerLifecycle({
                    runId: activeRunId,
                    lastOutputAt: Date.now(),
                })

                // Forward output to store so DevServerPanel can display it
                actions.addServerOutput(data)
                reportProblemsFromOutput(data)
                addTimelineEvent({
                    runId: activeRunId,
                    type: 'output',
                    message: 'Received dev server output',
                })
            }
        })

        // Handle terminal exit
        const unsubExit = window.electronAPI.terminal.onExit(({ terminalId, runId }) => {
            if (terminalId === devServerTerminalIdRef.current) {
                if (runId && devServerRunIdRef.current && runId !== devServerRunIdRef.current) {
                    return
                }

                const activeRunId = devServerRunIdRef.current
                actions.setServerStatus('stopped')
                actions.setServerPort(null)
                actions.setServerPid(null)
                actions.setServerLifecycle({
                    runId: activeRunId,
                    state: 'stopped',
                    stoppedAt: Date.now(),
                    unhealthyReason: null,
                })
                actions.resetPreviewReadiness()
                devServerTerminalIdRef.current = null
                devServerProjectPathRef.current = null
                devServerRunIdRef.current = null
                clearReadyTimeout()
                addTimelineEvent({
                    runId: activeRunId,
                    type: 'exited',
                    message: 'Dev server terminal exited',
                })
            }
        })

        return () => {
            unsubOutput()
            unsubExit()
            clearReadyTimeout()
        }
    }, [actions, addTimelineEvent, clearReadyTimeout, reportProblemsFromOutput])

    const launchDevServerTerminal = useCallback(async (
        projectPathValue: string,
        baseCommand: string,
        config: { label: string; port: number },
        runId: string
    ) => {
        if (isStartCancelled(runId)) {
            return
        }

        // Check if we need to install dependencies first
        let command = baseCommand
        const hasPackage = await hasPackageJson(projectPathValue)
        if (hasPackage) {
            const pm = await detectPackageManager(projectPathValue)
            const depsInstalled = await checkDependenciesInstalled(projectPathValue, pm)
            if (!depsInstalled) {
                const installCmd = getInstallCommand(pm)
                command = `${installCmd} && ${baseCommand}`
                console.log(`[DevServer] Dependencies missing, will run: ${command}`)
            }
        }

        if (isStartCancelled(runId)) {
            return
        }

        const launchPort = await findAvailableLaunchPort(config.port, runId)

        const result = await window.electronAPI.terminal.create({
            projectPath: projectPathValue,
            profileId: isWindowsClient() ? 'cmd' : undefined,
            cols: 80,
            rows: 24,
            runId,
            env: {
                PORT: String(launchPort),
                BROWSER: 'none',
            },
        })

        if (!result.success || !result.terminalId) {
            throw new Error(result.error || 'Failed to create dev server terminal')
        }

        if (isStartCancelled(runId)) {
            void window.electronAPI.terminal.kill({ terminalId: result.terminalId })
            return
        }

        devServerTerminalIdRef.current = result.terminalId
        devServerProjectPathRef.current = projectPathValue
        devServerRunIdRef.current = runId

        devServerLabelRef.current = config.label
        actions.beginServerRun(runId, command)
        actions.setServerStatus('starting')
        actions.setServerPort(launchPort)
        actions.setPreviewReadiness({
            runId,
            reachable: false,
            bridgeReady: false,
            embedded: false,
            lastCheckedAt: null,
            lastFailureReason: null,
            lastFailureMessage: null,
        })
        addTerminal({
            id: result.terminalId,
            profileId: 'dev-server',
            profileName: config.label,
            projectPath: projectPathValue,
            label: config.label,
            kind: 'dev-server',
            runId,
            phase: 'starting',
            command,
            port: launchPort,
            nameSource: 'auto',
            title: formatTerminalTabTitle(config.label),
            status: 'starting',
            hasOutput: false,
        })

        setPanelOpen(true)
        addTimelineEvent({
            runId,
            type: 'start_succeeded',
            message: 'Dev server terminal created',
            details: {
                terminalId: result.terminalId,
                command,
                port: launchPort,
            },
        })

        setTimeout(() => {
            if (isStartCancelled(runId)) {
                return
            }
            void window.electronAPI.terminal.input({
                terminalId: result.terminalId!,
                data: `${command}\r\n`
            })
        }, 100)

        void waitForServerPortReachability(runId, launchPort, 'launch')

        const timeout = command.includes('install') ? 120000 : 15000
        clearReadyTimeout()
        readyTimeoutRef.current = setTimeout(() => {
            if (isStartCancelled(runId)) {
                return
            }
            const currentStatus = useProjectPagesStore.getState().serverStatus
            if (currentStatus === 'starting') {
                const timeoutMessage = 'Startup watchdog elapsed before readiness was confirmed.'
                console.warn('[DevServer] Timeout without readiness confirmation')
                actions.addServerOutput(`\n[DevServer] ${timeoutMessage}\n`)
                markRunUnhealthy(timeoutMessage, 'server_unreachable', runId)
            }
        }, timeout)
    }, [actions, addTerminal, addTimelineEvent, clearReadyTimeout, findAvailableLaunchPort, isStartCancelled, markRunUnhealthy, setPanelOpen, waitForServerPortReachability])

    const handleStart = useCallback(async () => {
        if (!projectPath) return
        if (serverStatus === 'starting' || serverStatus === 'running' || serverStatus === 'unhealthy') return

        try {
            setIsUpdating(true)
            const autoStartState = getAutoStartState(projectPath)
            autoStartState.hasAttempted = true
            autoStartState.suppressed = false
            const runId = createRunId()
            cancelledStartRunIdsRef.current.delete(runId)
            devServerRunIdRef.current = runId
            actions.beginServerRun(runId)
            actions.setServerStatus('starting')
            actions.clearServerOutput()
            addTimelineEvent({
                runId,
                type: 'start_requested',
                message: 'Start requested from Pages toolbar',
            })

            const config = await getDevServerConfig(projectPath, storedDevCommand, storedDevPort)
            if (isStartCancelled(runId)) {
                return
            }
            const persistedCommand = getPersistedDevCommand(projectPath)
            const selectedCommand = persistedCommand || config.command

            if (!persistedCommand && config.requiresUserSelection) {
                pendingCommandSelectionRef.current = { label: config.label, port: config.port }
                setCommandSuggestions(config.suggestions)
                setCommandPickerDefault(selectedCommand)
                setShowCommandPicker(true)
                actions.setServerStatus('stopped')
                actions.setServerLifecycle({
                    runId,
                    state: 'stopped',
                    stoppedAt: Date.now(),
                })
                actions.resetPreviewReadiness()
                devServerRunIdRef.current = null
                return
            }

            await launchDevServerTerminal(projectPath, selectedCommand, {
                label: config.label,
                port: config.port,
            }, runId)
        } catch (e) {
            console.error(e)
            actions.setServerStatus('error')
            actions.setServerLifecycle({
                runId: devServerRunIdRef.current,
                state: 'error',
                unhealthyReason: e instanceof Error ? e.message : 'Failed to start server',
            })
            actions.addServerOutput(`Error: ${e instanceof Error ? e.message : 'Failed to start server'}\n`)
            addTimelineEvent({
                runId: devServerRunIdRef.current,
                type: 'start_failed',
                message: e instanceof Error ? e.message : 'Failed to start server',
            })
        } finally {
            setIsUpdating(false)
        }
    }, [
        actions,
        addTimelineEvent,
        createRunId,
        launchDevServerTerminal,
        projectPath,
        serverStatus,
        storedDevCommand,
        storedDevPort,
        isStartCancelled,
    ])

    const handleCommandPickerConfirm = useCallback(async (command: string) => {
        if (!projectPath) return
        const pending = pendingCommandSelectionRef.current
        if (!pending) return

        try {
            setShowCommandPicker(false)
            setIsUpdating(true)
            const runId = createRunId()
            cancelledStartRunIdsRef.current.delete(runId)
            devServerRunIdRef.current = runId
            actions.beginServerRun(runId, command)
            actions.setServerStatus('starting')
            actions.clearServerOutput()
            persistDevCommand(projectPath, command)
            addTimelineEvent({
                runId,
                type: 'start_requested',
                message: 'Start requested after command selection',
                details: {
                    command,
                },
            })
            if (isStartCancelled(runId)) {
                return
            }
            await launchDevServerTerminal(projectPath, command, pending, runId)
        } catch (e) {
            console.error(e)
            actions.setServerStatus('error')
            actions.setServerLifecycle({
                runId: devServerRunIdRef.current,
                state: 'error',
                unhealthyReason: e instanceof Error ? e.message : 'Failed to start server',
            })
            actions.addServerOutput(`Error: ${e instanceof Error ? e.message : 'Failed to start server'}\n`)
            addTimelineEvent({
                runId: devServerRunIdRef.current,
                type: 'start_failed',
                message: e instanceof Error ? e.message : 'Failed to start server',
            })
        } finally {
            pendingCommandSelectionRef.current = null
            setIsUpdating(false)
        }
    }, [actions, addTimelineEvent, createRunId, isStartCancelled, launchDevServerTerminal, projectPath])

    // Auto-start dev server when entering the pages page (runs after handleStart is defined)
    useEffect(() => {
        if (!projectPath) return
        const autoStartState = getAutoStartState(projectPath)
        if (autoStartState.hasAttempted || autoStartState.suppressed) return
        const status = useProjectPagesStore.getState().serverStatus
        if (status !== 'stopped' && status !== 'error') return
        autoStartState.hasAttempted = true
        void (async () => {
            try {
                await handleStart()
            } catch (e) {
                console.error('[ServerControl] Auto-start failed:', e)
            }
        })()
    }, [projectPath, handleStart])

    const handleStop = useCallback(async () => {
        const terminalId = devServerTerminalIdRef.current
        if (!projectPath) return

        try {
            setIsUpdating(true)
            const autoStartState = getAutoStartState(projectPath)
            autoStartState.hasAttempted = true
            autoStartState.suppressed = true
            clearReadyTimeout()
            pendingReadyProbeKeyRef.current = null
            const activeRunId = devServerRunIdRef.current
            if (activeRunId) {
                cancelledStartRunIdsRef.current.add(activeRunId)
            }

            actions.setServerStatus('stopped')
            actions.setServerPort(null)
            actions.setServerPid(null)
            actions.setServerLifecycle({
                runId: activeRunId,
                state: 'stopped',
                stoppedAt: Date.now(),
                unhealthyReason: null,
            })
            actions.resetPreviewReadiness()
            addTimelineEvent({
                runId: activeRunId,
                type: 'stopped',
                message: 'Dev server stopped by user',
            })
            devServerProjectPathRef.current = null
            devServerRunIdRef.current = null
            if (terminalId) {
                removeTerminal(terminalId)
                devServerTerminalIdRef.current = null
                const result = await window.electronAPI.terminal.kill({ terminalId })
                if (!result.success) {
                    console.warn('[ServerControl] Terminal kill did not report success', { terminalId })
                }
            } else {
                devServerTerminalIdRef.current = null
            }
        } catch (e) {
            console.error(e)
        } finally {
            setIsUpdating(false)
        }
    }, [actions, addTimelineEvent, clearReadyTimeout, projectPath, removeTerminal])

    return (
        <>
            <DevCommandPickerDialog
                open={showCommandPicker}
                defaultCommand={commandPickerDefault}
                suggestions={commandSuggestions}
                onOpenChange={(open) => {
                    setShowCommandPicker(open)
                    if (!open) {
                        pendingCommandSelectionRef.current = null
                    }
                }}
                onConfirm={(command) => {
                    void handleCommandPickerConfirm(command)
                }}
            />

            <div className="flex items-center gap-2">
                {serverStatus === 'stopped' || serverStatus === 'error' ? (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-foreground/70 hover:text-foreground hover:bg-accent"
                                onClick={handleStart}
                                disabled={isUpdating || !projectPath}
                            >
                                <Play className="h-4 w-4 ml-0.5 fill-current" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Start Dev Server</TooltipContent>
                    </Tooltip>
                ) : (
                    <div className="flex items-center">
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-destructive hover:bg-destructive/20"
                            onClick={handleStop}
                            title={serverStatus === 'starting' ? 'Stop server startup' : 'Stop server'}
                            disabled={!projectPath}
                        >
                            <Square className="h-3.5 w-3.5 fill-current" />
                        </Button>
                    </div>
                )}
            </div>
        </>
    )
}
