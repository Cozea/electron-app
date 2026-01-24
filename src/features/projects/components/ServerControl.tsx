import { useState, useEffect, useCallback, useRef } from "react"
import { Play, Square, RefreshCw, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useProjectPagesStore } from "@/stores/useProjectPagesStore"
import { useTerminalActions } from "@/stores/useTerminalStore"
import { getDevServerConfig } from "@/utils/projectDetector"

interface ServerControlProps {
    projectPath?: string | null
    // Optional stored framework info from Convex (uses detection as fallback)
    storedDevCommand?: string | null
    storedDevPort?: number | null
}

export function ServerControl({ projectPath, storedDevCommand, storedDevPort }: ServerControlProps) {
    const { serverStatus, serverPort, actions } = useProjectPagesStore()
    const { addTerminal, removeTerminal, updateTerminalStatus, setPanelOpen } = useTerminalActions()
    const [isUpdating, setIsUpdating] = useState(false)

    // Track the dev server terminal ID
    const devServerTerminalIdRef = useRef<string | null>(null)

    // Ref for timeout fallback when ready patterns don't match
    const readyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Clear the ready timeout
    const clearReadyTimeout = useCallback(() => {
        if (readyTimeoutRef.current) {
            clearTimeout(readyTimeoutRef.current)
            readyTimeoutRef.current = null
        }
    }, [])

    // Cleanup dev server terminal when component unmounts (leaving project)
    useEffect(() => {
        return () => {
            if (devServerTerminalIdRef.current) {
                // Kill the terminal process
                window.electronAPI.terminal.kill({ terminalId: devServerTerminalIdRef.current })
                removeTerminal(devServerTerminalIdRef.current)
                devServerTerminalIdRef.current = null
            }
            clearReadyTimeout()
            // Reset server status
            actions.setServerStatus('stopped')
            actions.setServerPort(null)
            actions.setServerPid(null)
        }
    }, []) // Empty deps - only run on unmount

    // Subscribe to terminal events for dev server detection
    useEffect(() => {
        // Handle output from terminal to detect server ready
        const unsubOutput = window.electronAPI.terminal.onOutput(({ terminalId, data }) => {
            if (terminalId === devServerTerminalIdRef.current) {
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
                if (readyPatterns.some(pattern => pattern.test(data))) {
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
                clearReadyTimeout()
            }
        })

        return () => {
            unsubOutput()
            unsubExit()
            clearReadyTimeout()
        }
    }, [actions, clearReadyTimeout, updateTerminalStatus])

    const handleStart = useCallback(async () => {
        if (!projectPath) return

        try {
            setIsUpdating(true)
            actions.setServerStatus('starting')
            actions.clearServerOutput()

            // Get dev server config (uses stored values or detects from package.json)
            const config = await getDevServerConfig(projectPath, storedDevCommand, storedDevPort)

            // Create a terminal for the dev server
            const result = await window.electronAPI.terminal.create({
                projectPath,
                cols: 80,
                rows: 24,
            })

            if (result.success && result.terminalId) {
                devServerTerminalIdRef.current = result.terminalId

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

                // Send the dev command to the terminal
                // Small delay to ensure terminal is ready
                setTimeout(() => {
                    window.electronAPI.terminal.input({
                        terminalId: result.terminalId!,
                        data: `${config.command}\r`
                    })
                }, 100)

                actions.setServerPort(config.port)

                // Set a timeout fallback in case ready patterns don't match
                clearReadyTimeout()
                readyTimeoutRef.current = setTimeout(() => {
                    const currentStatus = useProjectPagesStore.getState().serverStatus
                    if (currentStatus === 'starting') {
                        console.log('[DevServer] Timeout: assuming server is ready')
                        actions.setServerStatus('running')
                    }
                }, 15000) // 15 seconds
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
        } catch (e) {
            console.error(e)
        } finally {
            setIsUpdating(false)
        }
    }, [actions, clearReadyTimeout, removeTerminal])

    const handleOpen = useCallback(() => {
        if (serverPort) {
            window.open(`http://localhost:${serverPort}`, '_blank')
        }
    }, [serverPort])

    return (
        <div className="flex items-center gap-2">
            {serverStatus === 'stopped' || serverStatus === 'error' || serverStatus === 'starting' ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-foreground/70 hover:text-foreground hover:bg-accent"
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
                        className="h-8 w-8 p-0"
                        onClick={handleOpen}
                        title="Open in browser"
                    >
                        <ExternalLink className="h-4 w-4" />
                    </Button>

                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-destructive hover:bg-destructive/20"
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
