import { startTransition, useEffect } from 'react'
import { useTerminalStore } from '@/features/terminal/model/terminalStore'

export function TerminalEventBridge() {
  useEffect(() => {
    const unsubscribeOutput = window.electronAPI.terminal.onOutput(({ terminalId }) => {
      const state = useTerminalStore.getState()
      const terminal = state.terminals[terminalId]
      if (!terminal) return
      if (terminal.hasOutput && terminal.status !== 'starting') return

      startTransition(() => {
        state.actions.setTerminalHasOutput(terminalId, true)
        if (terminal.status === 'starting') {
          state.actions.updateTerminalStatus(terminalId, 'running')
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
      })
    })

    return () => {
      unsubscribeOutput()
      unsubscribeExit()
    }
  }, [])

  return null
}
