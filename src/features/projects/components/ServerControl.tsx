import { useState, useEffect, useCallback, useRef } from "react"
import { Play, Square, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { getPreviewFailurePresentation } from "@/features/projects/lib/previewFailurePresentation"
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

const formatTerminalTabTitle = (label: string, port: number | null | undefined) =>
    port ? `${label} · localhost:${port}` : label

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

    const probeServerReachability = useCallback(async (
        runId: string,
        port: number,
        source: 'ready-pattern' | 'port-detected'
    ) => {
        if (!projectPath) return
        if (devServerRunIdRef.current && devServerRunIdRef.current !== runId) return

        const probeKey = `${runId}:${port}`
        if (pendingReadyProbeKeyRef.current === probeKey) {
            return
        }
        pendingReadyProbeKeyRef.current = probeKey

        const previewUrl = `http://localhost:${port}`
        try {
            const probe = await window.electronAPI.preview.probeUrl({
                url: previewUrl,
                timeoutMs: 2500,
            })

            if (devServerRunIdRef.current && devServerRunIdRef.current !== runId) {
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
                    message: `Dev server reachable at ${previewUrl}`,
                    details: {
                        source,
                        statusCode: probe.statusCode,
                    },
                })
                clearReadyTimeout()
                return
            }

            const failure = getPreviewFailurePresentation(
                probe.reason ?? 'server_unreachable',
                probe.error || 'Dev server process started but preview URL is not reachable yet.',
                { context: 'server' }
            )
            markRunUnhealthy(failure.message, failure.reason, runId)
        } catch (error) {
            if (devServerRunIdRef.current && devServerRunIdRef.current !== runId) {
                return
            }
            const failure = getPreviewFailurePresentation(
                'server_unreachable',
                error instanceof Error ? error.message : 'Dev server reachability probe failed',
                { context: 'server' }
            )
            markRunUnhealthy(failure.message, failure.reason, runId)
        } finally {
            if (pendingReadyProbeKeyRef.current === probeKey) {
                pendingReadyProbeKeyRef.current = null
            }
        }
    }, [actions, addTimelineEvent, clearReadyTimeout, markRunUnhealthy, projectPath, updateTerminalDisplay, updateTerminalStatus])

    const reportProblemsFromOutput = useCallback((data: string) => {
        if (!projectPath) return
        const cleaned = stripAnsi(data)
        const lines = cleaned.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
        for (const line of lines) {
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
    }, [addRuntimeProblem, projectPath])

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
                void probeServerReachability(devServerRunIdRef.current, existingDevTerminal.port, 'port-detected')
            }
        })().catch((error) => {
            console.error('[ServerControl] Failed to re-bind dev server terminal:', error)
        })

        return () => {
            cancelled = true
        }
    }, [actions, probeServerReachability, projectPath, terminals])

    // Subscribe to terminal events for dev server detection
    useEffect(() => {
        const extractPort = (input: string): number | null => {
            const cleaned = stripAnsi(input)
            const match =
                cleaned.match(/localhost:(\d{2,5})/i) ??
                cleaned.match(/127\.0\.0\.1:(\d{2,5})/i) ??
                cleaned.match(/0\.0\.0\.0:(\d{2,5})/i)

            if (!match?.[1]) return null
            const port = Number(match[1])
            return Number.isFinite(port) ? port : null
        }

        // Handle output from terminal to detect server ready
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

                const detectedPort = extractPort(data)
                if (detectedPort) {
                    actions.setServerPort(detectedPort)
                    if (devServerTerminalIdRef.current) {
                        updateTerminalDisplay(devServerTerminalIdRef.current, {
                            port: detectedPort,
                            title: formatTerminalTabTitle(devServerLabelRef.current, detectedPort),
                        })
                    }
                }

                // Try to detect when server is ready by looking for common patterns
                const readyPatterns = [
                    // Generic patterns
                    /ready on/i,
                    /listening on/i,
                    /started server on/i,
                    /server.*running/i,
                    // URL patterns (localhost, 127.0.0.1, 0.0.0.0)
                    /local:\s*http/i,
                    /localhost:\d+/i,
                    /127\.0\.0\.1:\d+/i,
                    /0\.0\.0\.0:\d+/i,
                    // Framework-specific patterns
                    /✓\s*ready/i,              // Next.js
                    /ready in \d+/i,           // Next.js alt
                    /watching for file changes/i,  // Astro
                    /vite.*ready/i,            // Vite
                    /compiled.*successfully/i, // CRA, Webpack
                    /bundle.*successfully/i,   // Various bundlers
                    /➜\s*(local|network):/i,   // Vite CLI output
                    /app started/i,            // Generic
                    /server started/i,         // Generic
                ]
                const cleaned = stripAnsi(data)
                if (readyPatterns.some(pattern => pattern.test(cleaned))) {
                    addTimelineEvent({
                        runId: activeRunId,
                        type: 'ready_detected',
                        message: 'Detected ready pattern in terminal output',
                        details: {
                            detectedPort,
                        },
                    })
                    const candidatePort = detectedPort ?? useProjectPagesStore.getState().serverPort
                    if (candidatePort && activeRunId) {
                        void probeServerReachability(activeRunId, candidatePort, 'ready-pattern')
                    } else if (candidatePort) {
                        actions.setServerStatus('running')
                        actions.setServerLifecycle({
                            state: 'ready',
                            readyAt: Date.now(),
                        })
                        if (devServerTerminalIdRef.current) {
                            updateTerminalStatus(devServerTerminalIdRef.current, 'running')
                        }
                    }
                }
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
    }, [actions, addTimelineEvent, clearReadyTimeout, probeServerReachability, updateTerminalDisplay, updateTerminalStatus, reportProblemsFromOutput])

    const launchDevServerTerminal = useCallback(async (
        projectPathValue: string,
        baseCommand: string,
        config: { label: string; port: number },
        runId: string
    ) => {
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

        const result = await window.electronAPI.terminal.create({
            projectPath: projectPathValue,
            profileId: isWindowsClient() ? 'cmd' : undefined,
            cols: 80,
            rows: 24,
            runId,
        })

        if (!result.success || !result.terminalId) {
            throw new Error(result.error || 'Failed to create dev server terminal')
        }

        devServerTerminalIdRef.current = result.terminalId
        devServerProjectPathRef.current = projectPathValue
        devServerRunIdRef.current = runId

        devServerLabelRef.current = config.label
        actions.beginServerRun(runId, command)
        actions.setServerStatus('starting')
        actions.setServerPort(config.port)
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
            port: config.port,
            nameSource: 'auto',
            title: formatTerminalTabTitle(config.label, config.port),
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
                port: config.port,
            },
        })

        setTimeout(() => {
            void window.electronAPI.terminal.input({
                terminalId: result.terminalId!,
                data: `${command}\r\n`
            })
        }, 100)

        const timeout = command.includes('install') ? 120000 : 15000
        clearReadyTimeout()
        readyTimeoutRef.current = setTimeout(() => {
            const currentStatus = useProjectPagesStore.getState().serverStatus
            if (currentStatus === 'starting') {
                const timeoutMessage = 'Startup watchdog elapsed before readiness was confirmed.'
                console.warn('[DevServer] Timeout without readiness confirmation')
                actions.addServerOutput(`\n[DevServer] ${timeoutMessage}\n`)
                markRunUnhealthy(timeoutMessage, 'server_unreachable', runId)
            }
        }, timeout)
    }, [actions, addTerminal, addTimelineEvent, clearReadyTimeout, markRunUnhealthy, setPanelOpen])

    const handleStart = useCallback(async () => {
        if (!projectPath) return
        if (serverStatus === 'starting' || serverStatus === 'running') return

        try {
            setIsUpdating(true)
            const runId = createRunId()
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
    ])

    const handleCommandPickerConfirm = useCallback(async (command: string) => {
        if (!projectPath) return
        const pending = pendingCommandSelectionRef.current
        if (!pending) return

        try {
            setShowCommandPicker(false)
            setIsUpdating(true)
            const runId = createRunId()
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
    }, [actions, addTimelineEvent, createRunId, launchDevServerTerminal, projectPath])

    // Auto-start dev server when entering the pages page (runs after handleStart is defined)
    const hasAutoStartedRef = useRef(false)
    useEffect(() => {
        if (!projectPath) return
        if (hasAutoStartedRef.current) return
        const status = useProjectPagesStore.getState().serverStatus
        if (status !== 'stopped' && status !== 'error') return
        hasAutoStartedRef.current = true
        void (async () => {
            try {
                await handleStart()
            } catch (e) {
                console.error('[ServerControl] Auto-start failed:', e)
            }
        })()
    }, [projectPath, handleStart])

    const handleStop = useCallback(async () => {
        if (!devServerTerminalIdRef.current) return

        try {
            setIsUpdating(true)
            clearReadyTimeout()
            pendingReadyProbeKeyRef.current = null
            const activeRunId = devServerRunIdRef.current

            // Kill the terminal
            await window.electronAPI.terminal.kill({ terminalId: devServerTerminalIdRef.current })
            removeTerminal(devServerTerminalIdRef.current)

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
            devServerTerminalIdRef.current = null
            devServerProjectPathRef.current = null
            devServerRunIdRef.current = null
        } catch (e) {
            console.error(e)
        } finally {
            setIsUpdating(false)
        }
    }, [actions, addTimelineEvent, clearReadyTimeout, removeTerminal])

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
                {serverStatus === 'stopped' || serverStatus === 'error' || serverStatus === 'unhealthy' || serverStatus === 'starting' ? (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-foreground/70 hover:text-foreground hover:bg-accent"
                                onClick={handleStart}
                                disabled={isUpdating || !projectPath}
                            >
                                {isUpdating || serverStatus === 'starting' ? (
                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Play className="h-4 w-4 ml-0.5 fill-current" />
                                )}
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Start Dev Server</TooltipContent>
                    </Tooltip>
                ) : (
                    <div className="flex items-center">
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-destructive hover:bg-destructive/20 animate-pulse"
                            onClick={handleStop}
                            title="Stop server"
                            disabled={isUpdating}
                        >
                            <Square className="h-3.5 w-3.5 fill-current" />
                        </Button>
                    </div>
                )}
            </div>
        </>
    )
}
