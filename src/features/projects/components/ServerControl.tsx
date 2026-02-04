import { useState, useEffect, useCallback, useRef } from "react"
import { Play, Square, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useProjectPagesStore } from "@/stores/useProjectPagesStore"
import { useTerminalActions } from "@/stores/useTerminalStore"
import {
    getDevServerConfig,
    detectPackageManager,
    getInstallCommand,
    checkDependenciesInstalled,
    hasPackageJson,
} from "@/utils/projectDetector"
import { useProblemsStore, type ProblemSeverity } from "@/stores/useProblemsStore"

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

interface ServerControlProps {
    projectPath?: string | null
    // Optional stored framework info from Convex (uses detection as fallback)
    storedDevCommand?: string | null
    storedDevPort?: number | null
}

export function ServerControl({ projectPath, storedDevCommand, storedDevPort }: ServerControlProps) {
    const { serverStatus, serverPort, actions } = useProjectPagesStore()
    const { addTerminal, removeTerminal, updateTerminalStatus, setPanelOpen } = useTerminalActions()
    const addRuntimeProblem = useProblemsStore((state) => state.actions.addRuntimeProblem)
    const [isUpdating, setIsUpdating] = useState(false)

    // Track the dev server terminal ID
    const devServerTerminalIdRef = useRef<string | null>(null)
    const devServerProjectPathRef = useRef<string | null>(null)

    // Ref for timeout fallback when ready patterns don't match
    const readyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const pendingProblemRef = useRef<{ message: string; severity: ProblemSeverity } | null>(null)

    // Clear the ready timeout
    const clearReadyTimeout = useCallback(() => {
        if (readyTimeoutRef.current) {
            clearTimeout(readyTimeoutRef.current)
            readyTimeoutRef.current = null
        }
    }, [])

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

    // Cleanup dev server terminal when switching projects or leaving page
    useEffect(() => {
        return () => {
            if (devServerTerminalIdRef.current && devServerProjectPathRef.current === projectPath) {
                // Kill the terminal process
                window.electronAPI.terminal.kill({ terminalId: devServerTerminalIdRef.current })
                removeTerminal(devServerTerminalIdRef.current)
                devServerTerminalIdRef.current = null
                devServerProjectPathRef.current = null
            }
            clearReadyTimeout()
            // Reset server status
            actions.setServerStatus('stopped')
            actions.setServerPort(null)
            actions.setServerPid(null)
        }
    }, [projectPath, actions, clearReadyTimeout, removeTerminal])

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
        const unsubOutput = window.electronAPI.terminal.onOutput(({ terminalId, data }) => {
            if (terminalId === devServerTerminalIdRef.current) {
                // Forward output to store so DevServerPanel can display it
                actions.addServerOutput(data)
                reportProblemsFromOutput(data)

                const detectedPort = extractPort(data)
                if (detectedPort) {
                    actions.setServerPort(detectedPort)
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
                    actions.setServerStatus('running')
                    if (devServerTerminalIdRef.current) {
                        updateTerminalStatus(devServerTerminalIdRef.current, 'running')
                    }
                    clearReadyTimeout()
                }
            }
        })

        // Handle terminal exit
        const unsubExit = window.electronAPI.terminal.onExit(({ terminalId }) => {
            if (terminalId === devServerTerminalIdRef.current) {
                actions.setServerStatus('stopped')
                actions.setServerPort(null)
                actions.setServerPid(null)
                devServerTerminalIdRef.current = null
                devServerProjectPathRef.current = null
                clearReadyTimeout()
            }
        })

        return () => {
            unsubOutput()
            unsubExit()
            clearReadyTimeout()
        }
    }, [actions, clearReadyTimeout, updateTerminalStatus, reportProblemsFromOutput])

    const handleStart = useCallback(async () => {
        if (!projectPath) return

        try {
            setIsUpdating(true)
            actions.setServerStatus('starting')
            actions.clearServerOutput()

            // Get dev server config (uses stored values or detects from package.json)
            const config = await getDevServerConfig(projectPath, storedDevCommand, storedDevPort)

            // Check if we need to install dependencies first
            let command = config.command
            const hasPackage = await hasPackageJson(projectPath)
            if (hasPackage) {
                const depsInstalled = await checkDependenciesInstalled(projectPath)
                if (!depsInstalled) {
                    // Chain install + dev command so both run in the same terminal
                    const pm = await detectPackageManager(projectPath)
                    const installCmd = getInstallCommand(pm)
                    command = `${installCmd} && ${config.command}`
                    console.log(`[DevServer] Dependencies missing, will run: ${command}`)
                }
            }

            // Create a terminal for the dev server
            const result = await window.electronAPI.terminal.create({
                projectPath,
                cols: 80,
                rows: 24,
            })

            if (result.success && result.terminalId) {
                devServerTerminalIdRef.current = result.terminalId
                devServerProjectPathRef.current = projectPath

                // Add terminal to store with dev server title
                addTerminal({
                    id: result.terminalId,
                    profileId: 'dev-server',
                    profileName: 'Dev Server',
                    title: `Dev Server (${config.port})`,
                    status: 'starting',
                    hasOutput: false,
                })

                // Open the terminal panel
                setPanelOpen(true)

                // Send the command to the terminal
                // Small delay to ensure terminal is ready
                setTimeout(() => {
                    window.electronAPI.terminal.input({
                        terminalId: result.terminalId!,
                        data: `${command}\r`
                    })
                }, 100)

                actions.setServerPort(config.port)

                // Set a timeout fallback in case ready patterns don't match
                // Use longer timeout if installing dependencies
                const timeout = command.includes('install') ? 120000 : 15000
                clearReadyTimeout()
                readyTimeoutRef.current = setTimeout(() => {
                    const currentStatus = useProjectPagesStore.getState().serverStatus
                    if (currentStatus === 'starting') {
                        console.log('[DevServer] Timeout: assuming server is ready')
                        actions.setServerStatus('running')
                    }
                }, timeout)
            } else {
                actions.setServerStatus('error')
                actions.addServerOutput(`Error: ${result.error}\n`)
            }
        } catch (e) {
            console.error(e)
            actions.setServerStatus('error')
            actions.addServerOutput(`Error: ${e instanceof Error ? e.message : 'Failed to start server'}\n`)
        } finally {
            setIsUpdating(false)
        }
    }, [projectPath, storedDevCommand, storedDevPort, actions, clearReadyTimeout, addTerminal, setPanelOpen])

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

            // Kill the terminal
            await window.electronAPI.terminal.kill({ terminalId: devServerTerminalIdRef.current })
            removeTerminal(devServerTerminalIdRef.current)

            actions.setServerStatus('stopped')
            actions.setServerPort(null)
            actions.setServerPid(null)
            devServerTerminalIdRef.current = null
            devServerProjectPathRef.current = null
        } catch (e) {
            console.error(e)
        } finally {
            setIsUpdating(false)
        }
    }, [actions, clearReadyTimeout, removeTerminal])

    return (
        <div className="flex items-center gap-2">
            {serverStatus === 'stopped' || serverStatus === 'error' || serverStatus === 'starting' ? (
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
                <div className="flex items-center gap-1">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <span className="relative flex h-2.5 w-2.5 cursor-default">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                                </span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                                <p>localhost:{serverPort}</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>

                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-destructive hover:bg-destructive/20"
                        onClick={handleStop}
                        title="Stop server"
                        disabled={isUpdating}
                    >
                        <Square className="h-3.5 w-3.5 fill-current" />
                    </Button>
                </div>
            )}
        </div>
    )
}
