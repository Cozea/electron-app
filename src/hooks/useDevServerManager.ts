import { useState, useEffect, useCallback, useRef } from 'react'
import { getDevServerConfig } from '@/utils/projectDetector'

export type DevServerStatus = 'idle' | 'starting' | 'ready' | 'error' | 'stopped'

interface UseDevServerManagerOptions {
  projectPath: string | null
  autoStart?: boolean
  onReady?: (url: string) => void
  onError?: (error: string) => void
  onOutput?: (output: string) => void
}

interface DevServerState {
  status: DevServerStatus
  url: string | null
  port: number | null
  error: string | null
  output: string[]
}

// Patterns that indicate the dev server is ready
const READY_PATTERNS = [
  /Local:\s+https?:\/\/localhost:(\d+)/i,
  /ready on.*localhost:(\d+)/i,
  /ready in \d+/i,
  /listening on.*:(\d+)/i,
  /started.*localhost:(\d+)/i,
  /http:\/\/localhost:(\d+)/,
  /➜\s+Local:\s+https?:\/\/localhost:(\d+)/i, // Vite format
  /compiled.*successfully/i,
]

function stripAnsi(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '')
}

export function useDevServerManager({
  projectPath,
  autoStart = false,
  onReady,
  onError,
  onOutput,
}: UseDevServerManagerOptions) {
  const [state, setState] = useState<DevServerState>({
    status: 'idle',
    url: null,
    port: null,
    error: null,
    output: [],
  })

  const startedRef = useRef(false)
  const expectedPortRef = useRef<number | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  // Start the dev server
  const start = useCallback(async () => {
    if (!projectPath) return
    if (state.status === 'starting' || state.status === 'ready') return

    setState((prev) => ({
      ...prev,
      status: 'starting',
      error: null,
      output: [],
    }))

    try {
      // Get dev server config (command and port)
      const config = await getDevServerConfig(projectPath)
      if (config.requiresUserSelection) {
        throw new Error('Dev server command selection is required. Open Project Pages and choose a command first.')
      }
      expectedPortRef.current = config.port

      console.log('[DevServer] Starting with config:', config)

      // Start the dev server
      const result = await window.electronAPI.devServer.start({
        projectPath,
        command: config.command,
        port: config.port,
      })

      if (!result.success) {
        throw new Error(result.error || 'Failed to start dev server')
      }

      startedRef.current = true
      console.log('[DevServer] Started with PID:', result.pid)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: errorMessage,
      }))
      onError?.(errorMessage)
    }
  }, [projectPath, state.status, onError])

  // Stop the dev server
  const stop = useCallback(async () => {
    if (!projectPath) return

    try {
      await window.electronAPI.devServer.stop({ projectPath })
      startedRef.current = false
      setState((prev) => ({
        ...prev,
        status: 'stopped',
        url: null,
        port: null,
      }))
    } catch (err) {
      console.error('[DevServer] Failed to stop:', err)
    }
  }, [projectPath])

  // Restart the dev server
  const restart = useCallback(async () => {
    await stop()
    // Small delay before restarting
    setTimeout(() => {
      start()
    }, 500)
  }, [stop, start])

  // Check if a line indicates the server is ready and extract port
  const checkForReady = useCallback(
    (line: string): number | null => {
      const cleaned = stripAnsi(line)
      for (const pattern of READY_PATTERNS) {
        const match = cleaned.match(pattern)
        if (match) {
          // Try to extract port from capture group or use expected port
          const port = match[1] ? parseInt(match[1], 10) : expectedPortRef.current
          return port || null
        }
      }
      return null
    },
    []
  )

  // Listen for dev server output
  useEffect(() => {
    if (!projectPath) return

    const unsubOutput = window.electronAPI.devServer.onOutput(({ projectPath: path, output }) => {
      if (path !== projectPath) return

      // Append to output log
      setState((prev) => ({
        ...prev,
        output: [...prev.output.slice(-100), output], // Keep last 100 lines
      }))

      onOutput?.(output)

      // Check if server is ready (only if we're still starting)
      if (state.status === 'starting') {
        const port = checkForReady(output)
        if (port) {
          const url = `http://localhost:${port}`
          console.log('[DevServer] Ready at:', url)
          setState((prev) => ({
            ...prev,
            status: 'ready',
            url,
            port,
          }))
          onReady?.(url)
        }
      }
    })

    const unsubExit = window.electronAPI.devServer.onExit(({ projectPath: path, code }) => {
      if (path !== projectPath) return

      console.log('[DevServer] Exited with code:', code)
      startedRef.current = false

      setState((prev) => ({
        ...prev,
        status: code === 0 ? 'stopped' : 'error',
        error: code !== 0 ? `Dev server exited with code ${code}` : null,
      }))
    })

    const unsubError = window.electronAPI.devServer.onError(({ projectPath: path, error }) => {
      if (path !== projectPath) return

      console.error('[DevServer] Error:', error)
      setState((prev) => ({
        ...prev,
        status: 'error',
        error,
      }))
      onError?.(error)
    })

    cleanupRef.current = () => {
      unsubOutput()
      unsubExit()
      unsubError()
    }

    return () => {
      cleanupRef.current?.()
    }
  }, [projectPath, state.status, checkForReady, onReady, onError, onOutput])

  // Auto-start if enabled
  useEffect(() => {
    if (autoStart && projectPath && state.status === 'idle') {
      start()
    }
  }, [autoStart, projectPath, state.status, start])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (startedRef.current && projectPath) {
        console.log('[DevServer] Cleaning up on unmount')
        window.electronAPI.devServer.stop({ projectPath }).catch(console.error)
      }
    }
  }, [projectPath])

  return {
    ...state,
    start,
    stop,
    restart,
    isRunning: state.status === 'starting' || state.status === 'ready',
  }
}
