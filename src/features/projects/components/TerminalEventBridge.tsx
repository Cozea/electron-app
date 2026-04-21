import { startTransition, useEffect } from 'react'
import { useTerminalStore } from '@/stores/useTerminalStore'

export function TerminalEventBridge() {
  useEffect(() => {
    const unsubscribeOutput = window.electronAPI.terminal.onOutput(({ terminalId, data }) => {
      const state = useTerminalStore.getState()
      const terminal = state.terminals[terminalId]
      if (!terminal) return

      startTransition(() => {
        state.actions.setTerminalHasOutput(terminalId, true)
        if (terminal.status === 'starting') {
          state.actions.updateTerminalStatus(terminalId, 'running')
        }
        if (terminal.uiAttached !== false) {
          state.actions.appendTerminalOutput(terminalId, data)
        }
      })
    })

    const unsubscribeExit = window.electronAPI.terminal.onExit(({ terminalId, exitCode }) => {
      const state = useTerminalStore.getState()
      const terminal = state.terminals[terminalId]
      if (!terminal) return
      if (terminal.status === 'exited' && terminal.exitCode === exitCode) return

      startTransition(() => {
        state.actions.updateTerminalStatus(terminalId, 'exited', exitCode)
        state.actions.appendTerminalOutput(
          terminalId,
          `\r\n\x1b[90m[Process exited with code ${exitCode ?? 'unknown'}]\x1b[0m\r\n`,
        )
      })
    })

    return () => {
      unsubscribeOutput()
      unsubscribeExit()
    }
  }, [])

  return null
}
